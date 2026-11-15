-- QLDA-44 (Story E0-5): bộ đếm giới hạn tần suất kiểu cửa sổ cố định, lưu trong Postgres
-- (không thêm dịch vụ ngoài khi chưa có ADR). Thiết kế: security.md STRIDE F1 (DoS),
-- api-contract.md mục 5. Ngưỡng nằm ở lib/api/rate-limit.ts, không nằm ở đây.
--
-- * Bảng ở schema `private` (PostgREST không phơi ra), RLS bật và không có chính sách nào: chỉ
--   chủ sở hữu (postgres) đọc/ghi, qua hàm SECURITY DEFINER bên dưới.
-- * Khóa do máy chủ ứng dụng tạo, đã băm (HMAC) phần IP/email; bảng không chứa IP hay email thô.
-- * Mỗi lần gọi tự dọn một lô dòng đã hết hạn, nên bảng chỉ giữ dữ liệu của cửa sổ đang chạy.
-- * Chỉ service_role gọi được (qua wrapper public.rate_limit_hit cho PostgREST); anon và
--   authenticated không gọi được, tránh người dùng tự đốt hạn mức của người khác hoặc dò khóa.

create table private.rate_limit_counters (
  key text not null,
  window_start timestamptz not null,
  hits integer not null default 0,
  expires_at timestamptz not null,
  constraint rate_limit_counters_pkey primary key (key, window_start),
  constraint rate_limit_counters_key_length check (char_length(key) between 1 and 200),
  constraint rate_limit_counters_hits_nonnegative check (hits >= 0)
);
comment on table private.rate_limit_counters is
  'Bộ đếm giới hạn tần suất theo cửa sổ cố định (E0-5). Khóa đã băm; dòng hết hạn tự dọn.';

-- Phục vụ việc dọn dòng hết hạn.
create index rate_limit_counters_expires_at_idx on private.rate_limit_counters (expires_at);

alter table private.rate_limit_counters enable row level security;
revoke all on table private.rate_limit_counters from public, anon, authenticated, service_role;

-- Ghi nhận một lượt cho `p_key` trong cửa sổ hiện tại rồi trả về:
--   allowed              true nếu số lượt (kể cả lượt này) chưa vượt p_limit
--   remaining            số lượt còn lại trong cửa sổ (không âm)
--   retry_after_seconds  số giây tới khi cửa sổ hiện tại kết thúc (tối thiểu 1)
-- Lượt bị từ chối vẫn được đếm (gọi dồn không làm cửa sổ ngắn lại, cửa sổ cố định tự hết).
create or replace function private.rate_limit_hit(
  p_key text,
  p_limit integer,
  p_window_seconds integer
)
returns table (allowed boolean, remaining integer, retry_after_seconds integer)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := now();
  v_window_start timestamptz;
  v_expires_at timestamptz;
  v_hits integer;
begin
  if p_key is null or char_length(p_key) not between 1 and 200 then
    raise exception 'rate_limit_hit: invalid key' using errcode = '22023';
  end if;
  if p_limit is null or p_limit not between 1 and 1000000 then
    raise exception 'rate_limit_hit: invalid limit' using errcode = '22023';
  end if;
  if p_window_seconds is null or p_window_seconds not between 1 and 86400 then
    raise exception 'rate_limit_hit: invalid window' using errcode = '22023';
  end if;

  v_window_start := to_timestamp(
    floor(extract(epoch from v_now) / p_window_seconds) * p_window_seconds
  );
  v_expires_at := v_window_start + make_interval(secs => p_window_seconds);

  insert into private.rate_limit_counters as c (key, window_start, hits, expires_at)
  values (p_key, v_window_start, 1, v_expires_at)
  on conflict (key, window_start)
    do update set hits = least(c.hits, 2147483646) + 1
  returning c.hits into v_hits;

  -- Dọn một lô dòng hết hạn; SKIP LOCKED để các lượt gọi đồng thời không chờ nhau.
  delete from private.rate_limit_counters d
  using (
    select o.key, o.window_start
    from private.rate_limit_counters o
    where o.expires_at <= v_now
    order by o.expires_at
    limit 200
    for update skip locked
  ) old
  where d.key = old.key and d.window_start = old.window_start;

  return query select
    v_hits <= p_limit,
    greatest(p_limit - v_hits, 0),
    greatest(ceil(extract(epoch from (v_expires_at - v_now)))::integer, 1);
end;
$$;

-- Wrapper ở public để supabase-js (PostgREST) gọi được bằng khóa service_role. SECURITY INVOKER:
-- quyền thật nằm ở hàm private phía dưới.
create or replace function public.rate_limit_hit(
  p_key text,
  p_limit integer,
  p_window_seconds integer
)
returns table (allowed boolean, remaining integer, retry_after_seconds integer)
language sql
volatile
security invoker
set search_path = ''
as $$
  select r.allowed, r.remaining, r.retry_after_seconds
  from private.rate_limit_hit(p_key, p_limit, p_window_seconds) r;
$$;
comment on function public.rate_limit_hit(text, integer, integer) is
  'Giới hạn tần suất (E0-5). Chỉ service_role gọi được; xem lib/api/rate-limit.ts.';

revoke all on function private.rate_limit_hit(text, integer, integer)
  from public, anon, authenticated;
revoke all on function public.rate_limit_hit(text, integer, integer)
  from public, anon, authenticated;
grant usage on schema private to service_role;
grant execute on function private.rate_limit_hit(text, integer, integer) to service_role;
grant execute on function public.rate_limit_hit(text, integer, integer) to service_role;
