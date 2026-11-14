-- QLDA-38 (Story E2-2): bảng tasks, ràng buộc ngày (BR-13), người được giao phải thuộc dự án,
-- RLS theo vai trò trong dự án (BR-02, BR-03, BR-10, BR-11). Thiết kế: docs/03-design/database.md
-- mục 2, 3, 4, 5; api-contract.md mục 3.
--
-- Phạm vi cố ý để lại cho Story sau:
--   * type_id, status_id: CHƯA có khóa ngoại vì task_types, task_statuses thuộc Story E2-3
--     (migration E2-3 thêm bảng rồi thêm khóa ngoại và ràng buộc "status_id cùng project_id").
--     Trình duyệt chưa được ghi hai cột này (không có quyền cột) để không sinh dữ liệu rác làm
--     hỏng bước thêm khóa ngoại.
--   * parent_id, depth: có cột, CHƯA có trigger subtask (Story E2-4). Trình duyệt chưa được ghi
--     hai cột này; E2-4 thêm trigger rồi cấp quyền cột.
--   * completed_at: đặt theo trạng thái nhóm `done` (E2-3).
--   * Nhật ký activity_logs: Story E6-1.

-- ---------------------------------------------------------------------------
-- 1. Bảng
-- ---------------------------------------------------------------------------
create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  parent_id uuid references public.tasks (id) on delete cascade,
  depth smallint not null default 1,
  type_id uuid,
  title text not null,
  description text,
  assignee_id uuid references public.profiles (id) on delete set null,
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  priority public.task_priority not null default 'medium',
  start_date date,
  due_date date,
  status_id uuid,
  -- Thứ tự trong cột Kanban. Số thực để kéo thả chèn giữa hai task mà không đánh số lại cả cột.
  position double precision not null default 0,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tasks_title_length check (char_length(btrim(title)) between 1 and 500),
  constraint tasks_description_length check (description is null or char_length(description) <= 10000),
  constraint tasks_depth_range check (depth between 1 and 3),
  constraint tasks_parent_not_self check (parent_id is null or parent_id <> id),
  constraint tasks_position_finite check (position > '-Infinity'::float8 and position < 'Infinity'::float8),  -- NaN lớn hơn mọi số trong Postgres nên cũng bị loại.
  -- BR-13: ngày kết thúc không sớm hơn ngày bắt đầu.
  constraint tasks_dates_check check (start_date is null or due_date is null or start_date <= due_date)
);
comment on table public.tasks is
  'Task của dự án (FR-05). Chỉ thành viên dự án và Admin thấy (BR-10); quyền sửa theo BR-03.';
comment on column public.tasks.type_id is 'Loại task; khóa ngoại tới task_types thêm ở Story E2-3.';
comment on column public.tasks.status_id is 'Trạng thái; khóa ngoại tới task_statuses thêm ở Story E2-3.';
comment on column public.tasks.depth is 'Cấp subtask 1-3; trigger tính depth thêm ở Story E2-4.';

-- ---------------------------------------------------------------------------
-- 2. Chỉ mục (database.md mục 4)
-- ---------------------------------------------------------------------------
create index tasks_project_status_position_idx on public.tasks (project_id, status_id, position);
create index tasks_project_assignee_idx on public.tasks (project_id, assignee_id);
create index tasks_project_due_date_idx on public.tasks (project_id, due_date);
create index tasks_parent_id_idx on public.tasks (parent_id);
-- Danh sách mặc định của API (mới nhất trước, phân trang con trỏ theo created_at, id).
create index tasks_project_created_idx on public.tasks (project_id, created_at desc, id desc);

-- ---------------------------------------------------------------------------
-- 3. Trigger
-- ---------------------------------------------------------------------------
create trigger set_updated_at before update on public.tasks
  for each row execute function public.set_updated_at();

