-- QLDA-66 (Story E4-2): email giao việc (FR-12, ADR-002, ADR-003).
-- Bảng notification_preferences (bật/tắt email theo loại, chính chủ), hàng đợi email_outbox (chỉ
-- hệ thống), trigger trên notifications ghi hàng đợi, hàm cho worker gửi theo lô và job pg_cron
-- gọi Route Handler nội bộ /api/internal/email/dispatch.
--
-- Quyết định:
--   1. Gửi KHÔNG chặn thao tác chính (AC2): trigger chỉ GHI một dòng vào email_outbox trong cùng
--      giao dịch với thông báo (task bị rollback thì không có email); việc gửi do worker ngoài giao
--      dịch (Route Handler gọi nhà cung cấp email). Lỗi gửi không bao giờ làm hỏng thao tác giao việc.
--   2. Nguồn là bảng notifications (E4-1): trigger AFTER INSERT mức câu lệnh trên notifications,
--      không sửa trigger của tasks. Mọi quy tắc "ai nhận" (không tự gửi cho chính mình, người nhận
--      đang hoạt động và còn đọc được dự án) đã ở trigger E4-1; ở đây chỉ thêm điều kiện người
--      nhận BẬT email cho loại đó và (phòng thủ) người nhận khác người làm.
--   3. Mặc định khi chưa có dòng preferences: task_assigned BẬT, task_status_changed TẮT (mockup S16
--      bp-Notifications: "Được giao việc" bật, "Task đổi trạng thái" tắt; tránh vượt hạn mức 100
--      email/ngày của Resend miễn phí, ADR-002). Mặc định nằm DUY NHẤT ở
--      private.email_enabled_default(); API GET đọc qua public.my_notification_preferences().
--   4. Không gửi trùng: mỗi (người nhận, task, loại) chỉ có tối đa một dòng pending (chỉ mục duy
--      nhất một phần); giao đi giao lại liên tục trước khi worker chạy chỉ ra một email.
--   5. Kiểm quyền LÚC GỬI (public.email_outbox_claim): người nhận còn hoạt động, còn đọc được dự án
--      (thành viên hoặc Admin), với task_assigned còn là người phụ trách, có email; không đạt thì
--      dòng thành skipped và địa chỉ, tiêu đề không ra khỏi CSDL. Dòng chờ quá 24 giờ (ví dụ chưa cấu
--      hình gửi) cũng skipped: email giao việc cũ một ngày không còn giá trị và tránh dồn ứ.
--   6. Thử lại: chính sách (số lần, giãn cách) nằm ở lib/email/retry.ts (unit test); CSDL chỉ ghi
--      kết quả (public.email_outbox_finish). Mỗi lần nhận việc tăng attempts và giữ dòng 5 phút
--      (lease) để worker chết giữa chừng thì lần sau nhận lại; quá số lần tối đa thì failed.
--      last_error chỉ là mã lỗi ngắn (≤ 200 ký tự), không chứa nội dung email hay địa chỉ.
--   7. email_outbox CHỈ service_role truy cập: RLS bật, không có chính sách nào; anon, authenticated
--      không có quyền bảng. service_role chỉ SELECT, DELETE (vận hành, dọn); ghi trạng thái qua hai
--      hàm SECURITY DEFINER chỉ service_role gọi được. Không ai INSERT trực tiếp (chỉ trigger).
--   8. Lịch (ADR-003): pg_cron chạy private.email_dispatch_tick() mỗi phút; hàm chỉ gọi HTTP (pg_net)
--      khi CÓ dòng đến hạn VÀ đã cấu hình URL, bí mật trong Supabase Vault (email_dispatch_url,
--      email_dispatch_secret). Chưa cấu hình (cục bộ, CI) thì không làm gì. Bí mật không nằm trong
--      migration hay repo. Cục bộ chạy tay bằng `make email-dispatch`.

-- ---------------------------------------------------------------------------
-- 0. Extension (Supabase có sẵn; pg_cron cần schema pg_catalog theo hướng dẫn Supabase)
-- ---------------------------------------------------------------------------
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

-- ---------------------------------------------------------------------------
-- 1. notification_preferences: bật/tắt email theo loại (chính chủ)
-- ---------------------------------------------------------------------------
create table public.notification_preferences (
  user_id uuid not null references public.profiles (id) on delete cascade,
  type text not null,
  email_enabled boolean not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, type),
  constraint notification_preferences_type_check
    check (type in ('task_assigned', 'task_status_changed'))
);
comment on table public.notification_preferences is
  'Bật/tắt email theo loại thông báo (FR-12, E4-2). Không có dòng = mặc định '
  '(private.email_enabled_default: task_assigned bật, task_status_changed tắt). Chỉ chính chủ.';

create trigger set_updated_at
  before update on public.notification_preferences
  for each row execute function public.set_updated_at();

