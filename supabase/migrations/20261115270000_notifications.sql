-- QLDA-59 (Story E4-1): thông báo trong app (FR-11). Bảng notifications, RLS chỉ chủ sở hữu, trigger
-- hệ thống tạo thông báo khi task được giao và khi task đổi trạng thái.
-- Thiết kế: docs/03-design/database.md mục 2 (notifications), 4 (chỉ mục), 5 (RLS), 7 (lưu trữ);
-- api-contract.md mục 3 (GET /notifications, POST /notifications/{id}/read).
--
-- Quyết định:
--   1. Chỉ hệ thống tạo thông báo: KHÔNG GRANT INSERT cho anon, authenticated, service_role, không có
--      chính sách INSERT; dòng chỉ sinh ra từ trigger SECURITY DEFINER (chủ hàm là postgres) trên
--      tasks. Story sau (nhắc hạn E4-3, pg_cron) cũng tạo bằng hàm SECURITY DEFINER.
--   2. Đọc, đánh dấu đã đọc: CHỈ người nhận (user_id = auth.uid()) và đang hoạt động. Admin, PM
--      cũng không đọc được thông báo của người khác. Trình duyệt chỉ có quyền cột UPDATE (read_at);
--      không có DELETE (dọn theo thời hạn lưu trữ là việc của job hệ thống, xem quyết định 8).
--   3. Khi nào tạo (người làm = auth.uid(), null nếu do hệ thống):
--        task_assigned       tạo task có người phụ trách, hoặc assignee_id đổi sang người khác; gửi
--                            cho người được giao, TRỪ khi người đó chính là người làm.
--        task_status_changed status_id đổi; gửi cho người phụ trách và người tạo (gộp trùng), trừ
--                            người làm. Người vừa được giao trong CÙNG lệnh UPDATE (đổi người phụ
--                            trách và trạng thái một lúc) chỉ nhận task_assigned, không nhận thêm.
--      Người nhận phải đang hoạt động và còn đọc được task lúc tạo (thành viên dự án hoặc Admin):
--      người tạo task đã rời dự án không nhận thông báo (không lưu tiêu đề task cho người hết quyền).
--      Đổi trạng thái hàng loạt (xóa trạng thái có replace_with) cũng là đổi trạng thái thật nên vẫn
--      tạo thông báo cho từng task.
--   4. Trigger MỨC CÂU LỆNH với bảng chuyển tiếp (transition table): một lệnh INSERT ... SELECT cho
--      cả lô, không lặp từng dòng, không mở giao dịch con. Cùng transaction với thay đổi gốc như
--      activity_logs: thay đổi bị rollback thì thông báo cũng không còn.
--   5. Lỗi khi tạo thông báo KHÔNG được nuốt (không có khối EXCEPTION): (a) khối EXCEPTION mở một
--      giao dịch con cho mỗi lần chạy, (b) hàm đã loại trước mọi lỗi phụ thuộc dữ liệu (tiêu đề cắt
--      ngắn, người nhận lọc theo profiles nên khóa ngoại luôn đúng, payload luôn đúng hình dạng), nên
--      lỗi còn lại chỉ có thể là lỗi lập trình hoặc CSDL hỏng: phải lộ ra ở test và CI thay vì âm
--      thầm làm mất thông báo. Đánh đổi: nếu có lỗi như vậy thì thao tác sửa task cũng lỗi.
--   6. payload nhỏ, không dữ liệu nhạy cảm: {title (≤ 80 ký tự, cắt kèm "…"), actor_id, status_name
--      (≤ 60, chỉ task_status_changed)}. Không mô tả, không email. CHECK hình dạng và ≤ 1 KB. Khi hiển
--      thị, API LUÔN kiểm lại quyền đọc task bằng phiên người nhận (RLS tasks); task không còn thấy
--      thì chỉ trả phần trung tính (loại, thời điểm), bỏ tiêu đề, trạng thái, người làm.
--   7. Khóa ngoại: user_id → profiles, task_id → tasks, project_id → projects đều ON DELETE CASCADE
--      (task bị xóa thì thông báo về nó cũng đi, không để lại tiêu đề của task đã xóa). actor_id nằm
--      trong payload, không khóa ngoại.
--   8. Thời hạn lưu (database.md mục 7, [CẦN XÁC NHẬN]): đề xuất xóa thông báo ĐÃ ĐỌC sau 90 ngày bằng
--      job hệ thống (pg_cron, ADR-003). Chưa làm job ở Story này; chỉ mục notifications_user_created_idx
--      phục vụ được lệnh dọn theo (read_at, created_at).

