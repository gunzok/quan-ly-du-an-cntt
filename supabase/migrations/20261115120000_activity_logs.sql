-- QLDA-49 (Story E6-1): nhật ký mọi thay đổi dự án, thành viên dự án, task (FR-16), chỉ thêm,
-- không ai sửa hay xóa được (BR-09); chống chối bỏ thao tác (security.md, STRIDE Repudiation).
-- Thiết kế: docs/03-design/database.md mục 2 (activity_logs), 4 (chỉ mục), 5 (RLS).
--
-- Quyết định:
--   1. Ghi bằng trigger AFTER INSERT/UPDATE/DELETE trên projects, project_members, tasks (không ở
--      lớp ứng dụng): mọi đường ghi (API, client trình duyệt qua PostgREST, service_role, trigger
--      khác, xóa dây chuyền) đều để lại dấu vết, đường ghi mới thêm sau này không thể bỏ sót.
--      Trigger cùng transaction với thay đổi: thay đổi bị rollback thì nhật ký cũng không còn.
--   2. Người làm = auth.uid(); null khi thay đổi đến từ hệ thống (service_role, migration, cron).
--   3. changes = {before, after}: tạo mới thì before = null, after = cả dòng; xóa thì before = cả
--      dòng, after = null; sửa thì chỉ các cột đã đổi. Bỏ qua updated_at, created_at (thời điểm
--      đã có ở activity_logs.created_at) và position (kéo thả Kanban, nhiễu). Sửa mà không còn cột
--      nào đổi (gửi lại giá trị cũ, chỉ kéo thả) thì KHÔNG ghi dòng nào.
--   4. KHÔNG có khóa ngoại tới projects/profiles: khóa ngoại sẽ hoặc chặn xóa dự án/người dùng, hoặc
--      xóa dây chuyền / đặt null trên nhật ký (tức là sửa/xóa nhật ký, phá BR-09). project_id,
--      actor_id, entity_id chỉ lưu để tham chiếu; dự án bị xóa vĩnh viễn vẫn còn nhật ký (kể cả
--      bản ghi xóa task theo dây chuyền), chỉ Admin còn đọc được vì không còn PM.
--   5. Không ai sửa, xóa, TRUNCATE được, kể cả service_role và chủ bảng: (a) không GRANT
--      UPDATE/DELETE/TRUNCATE/INSERT cho anon, authenticated, service_role; (b) RLS chỉ có chính
--      sách SELECT; (c) trigger BEFORE UPDATE/DELETE/TRUNCATE luôn từ chối; (d) trigger BEFORE
--      INSERT chỉ nhận dòng do trigger ghi nhật ký chèn (không giả mạo nhật ký bằng INSERT tay).
--      Chỉ siêu người dùng cố ý tắt trigger (ALTER TABLE ... DISABLE TRIGGER, cần migration và
--      người duyệt) mới vượt được, ví dụ để dọn theo thời hạn lưu trữ khi được chốt.
--   6. Các bảng nguồn không có trường nhạy cảm (mật khẩu, token ở auth.users; số điện thoại ở
--      profile_contacts) nên ghi cả dòng; bảng mới gắn trigger phải xem lại danh sách cột bỏ qua.

-- ---------------------------------------------------------------------------
-- 1. Bảng
-- ---------------------------------------------------------------------------
create table public.activity_logs (
  -- Số tăng dần: thứ tự ổn định cho phân trang con trỏ (created_at là thời điểm transaction nên
  -- nhiều dòng trong cùng transaction trùng created_at).
  id bigint generated always as identity primary key,
  project_id uuid not null,
  actor_id uuid,
  entity_type text not null,
  entity_id uuid not null,
  action text not null,
  changes jsonb not null,
  created_at timestamptz not null default now(),
  constraint activity_logs_entity_type_check
    check (entity_type in ('project', 'project_member', 'task')),
  constraint activity_logs_action_check check (action in ('create', 'update', 'delete')),
  constraint activity_logs_changes_shape check (
    jsonb_typeof(changes) = 'object' and changes ? 'before' and changes ? 'after'
  )
);
comment on table public.activity_logs is
  'Nhật ký thay đổi (FR-16). Chỉ trigger private.log_activity ghi; không ai sửa hay xóa (BR-09). '
  'Không có khóa ngoại để nhật ký còn sau khi dự án, người dùng bị xóa.';
comment on column public.activity_logs.project_id is
  'Dự án của thay đổi (với entity_type = project là chính dự án). Không khóa ngoại.';
comment on column public.activity_logs.actor_id is
  'Người làm (auth.uid()); null nếu do hệ thống. Không khóa ngoại: người đã xóa vẫn giữ id.';
comment on column public.activity_logs.entity_id is
  'id của task/dự án; với project_member là user_id của thành viên.';
comment on column public.activity_logs.changes is
  '{before, after}: tạo thì before null, xóa thì after null, sửa thì chỉ các cột đã đổi.';

-- ---------------------------------------------------------------------------
-- 2. Chỉ mục
-- ---------------------------------------------------------------------------
-- Nhật ký dự án, mới nhất trước, phân trang con trỏ (E6-2).
create index activity_logs_project_created_idx
  on public.activity_logs (project_id, created_at desc, id desc);