-- Mặc định theo loại (quyết định 3). Hàm thuần.
create or replace function private.email_enabled_default(p_type text)
returns boolean
language sql
immutable
security definer
set search_path = ''
as $$
  select p_type = 'task_assigned';
$$;

-- Người nhận có bật email cho loại này không (dòng riêng hoặc mặc định).
create or replace function private.email_enabled_for(p_user_id uuid, p_type text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select np.email_enabled from public.notification_preferences np
     where np.user_id = p_user_id and np.type = p_type),
    private.email_enabled_default(p_type)
  );
$$;

revoke all on function
  private.email_enabled_default(text),
  private.email_enabled_for(uuid, text)
  from public, anon, authenticated, service_role;
-- public.my_notification_preferences (INVOKER) điền mặc định qua hàm thuần này.
grant execute on function private.email_enabled_default(text) to authenticated;

-- Quyền bảng: thu mặc định của Supabase, cấp theo cột.
revoke all on public.notification_preferences from public, anon, authenticated, service_role;
grant select (user_id, type, email_enabled, updated_at)
  on public.notification_preferences to authenticated;
grant insert (user_id, type, email_enabled) on public.notification_preferences to authenticated;
grant update (email_enabled) on public.notification_preferences to authenticated;
grant select on public.notification_preferences to service_role;

alter table public.notification_preferences enable row level security;

-- Chỉ chính chủ đang hoạt động; Admin cũng không đọc/sửa của người khác. Không có DELETE (tắt là
-- email_enabled = false, không xóa dòng).
create policy notification_preferences_select on public.notification_preferences
  for select to authenticated
  using (user_id = (select auth.uid()) and (select private.is_active_user()));
create policy notification_preferences_insert on public.notification_preferences
  for insert to authenticated
  with check (user_id = (select auth.uid()) and (select private.is_active_user()));
create policy notification_preferences_update on public.notification_preferences
  for update to authenticated
  using (user_id = (select auth.uid()) and (select private.is_active_user()))
  with check (user_id = (select auth.uid()) and (select private.is_active_user()));

-- Đọc tùy chọn của người gọi, ĐỦ mọi loại (điền mặc định cho loại chưa có dòng).
-- SECURITY INVOKER: RLS áp dụng; người bị khóa nhận về rỗng.
create or replace function public.my_notification_preferences()
returns table (type text, email_enabled boolean)
language sql
stable
set search_path = ''
as $$
  select t.type, coalesce(np.email_enabled, private.email_enabled_default(t.type))
  from (values ('task_assigned'), ('task_status_changed')) as t(type)
  left join public.notification_preferences np
    on np.type = t.type and np.user_id = (select auth.uid())
  where (select auth.uid()) is not null
    and (select private.is_active_user())
  order by t.type;
$$;
comment on function public.my_notification_preferences() is
  'Tùy chọn email của người gọi, đủ mọi loại (mặc định cho loại chưa lưu). QLDA-66.';

-- Ghi nhiều loại một lần, nguyên tử: p_prefs = {"task_assigned": true, ...}. SECURITY INVOKER:
-- chỉ cần quyền INSERT(user_id, type, email_enabled) + UPDATE(email_enabled) và RLS chính chủ.
-- Loại lạ → 23514 (CHECK), giá trị không phải boolean → 22023.
create or replace function public.set_my_notification_preferences(p_prefs jsonb)
returns void
language plpgsql
volatile
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_prefs is null or jsonb_typeof(p_prefs) <> 'object' then
    raise exception 'p_prefs must be an object' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_each(p_prefs) e where jsonb_typeof(e.value) <> 'boolean') then
    raise exception 'email_enabled must be boolean' using errcode = '22023';
  end if;
  insert into public.notification_preferences (user_id, type, email_enabled)
  select (select auth.uid()), e.key, e.value::boolean
  from jsonb_each(p_prefs) e
  on conflict (user_id, type) do update set email_enabled = excluded.email_enabled;
end;
$$;
comment on function public.set_my_notification_preferences(jsonb) is
  'Bật/tắt email theo loại cho chính người gọi, nguyên tử (QLDA-66). RLS chính chủ.';

revoke all on function public.my_notification_preferences() from public, anon, authenticated;
revoke all on function public.set_my_notification_preferences(jsonb)
  from public, anon, authenticated;