-- ---------------------------------------------------------------------------
-- 1. Bảng
-- ---------------------------------------------------------------------------
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  type text not null,
  task_id uuid not null references public.tasks (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  constraint notifications_type_check check (type in ('task_assigned', 'task_status_changed')),
  constraint notifications_payload_shape check (
    jsonb_typeof(payload) = 'object'
    and octet_length(payload::text) <= 1024
    and payload - array['title', 'actor_id', 'status_name'] = '{}'::jsonb
    and (not payload ? 'title' or jsonb_typeof(payload -> 'title') = 'string')
    and (not payload ? 'status_name' or jsonb_typeof(payload -> 'status_name') = 'string')
    and (not payload ? 'actor_id' or jsonb_typeof(payload -> 'actor_id') in ('string', 'null'))
  )
);
comment on table public.notifications is
  'Thông báo trong app (FR-11, E4-1). Chỉ hệ thống tạo (trigger private.notify_task_*); chỉ người '
  'nhận đọc và đánh dấu đã đọc. Đề xuất dọn thông báo đã đọc sau 90 ngày (chưa có job).';
comment on column public.notifications.payload is
  '{title ≤ 80 ký tự, actor_id, status_name ≤ 60}. Không chứa mô tả hay email; khi hiển thị phải '
  'kiểm lại quyền đọc task.';
comment on column public.notifications.read_at is 'Thời điểm đánh dấu đã đọc; null = chưa đọc.';

-- ---------------------------------------------------------------------------
-- 2. Chỉ mục
-- ---------------------------------------------------------------------------
-- Danh sách của tôi, mới nhất trước, phân trang con trỏ (created_at, id).
create index notifications_user_created_idx
  on public.notifications (user_id, created_at desc, id desc);
-- Số chưa đọc cho chuông và lọc ?unread=true (chỉ mục một phần, nhỏ).
create index notifications_user_unread_idx
  on public.notifications (user_id, created_at desc, id desc)
  where read_at is null;
-- Khóa ngoại xóa dây chuyền khi xóa task, dự án.
create index notifications_task_id_idx on public.notifications (task_id);
create index notifications_project_id_idx on public.notifications (project_id);

-- ---------------------------------------------------------------------------
-- 3. Hàm hỗ trợ
-- ---------------------------------------------------------------------------
-- Cắt chuỗi hiển thị trong payload: bỏ khoảng trắng đầu cuối, tối đa p_max ký tự (kể cả "…").
-- Hàm thuần; SECURITY DEFINER theo quy ước schema private (rls-profiles.test.sql kiểm).
create or replace function private.notification_text(p_text text, p_max integer)
returns text
language sql
immutable
security definer
set search_path = ''
as $$
  select case
    when p_text is null then null
    when char_length(btrim(p_text)) <= p_max then btrim(p_text)
    else left(btrim(p_text), p_max - 1) || '…'
  end;
$$;

-- Người nhận hợp lệ: đang hoạt động và còn đọc được task của dự án (thành viên hoặc Admin).
create or replace function private.notification_recipient_ok(p_user_id uuid, p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = p_user_id
      and p.is_active
      and (
        p.is_admin
        or exists (
          select 1 from public.project_members m
          where m.project_id = p_project_id and m.user_id = p.id
        )
      )
  );
$$;

-- ---------------------------------------------------------------------------
-- 4. Trigger tạo thông báo (quyết định 3, 4, 5)
-- ---------------------------------------------------------------------------
-- Tạo task: thông báo người được giao (nếu không phải chính người tạo).
create or replace function private.notify_task_inserted()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
begin
  insert into public.notifications (user_id, type, task_id, project_id, payload)
  select n.assignee_id, 'task_assigned', n.id, n.project_id,
         jsonb_build_object('title', private.notification_text(n.title, 80), 'actor_id', v_actor)
  from new_rows n
  where n.assignee_id is not null
    and n.assignee_id is distinct from v_actor
    and private.notification_recipient_ok(n.assignee_id, n.project_id);
  return null;
end;
$$;

-- Sửa task: đổi người phụ trách → task_assigned; đổi trạng thái → task_status_changed.
create or replace function private.notify_task_updated()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
begin
  insert into public.notifications (user_id, type, task_id, project_id, payload)
  select n.assignee_id, 'task_assigned', n.id, n.project_id,
         jsonb_build_object('title', private.notification_text(n.title, 80), 'actor_id', v_actor)
  from new_rows n
  join old_rows o on o.id = n.id
  where n.assignee_id is not null
    and n.assignee_id is distinct from o.assignee_id
    and n.assignee_id is distinct from v_actor
    and private.notification_recipient_ok(n.assignee_id, n.project_id);

  insert into public.notifications (user_id, type, task_id, project_id, payload)
  select distinct on (n.id, r.user_id)
         r.user_id, 'task_status_changed', n.id, n.project_id,
         jsonb_build_object(
           'title', private.notification_text(n.title, 80),
           'actor_id', v_actor,
           'status_name', private.notification_text(s.name, 60)
         )
  from new_rows n
  join old_rows o on o.id = n.id
  join public.task_statuses s on s.id = n.status_id
  cross join lateral (values (n.assignee_id), (n.created_by)) as r(user_id)
  where n.status_id is distinct from o.status_id
    and r.user_id is not null
    and r.user_id is distinct from v_actor
    -- Vừa được giao trong cùng lệnh: đã có task_assigned ở trên.
    and not (r.user_id = n.assignee_id and n.assignee_id is distinct from o.assignee_id)
    and private.notification_recipient_ok(r.user_id, n.project_id);
  return null;