-- Lịch sử của một task/dự án.
create index activity_logs_entity_created_idx
  on public.activity_logs (entity_type, entity_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 3. Bất biến (BR-09): chặn ở mức CSDL cho mọi vai trò, kể cả service_role và chủ bảng
-- ---------------------------------------------------------------------------
-- Hai hàm dưới không đọc bảng nào; SECURITY DEFINER chỉ để theo quy ước mọi hàm trong private
-- (rls-profiles.test.sql kiểm), không mở rộng quyền.
create or replace function private.activity_logs_immutable()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'activity_logs_immutable'
    using errcode = '42501',
          detail = format('%s trên activity_logs bị từ chối: nhật ký chỉ thêm (BR-09).', tg_op);
end;
$$;
revoke all on function private.activity_logs_immutable() from public, anon, authenticated;

create trigger no_update_delete
  before update or delete on public.activity_logs
  for each row execute function private.activity_logs_immutable();
create trigger no_truncate
  before truncate on public.activity_logs
  for each statement execute function private.activity_logs_immutable();

-- Chỉ nhận dòng do trigger ghi nhật ký chèn: lúc đó đang ở trigger lồng nhau (độ sâu ≥ 2: trigger
-- AFTER của bảng nguồn, rồi trigger BEFORE INSERT này). INSERT trực tiếp có độ sâu 1.
create or replace function private.activity_logs_insert_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if pg_trigger_depth() < 2 then
    raise exception 'activity_logs_insert_forbidden'
      using errcode = '42501',
            detail = 'Nhật ký chỉ được ghi bởi trigger của bảng nguồn.';
  end if;
  return new;
end;
$$;
revoke all on function private.activity_logs_insert_guard() from public, anon, authenticated;

create trigger insert_only_from_trigger
  before insert on public.activity_logs
  for each row execute function private.activity_logs_insert_guard();

-- ---------------------------------------------------------------------------
-- 4. Ghi nhật ký
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER: người gọi không có quyền INSERT vào activity_logs. search_path rỗng.
create or replace function private.log_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- Cột không đưa vào changes (xem quyết định 3).
  v_ignored constant text[] := array['created_at', 'updated_at', 'position'];
  v_row jsonb;
  v_old jsonb;
  v_new jsonb;
  v_before jsonb;
  v_after jsonb;
  v_key text;
  v_entity_type text;
  v_entity_id uuid;
  v_project_id uuid;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    v_old := to_jsonb(old);
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    v_new := to_jsonb(new);
  end if;
  v_row := coalesce(v_new, v_old);

  case tg_table_name
    when 'tasks' then
      v_entity_type := 'task';
      v_entity_id := (v_row ->> 'id')::uuid;
      v_project_id := (v_row ->> 'project_id')::uuid;
    when 'projects' then
      v_entity_type := 'project';
      v_entity_id := (v_row ->> 'id')::uuid;
      v_project_id := v_entity_id;
    when 'project_members' then
      v_entity_type := 'project_member';
      v_entity_id := (v_row ->> 'user_id')::uuid;
      v_project_id := (v_row ->> 'project_id')::uuid;
    else
      raise exception 'log_activity: bảng % chưa được hỗ trợ', tg_table_name;
  end case;

  if tg_op = 'UPDATE' then
    for v_key in select jsonb_object_keys(v_new) loop
      if not (v_key = any (v_ignored)) and (v_new -> v_key) is distinct from (v_old -> v_key) then
        v_before := coalesce(v_before, '{}'::jsonb) || jsonb_build_object(v_key, v_old -> v_key);
        v_after := coalesce(v_after, '{}'::jsonb) || jsonb_build_object(v_key, v_new -> v_key);
      end if;
    end loop;
    if v_after is null then
      return null;  -- Không có thay đổi đáng ghi.
    end if;
  else
    v_before := v_old - v_ignored;
    v_after := v_new - v_ignored;
  end if;

  insert into public.activity_logs (project_id, actor_id, entity_type, entity_id, action, changes)
  values (
    v_project_id,
    auth.uid(),
    v_entity_type,
    v_entity_id,
    case tg_op when 'INSERT' then 'create' when 'UPDATE' then 'update' else 'delete' end,
    jsonb_build_object('before', v_before, 'after', v_after)
  );
  return null;
end;
$$;
revoke all on function private.log_activity() from public, anon, authenticated;

-- Tên trigger "activity_log" xếp trước "add_creator_as_pm" (Postgres chạy trigger cùng loại theo
-- tên) nên bản ghi tạo dự án có id nhỏ hơn bản ghi người tạo thành PM.
create trigger activity_log
  after insert or update or delete on public.projects
  for each row execute function private.log_activity();
create trigger activity_log
  after insert or update or delete on public.project_members
  for each row execute function private.log_activity();
create trigger activity_log
  after insert or update or delete on public.tasks
  for each row execute function private.log_activity();

-- ---------------------------------------------------------------------------
-- 5. Quyền bảng (GRANT) — lớp ngoài của RLS
-- ---------------------------------------------------------------------------
-- Supabase mặc định GRANT ALL cho anon, authenticated, service_role trên bảng mới; thu hết. Chỉ
-- cấp SELECT (RLS lọc tiếp với authenticated; service_role bỏ qua RLS nhưng chỉ đọc được).
revoke all on public.activity_logs from public, anon, authenticated, service_role;
grant select on public.activity_logs to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. RLS: PM của dự án và Admin đọc; Thành viên, Người xem, người ngoài, người bị khóa không.
--    Không có chính sách INSERT/UPDATE/DELETE cho bất kỳ vai trò nào.
-- ---------------------------------------------------------------------------
alter table public.activity_logs enable row level security;

create policy activity_logs_select on public.activity_logs
  for select to authenticated
  using ((select private.is_admin()) or private.project_role_of(project_id) = 'pm');