grant execute on function public.my_notification_preferences() to authenticated;
grant execute on function public.set_my_notification_preferences(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. email_outbox: hàng đợi email (chỉ hệ thống)
-- ---------------------------------------------------------------------------
create table public.email_outbox (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  type text not null,
  task_id uuid not null references public.tasks (id) on delete cascade,
  -- Người giao/người đổi trạng thái (để ghi "người giao" trong email); null nếu do hệ thống.
  actor_id uuid references public.profiles (id) on delete set null,
  status text not null default 'pending',
  attempts smallint not null default 0,
  last_error text,
  next_attempt_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  constraint email_outbox_type_check check (type in ('task_assigned', 'task_status_changed')),
  constraint email_outbox_status_check check (status in ('pending', 'sent', 'failed', 'skipped')),
  constraint email_outbox_attempts_check check (attempts between 0 and 20),
  constraint email_outbox_last_error_check check (char_length(last_error) <= 200),
  constraint email_outbox_sent_at_check check ((status = 'sent') = (sent_at is not null))
);
comment on table public.email_outbox is
  'Hàng đợi email (E4-2). Trigger trên notifications ghi; worker /api/internal/email/dispatch gửi '
  'qua email_outbox_claim/finish. Chỉ service_role đọc; không chứa nội dung email.';
comment on column public.email_outbox.last_error is
  'Mã lỗi ngắn (≤ 200 ký tự), không chứa nội dung email, địa chỉ hay bí mật.';

-- Worker lấy dòng đến hạn (chỉ mục một phần, nhỏ).
create index email_outbox_due_idx on public.email_outbox (next_attempt_at, id)
  where status = 'pending';
-- Quyết định 4: tối đa một dòng pending cho mỗi (người nhận, task, loại).
create unique index email_outbox_pending_key on public.email_outbox (user_id, task_id, type)
  where status = 'pending';
-- Khóa ngoại xóa dây chuyền.
create index email_outbox_task_id_idx on public.email_outbox (task_id);
create index email_outbox_user_id_idx on public.email_outbox (user_id);
create index email_outbox_actor_id_idx on public.email_outbox (actor_id);

revoke all on public.email_outbox from public, anon, authenticated, service_role;
grant select, delete on public.email_outbox to service_role;

alter table public.email_outbox enable row level security;
-- Không có chính sách nào: anon, authenticated không thấy dòng nào (và cũng không có quyền bảng).
-- service_role bỏ qua RLS (BYPASSRLS) nên vẫn đọc được để vận hành.

-- ---------------------------------------------------------------------------
-- 3. Trigger: thông báo mới → hàng đợi email (quyết định 2, 3, 4)
-- ---------------------------------------------------------------------------
create or replace function private.enqueue_notification_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.email_outbox (user_id, type, task_id, actor_id)
  select n.user_id, n.type, n.task_id,
         -- actor_id trong payload là id người làm (E4-1); chỉ giữ nếu hồ sơ còn tồn tại.
         (select p.id from public.profiles p where p.id = (n.payload ->> 'actor_id')::uuid)
  from new_rows n
  where n.type in ('task_assigned', 'task_status_changed')
    and n.user_id is distinct from (n.payload ->> 'actor_id')::uuid
    and private.email_enabled_for(n.user_id, n.type)
  on conflict (user_id, task_id, type) where status = 'pending' do nothing;
  return null;
end;
$$;

create trigger enqueue_notification_email
  after insert on public.notifications
  referencing new table as new_rows
  for each statement execute function private.enqueue_notification_email();

revoke all on function private.enqueue_notification_email()
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Hàm cho worker (chỉ service_role)
-- ---------------------------------------------------------------------------
-- Nhận tối đa p_limit dòng đến hạn (khóa SKIP LOCKED, hai worker song song không lấy trùng):
--   * quá p_max_attempts lần (worker chết giữa chừng nhiều lần) → failed 'max_attempts';
--   * chờ quá 24 giờ → skipped 'expired';
--   * người nhận không còn hợp lệ (quyết định 5) → skipped 'recipient_not_eligible';
--   * còn lại: attempts + 1, giữ 5 phút (lease), trả đủ dữ liệu dựng email.
-- Chỉ dòng hợp lệ mới trả địa chỉ, tên, tiêu đề ra khỏi CSDL.
create or replace function public.email_outbox_claim(
  p_limit integer default 20,
  p_max_attempts integer default 4
)
returns table (
  id uuid,
  type text,
  task_id uuid,
  project_id uuid,
  attempts integer,
  recipient_email text,
  recipient_locale text,
  recipient_name text,
  task_title text,
  project_name text,
  status_name text,
  actor_name text
)
language sql
volatile
security definer
set search_path = ''
as $$
  with picked as (
    select o.id,
           case
             when o.attempts >= greatest(p_max_attempts, 1) then 'max_attempts'
             when o.created_at < now() - interval '24 hours' then 'expired'
             when not (
               p.is_active
               and coalesce(btrim(p.email), '') <> ''
               and private.notification_recipient_ok(o.user_id, t.project_id)
               and (o.type <> 'task_assigned' or t.assignee_id = o.user_id)
             ) then 'recipient_not_eligible'
           end as reason
    from public.email_outbox o
    join public.tasks t on t.id = o.task_id
    join public.profiles p on p.id = o.user_id
    where o.status = 'pending'
      and o.next_attempt_at <= now()
    order by o.next_attempt_at, o.id
    limit least(greatest(coalesce(p_limit, 20), 1), 100)
    for update of o skip locked
  ),
  dropped as (
    update public.email_outbox o
    set status = case when k.reason = 'max_attempts' then 'failed' else 'skipped' end,
        last_error = k.reason
    from picked k
    where o.id = k.id and k.reason is not null
    returning o.id
  ),
  claimed as (
    update public.email_outbox o
    set attempts = o.attempts + 1,
        next_attempt_at = now() + interval '5 minutes'
    from picked k
    where o.id = k.id and k.reason is null
    returning o.id, o.type, o.task_id, o.user_id, o.actor_id, o.attempts
  )
  select c.id, c.type, c.task_id, t.project_id, c.attempts::integer,
         btrim(p.email), p.locale, p.full_name, t.title, pr.name, s.name, a.full_name
  from claimed c
  join public.tasks t on t.id = c.task_id
  join public.projects pr on pr.id = t.project_id
  join public.task_statuses s on s.id = t.status_id
  join public.profiles p on p.id = c.user_id
  left join public.profiles a on a.id = c.actor_id
  order by c.id;
$$;
comment on function public.email_outbox_claim(integer, integer) is
  'Worker email (QLDA-66): nhận dòng đến hạn, kiểm quyền người nhận lúc gửi. Chỉ service_role.';

-- Ghi kết quả một lần gửi: p_ok → sent; lỗi có p_retry_at → pending (thử lại lúc đó); lỗi không
-- có p_retry_at → failed. Chỉ áp cho dòng đang pending; trả về false nếu không có dòng nào đổi.
create or replace function public.email_outbox_finish(
  p_id uuid,
  p_ok boolean,
  p_error text default null,
  p_retry_at timestamptz default null
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.email_outbox o
  set status = case when p_ok then 'sent' when p_retry_at is null then 'failed' else 'pending' end,
      sent_at = case when p_ok then now() end,
      last_error = case when p_ok then null else left(coalesce(p_error, 'unknown'), 200) end,
      next_attempt_at = case when not p_ok and p_retry_at is not null
                             then p_retry_at else o.next_attempt_at end
  where o.id = p_id and o.status = 'pending';
  get diagnostics v_count = row_count;
  return v_count > 0;
end;
$$;
comment on function public.email_outbox_finish(uuid, boolean, text, timestamptz) is
  'Worker email (QLDA-66): ghi kết quả gửi (sent / thử lại / failed). Chỉ service_role.';

revoke all on function public.email_outbox_claim(integer, integer)
  from public, anon, authenticated, service_role;
revoke all on function public.email_outbox_finish(uuid, boolean, text, timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.email_outbox_claim(integer, integer) to service_role;
grant execute on function public.email_outbox_finish(uuid, boolean, text, timestamptz)
  to service_role;

-- ---------------------------------------------------------------------------
-- 5. Lịch: pg_cron + pg_net (quyết định 8, ADR-003)
-- ---------------------------------------------------------------------------
-- Gọi Route Handler nội bộ khi có việc. URL và bí mật đọc từ Vault (đặt bằng tay ở môi trường thật):
--   select vault.create_secret('https://<app>/api/internal/email/dispatch', 'email_dispatch_url');
--   select vault.create_secret('<CRON_SECRET>', 'email_dispatch_secret');
-- Thiếu một trong hai → không làm gì. Trả về id request pg_net (null nếu không gọi).
create or replace function private.email_dispatch_tick()
returns bigint
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
begin
  if not exists (
    select 1 from public.email_outbox o
    where o.status = 'pending' and o.next_attempt_at <= now()
  ) then
    return null;
  end if;
  select ds.decrypted_secret into v_url
  from vault.decrypted_secrets ds where ds.name = 'email_dispatch_url' limit 1;
  select ds.decrypted_secret into v_secret
  from vault.decrypted_secrets ds where ds.name = 'email_dispatch_secret' limit 1;
  if coalesce(v_url, '') = '' or coalesce(v_secret, '') = '' then
    return null;
  end if;
  return net.http_post(
    url := v_url,
    body := '{}'::jsonb,
    headers := jsonb_build_object(
      'authorization', 'Bearer ' || v_secret,
      'content-type', 'application/json'
    ),
    timeout_milliseconds := 25000
  );
end;
$$;
revoke all on function private.email_dispatch_tick()
  from public, anon, authenticated, service_role;

-- Mỗi phút (pg_cron theo UTC; không phụ thuộc giờ). cron.schedule theo tên là idempotent.
select cron.schedule(
  'qlda-email-dispatch',
  '* * * * *',
  'select private.email_dispatch_tick()'
);