end;
$$;

-- Bảng chuyển tiếp không đi được với danh sách cột (UPDATE OF ...), nên trigger UPDATE chạy cho mọi
-- lệnh UPDATE trên tasks và tự lọc dòng có assignee_id/status_id đổi.
create trigger notify_task_inserted
  after insert on public.tasks
  referencing new table as new_rows
  for each statement execute function private.notify_task_inserted();
create trigger notify_task_updated
  after update on public.tasks
  referencing old table as old_rows new table as new_rows
  for each statement execute function private.notify_task_updated();

revoke all on function
  private.notification_text(text, integer),
  private.notification_recipient_ok(uuid, uuid),
  private.notify_task_inserted(),
  private.notify_task_updated()
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. Đọc payload có kiểm quyền đọc task (quyết định 6, lớp CSDL)
-- ---------------------------------------------------------------------------
-- Trình duyệt KHÔNG có quyền cột SELECT payload (mục 6), nên kể cả gọi thẳng PostgREST cũng không
-- đọc được tiêu đề task của thông báo khi đã mất quyền đọc task (bị gỡ khỏi dự án). payload chỉ
-- đọc qua hàm dưới: chỉ thông báo của chính mình, đang hoạt động, VÀ còn đọc được task
-- (private.can_read_task, trùng điều kiện RLS tasks_select). Dòng không đạt thì không trả về, API
-- hiển thị bản trung tính. Tối đa 100 id mỗi lần gọi.
create or replace function private.notification_payloads(p_ids uuid[])
returns table (id uuid, payload jsonb)
language sql
stable
security definer
set search_path = ''
as $$
  select n.id, n.payload
  from public.notifications n
  where n.id = any (p_ids[1:100])
    and n.user_id = auth.uid()
    and private.is_active_user()
    and private.can_read_task(n.task_id);
$$;
revoke all on function private.notification_payloads(uuid[]) from public, anon, authenticated;
grant execute on function private.notification_payloads(uuid[]) to authenticated;

-- Cửa vào qua PostgREST (schema public), SECURITY INVOKER: chỉ chuyển tiếp.
create or replace function public.notification_payloads(p_ids uuid[])
returns table (id uuid, payload jsonb)
language sql
stable
set search_path = ''
as $$
  select p.id, p.payload from private.notification_payloads(p_ids) p;
$$;
comment on function public.notification_payloads(uuid[]) is
  'payload thông báo của người gọi, chỉ khi còn đọc được task (QLDA-59). Tối đa 100 id.';
revoke all on function public.notification_payloads(uuid[]) from public, anon, authenticated;
grant execute on function public.notification_payloads(uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Quyền bảng (GRANT) — lớp ngoài của RLS
-- ---------------------------------------------------------------------------
-- Supabase mặc định GRANT ALL cho anon, authenticated, service_role trên bảng mới; thu hết.
-- Trình duyệt đọc mọi cột TRỪ payload (đọc qua public.notification_payloads).
revoke all on public.notifications from public, anon, authenticated, service_role;
grant select (id, user_id, type, task_id, project_id, read_at, created_at)
  on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;
-- service_role: đọc, đánh dấu, xóa (job dọn theo thời hạn lưu trữ sau này); KHÔNG INSERT.
grant select, delete on public.notifications to service_role;
grant update (read_at) on public.notifications to service_role;

-- ---------------------------------------------------------------------------
-- 7. RLS: chỉ người nhận đang hoạt động; không có chính sách INSERT, DELETE cho trình duyệt.
-- ---------------------------------------------------------------------------
alter table public.notifications enable row level security;

create policy notifications_select on public.notifications
  for select to authenticated
  using (user_id = (select auth.uid()) and (select private.is_active_user()));

create policy notifications_update on public.notifications
  for update to authenticated
  using (user_id = (select auth.uid()) and (select private.is_active_user()))
  with check (user_id = (select auth.uid()) and (select private.is_active_user()));