-- Người được giao việc phải là PM hoặc Thành viên đang hoạt động của chính dự án đó (Người xem chỉ
-- đọc theo BR-02 nên không nhận việc). Kiểm ở trigger để áp dụng cho mọi đường ghi, kể cả
-- service_role. SECURITY DEFINER để đọc project_members/profiles không phụ thuộc RLS của người gọi.
-- Lỗi P0001 với thông điệp máy đọc `assignee_not_member`; API ánh xạ sang 422.
create or replace function private.check_task_assignee()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.assignee_id is not null and not exists (
    select 1
    from public.project_members m
    join public.profiles p on p.id = m.user_id
    where m.project_id = new.project_id
      and m.user_id = new.assignee_id
      and m.role in ('pm', 'member')
      and p.is_active
  ) then
    raise exception 'assignee_not_member' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke all on function private.check_task_assignee() from public, anon, authenticated;

create trigger check_assignee
  before insert or update of assignee_id, project_id on public.tasks
  for each row execute function private.check_task_assignee();

-- ---------------------------------------------------------------------------
-- 4. Quyền bảng (GRANT) — lớp ngoài của RLS
-- ---------------------------------------------------------------------------
-- Thu quyền mặc định của Supabase rồi cấp theo cột. Không có quyền cột: id (mặc định),
-- created_by (luôn auth.uid()), project_id khi sửa (không chuyển task sang dự án khác),
-- parent_id/depth (E2-4), type_id/status_id (E2-3), completed_at (E2-3), created_at, updated_at.
revoke all on public.tasks from anon, authenticated;
grant select, delete on public.tasks to authenticated;
grant insert (project_id, title, description, assignee_id, priority, start_date, due_date, position)
  on public.tasks to authenticated;
grant update (title, description, assignee_id, priority, start_date, due_date, position)
  on public.tasks to authenticated;

-- ---------------------------------------------------------------------------
-- 5. RLS (database.md mục 5; api-contract.md mục 3)
-- ---------------------------------------------------------------------------
-- is_admin() và project_role_of() đều trả false/null với người bị khóa, nên người bị khóa và
-- người ngoài dự án không có quyền gì.
alter table public.tasks enable row level security;

-- Đọc: mọi vai trò trong dự án và Admin.
create policy tasks_select on public.tasks
  for select to authenticated
  using ((select private.is_admin()) or private.project_role_of(project_id) is not null);

-- Tạo: PM, Thành viên của dự án và Admin; Người xem không (BR-02). Người tạo luôn là chính mình.
create policy tasks_insert on public.tasks
  for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and (
      (select private.is_admin())
      or private.project_role_of(project_id) in ('pm', 'member')
    )
  );

-- Sửa: PM và Admin mọi task trong dự án; Thành viên chỉ task mình phụ trách hoặc tạo (BR-03).
-- WITH CHECK giống USING: Thành viên chỉ là người phụ trách (không phải người tạo) không giao
-- task đi cho người khác được, vì sau khi sửa họ không còn quyền với task.
create policy tasks_update on public.tasks
  for update to authenticated
  using (
    (select private.is_admin())
    or private.project_role_of(project_id) = 'pm'
    or (
      private.project_role_of(project_id) = 'member'
      and (assignee_id = (select auth.uid()) or created_by = (select auth.uid()))
    )
  )
  with check (
    (select private.is_admin())
    or private.project_role_of(project_id) = 'pm'
    or (
      private.project_role_of(project_id) = 'member'
      and (assignee_id = (select auth.uid()) or created_by = (select auth.uid()))
    )
  );

-- Xóa vĩnh viễn (BR-11): PM và Admin; Thành viên chỉ task mình tạo.
create policy tasks_delete on public.tasks
  for delete to authenticated
  using (
    (select private.is_admin())
    or private.project_role_of(project_id) = 'pm'
    or (
      private.project_role_of(project_id) = 'member'
      and created_by = (select auth.uid())
    )
  );
