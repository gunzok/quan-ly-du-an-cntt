-- QLDA-41 (Story E2-3): trạng thái tùy chỉnh, loại task và nhãn theo dự án (FR-06, FR-23).
-- Thiết kế: docs/03-design/database.md mục 2 (task_statuses, task_types, labels, task_labels),
-- mục 3 ("tasks.status_id phải thuộc đúng project_id của task"), mục 5 (RLS); api-contract.md.
--
-- Quyết định:
--   1. Danh sách mặc định (chủ dự án chốt 2026-11-15, theo OpenProject) nằm DUY NHẤT trong
--      private.seed_project_defaults(). Hàm chạy khi tạo dự án mới (trigger AFTER INSERT trên
--      projects) và một lần trong migration này để backfill dự án đã có. Sau đó mỗi dự án tự sửa.
--   2. "Cùng dự án" cho tasks.status_id, tasks.type_id: KHÓA NGOẠI KÉP (project_id, status_id) →
--      task_statuses (project_id, id). Khai báo, không bỏ sót đường ghi nào (kể cả service_role,
--      đổi project_id), Postgres tự kiểm khi xóa trạng thái. Trigger apply_task_config chỉ thêm
--      thông điệp dễ đọc (status_not_in_project → API 422) trước khi khóa ngoại chặn.
--      task_labels không có project_id nên dùng trigger (label_not_in_project).
--   3. status_id, type_id NOT NULL. Task mới không gửi thì trigger lấy trạng thái nhóm todo đầu tiên
--      và loại đầu tiên (theo position) của dự án; mặc định là "Mới" và "Task". Riêng INSERT có sẵn
--      completed_at (nhập dữ liệu, test cũ) thì lấy trạng thái done đầu tiên để giữ bất biến
--      "completed_at có giá trị ⇔ trạng thái thuộc nhóm done".
--   4. completed_at do trigger đặt: vào nhóm done thì giữ giá trị cũ hoặc now(); ra khỏi done thì
--      null. Đổi nhóm của một trạng thái cũng cập nhật mọi task đang ở trạng thái đó. Trình duyệt
--      vẫn không có quyền cột completed_at. public.project_stats() (E2-1) đếm completed_at nên
--      đúng mà không phải sửa.
--   5. Mỗi dự án luôn còn ít nhất một trạng thái todo, một trạng thái done và một loại task
--      (trigger chặn xóa/đổi nhóm cái cuối cùng; xóa dự án thì bỏ qua). Khóa dòng dự án trước khi
--      đếm để hai người xóa cùng lúc không làm về 0.
--   6. Xóa trạng thái/loại đang có task: khóa ngoại chặn. public.delete_task_status() /
--      delete_task_type() (SECURITY INVOKER: RLS vẫn áp dụng) chuyển task sang p_replace_with rồi
--      xóa trong CÙNG giao dịch (AC2); không có thay thế thì báo status_in_use / type_in_use.
--   7. Tên trạng thái, loại, nhãn duy nhất trong dự án, không phân biệt hoa thường và khoảng trắng
--      hai đầu. Màu dạng #RRGGBB (chỉ trang trí, giao diện luôn kèm chữ).
--   8. Quyền: mọi vai trò trong dự án và Admin đọc; PM của dự án và Admin ghi; người ngoài, người
--      bị khóa không có gì. task_labels: đọc theo quyền đọc task, gắn/gỡ theo quyền sửa task (PM,
--      Admin mọi task; Thành viên task mình phụ trách hoặc tạo, BR-03).
--   Chưa làm: quy tắc đóng task cha (BR-04, E2-4); nhật ký cho task_labels/cấu hình (E6-x).

-- ---------------------------------------------------------------------------
-- 1. Kiểu và bảng
-- ---------------------------------------------------------------------------
create type public.task_status_category as enum ('todo', 'in_progress', 'done');

create table public.task_statuses (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  name text not null,
  category public.task_status_category not null,
  color text not null default '#8A93A6',
  -- Thứ tự cột Kanban. Số thực để đổi thứ tự bằng một lệnh (chèn giữa hai trạng thái).
  position double precision not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint task_statuses_name_length check (char_length(btrim(name)) between 1 and 100),
  constraint task_statuses_color_format check (color ~ '^#[0-9A-Fa-f]{6}$'),
  constraint task_statuses_position_finite
    check (position > '-Infinity'::float8 and position < 'Infinity'::float8),
  -- Đích của khóa ngoại kép từ tasks (project_id, status_id).
  constraint task_statuses_project_id_id_key unique (project_id, id)
);
comment on table public.task_statuses is
  'Trạng thái task theo dự án (FR-06); category để tính tiến độ. Luôn còn ít nhất một todo và một done.';
create unique index task_statuses_project_name_ci_key
  on public.task_statuses (project_id, lower(btrim(name)));
create index task_statuses_project_position_idx on public.task_statuses (project_id, position);

create table public.task_types (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  name text not null,
  is_milestone boolean not null default false,
  color text not null default '#2054F0',
  position double precision not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint task_types_name_length check (char_length(btrim(name)) between 1 and 100),
  constraint task_types_color_format check (color ~ '^#[0-9A-Fa-f]{6}$'),
  constraint task_types_position_finite
    check (position > '-Infinity'::float8 and position < 'Infinity'::float8),
  constraint task_types_project_id_id_key unique (project_id, id)
);
comment on table public.task_types is
  'Loại task theo dự án (FR-23); is_milestone đánh dấu mốc. Luôn còn ít nhất một loại.';
create unique index task_types_project_name_ci_key
  on public.task_types (project_id, lower(btrim(name)));
create index task_types_project_position_idx on public.task_types (project_id, position);

create table public.labels (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  name text not null,
  color text not null default '#8A93A6',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint labels_name_length check (char_length(btrim(name)) between 1 and 100),
  constraint labels_color_format check (color ~ '^#[0-9A-Fa-f]{6}$')
);
comment on table public.labels is 'Nhãn theo dự án (FR-06). Tên duy nhất trong dự án, không phân biệt hoa thường.';
create unique index labels_project_name_ci_key on public.labels (project_id, lower(btrim(name)));

create table public.task_labels (
  task_id uuid not null references public.tasks (id) on delete cascade,
  label_id uuid not null references public.labels (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (task_id, label_id)
);
comment on table public.task_labels is 'Nhãn gắn vào task (nhiều-nhiều). Nhãn phải cùng dự án với task.';
create index task_labels_label_id_idx on public.task_labels (label_id);

create trigger set_updated_at before update on public.task_statuses
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.task_types
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.labels
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. Danh sách mặc định: MỘT chỗ duy nhất
-- ---------------------------------------------------------------------------
-- Chỉ thêm khi dự án chưa có trạng thái (hoặc loại) nào, nên gọi lại nhiều lần vẫn an toàn.
create or replace function private.seed_project_defaults(p_project_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.task_statuses (project_id, name, category, color, position)
  select p_project_id, d.name, d.category::public.task_status_category, d.color, d.position
  from (values
    ('Mới',            'todo',        '#8A93A6', 1),
    ('Đang thực hiện', 'in_progress', '#2054F0', 2),
    ('Đang kiểm thử',  'in_progress', '#7C3AED', 3),
    ('Cần phản hồi',   'in_progress', '#D97706', 4),
    ('Đã xong',        'done',        '#137035', 5),
    ('Đã đóng',        'done',        '#4B5563', 6),
    ('Từ chối',        'done',        '#C0262D', 7)
  ) as d (name, category, color, position)
  where not exists (select 1 from public.task_statuses s where s.project_id = p_project_id);

  insert into public.task_types (project_id, name, is_milestone, color, position)
  select p_project_id, d.name, d.is_milestone, d.color, d.position
  from (values
    ('Task',      false, '#2054F0', 1),
    ('Bug',       false, '#C0262D', 2),
    ('Milestone', true,  '#E56DAF', 3),
    ('Phase',     false, '#137035', 4)
  ) as d (name, is_milestone, color, position)
  where not exists (select 1 from public.task_types t where t.project_id = p_project_id);
end;
$$;
revoke all on function private.seed_project_defaults(uuid) from public, anon, authenticated;

create or replace function private.seed_new_project_defaults()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.seed_project_defaults(new.id);
  return null;
end;
$$;
revoke all on function private.seed_new_project_defaults() from public, anon, authenticated;

-- Tên xếp sau "activity_log" và "add_creator_as_pm" (trigger cùng loại chạy theo tên).
create trigger seed_config_defaults
  after insert on public.projects
  for each row execute function private.seed_new_project_defaults();

-- Backfill dự án đã có.
select private.seed_project_defaults(p.id) from public.projects p;

-- ---------------------------------------------------------------------------
-- 3. Backfill task đã có, rồi NOT NULL và khóa ngoại kép (quyết định 2, 3)
-- ---------------------------------------------------------------------------
-- Trình duyệt chưa từng ghi được hai cột này (E2-2 không cấp quyền cột); giá trị không khớp dự án
-- (nếu có từ service_role) cũng được thay bằng mặc định.
update public.tasks t
set status_id = (
  select s.id from public.task_statuses s
  where s.project_id = t.project_id
    and s.category = case when t.completed_at is not null then 'done' else 'todo' end
      ::public.task_status_category
  order by s.position, s.created_at, s.id
  limit 1
)
where t.status_id is null
  or not exists (
    select 1 from public.task_statuses s where s.id = t.status_id and s.project_id = t.project_id
  );

update public.tasks t
set type_id = (
  select ty.id from public.task_types ty
  where ty.project_id = t.project_id
  order by ty.position, ty.created_at, ty.id
  limit 1
)
where t.type_id is null
  or not exists (
    select 1 from public.task_types ty where ty.id = t.type_id and ty.project_id = t.project_id
  );

alter table public.tasks
  alter column status_id set not null,
  alter column type_id set not null,
  add constraint tasks_status_same_project_fkey
    foreign key (project_id, status_id) references public.task_statuses (project_id, id),
  add constraint tasks_type_same_project_fkey
    foreign key (project_id, type_id) references public.task_types (project_id, id);
-- (project_id, status_id) đã có tasks_project_status_position_idx.
create index tasks_project_type_idx on public.tasks (project_id, type_id);

comment on column public.tasks.type_id is
  'Loại task (task_types cùng dự án, khóa ngoại kép). Không gửi: loại đầu tiên của dự án.';
comment on column public.tasks.status_id is
  'Trạng thái (task_statuses cùng dự án, khóa ngoại kép). Không gửi: trạng thái todo đầu tiên.';
comment on column public.tasks.completed_at is
  'Do trigger apply_task_config đặt: có giá trị khi và chỉ khi trạng thái thuộc nhóm done.';

-- ---------------------------------------------------------------------------
-- 4. Trigger trên tasks: mặc định, cùng dự án, completed_at (quyết định 2, 3, 4)
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER để đọc cấu hình không phụ thuộc RLS của người gọi (service_role, trigger khác).
-- Lỗi P0001 status_not_in_project / type_not_in_project: API ánh xạ sang 422.
create or replace function private.apply_task_config()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_category public.task_status_category;
begin
  if new.status_id is null then
    select s.id into new.status_id
    from public.task_statuses s
    where s.project_id = new.project_id
      and s.category = case
        when tg_op = 'INSERT' and new.completed_at is not null then 'done'
        else 'todo'
      end::public.task_status_category
    order by s.position, s.created_at, s.id
    limit 1;
  end if;
  if new.type_id is null then
    select ty.id into new.type_id
    from public.task_types ty
    where ty.project_id = new.project_id
    order by ty.position, ty.created_at, ty.id
    limit 1;
  end if;

  select s.category into v_category
  from public.task_statuses s
  where s.id = new.status_id and s.project_id = new.project_id;
  if v_category is null then
    raise exception 'status_not_in_project' using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from public.task_types ty where ty.id = new.type_id and ty.project_id = new.project_id
  ) then
    raise exception 'type_not_in_project' using errcode = 'P0001';
  end if;

  if v_category = 'done' then
    -- Chuyển giữa hai trạng thái done giữ nguyên thời điểm hoàn thành ban đầu.
    new.completed_at := coalesce(new.completed_at, now());
  else
    new.completed_at := null;
  end if;
  return new;
end;
$$;
revoke all on function private.apply_task_config() from public, anon, authenticated;

create trigger apply_task_config
  before insert or update of status_id, type_id, project_id, completed_at on public.tasks
  for each row execute function private.apply_task_config();

-- Đổi nhóm của một trạng thái: mọi task đang ở trạng thái đó cập nhật completed_at theo nhóm mới.
create or replace function private.sync_tasks_on_status_category()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.tasks t
  set completed_at = case when new.category = 'done' then coalesce(t.completed_at, now()) end
  where t.status_id = new.id;
  return null;
end;
$$;
revoke all on function private.sync_tasks_on_status_category() from public, anon, authenticated;

create trigger sync_task_completion
  after update of category on public.task_statuses
  for each row
  when (old.category is distinct from new.category)
  execute function private.sync_tasks_on_status_category();

-- ---------------------------------------------------------------------------
-- 5. Bất biến: luôn còn một todo, một done, một loại (quyết định 5)
-- ---------------------------------------------------------------------------
create or replace function private.guard_last_task_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.category = old.category then
    return new;
  end if;
  if old.category = 'in_progress' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  -- Khóa dòng dự án: hai giao dịch xóa cùng lúc phải lần lượt đếm. Dự án đang bị xóa (xóa dây
  -- chuyền) thì không còn dòng: cho qua.
  perform 1 from public.projects p where p.id = old.project_id for update;
  if not found then
    return old;
  end if;
  if not exists (
    select 1 from public.task_statuses s
    where s.project_id = old.project_id and s.category = old.category and s.id <> old.id
  ) then
    raise exception 'last_status_of_category'
      using errcode = 'P0001',
            detail = format('Dự án phải còn ít nhất một trạng thái nhóm %s.', old.category);
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
revoke all on function private.guard_last_task_status() from public, anon, authenticated;

create trigger guard_last_status
  before delete or update of category on public.task_statuses
  for each row execute function private.guard_last_task_status();

create or replace function private.guard_last_task_type()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform 1 from public.projects p where p.id = old.project_id for update;
  if not found then
    return old;
  end if;
  if not exists (
    select 1 from public.task_types ty where ty.project_id = old.project_id and ty.id <> old.id
  ) then
    raise exception 'last_task_type' using errcode = 'P0001';
  end if;
  return old;
end;
$$;
revoke all on function private.guard_last_task_type() from public, anon, authenticated;

create trigger guard_last_type
  before delete on public.task_types
  for each row execute function private.guard_last_task_type();

-- ---------------------------------------------------------------------------
-- 6. task_labels: nhãn cùng dự án với task; hàm quyền theo task
-- ---------------------------------------------------------------------------
create or replace function private.check_task_label_project()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.tasks t
    join public.labels l on l.project_id = t.project_id
    where t.id = new.task_id and l.id = new.label_id
  ) then
    raise exception 'label_not_in_project' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke all on function private.check_task_label_project() from public, anon, authenticated;

create trigger check_label_project
  before insert or update on public.task_labels
  for each row execute function private.check_task_label_project();

-- Người đang đăng nhập đọc được task (mọi vai trò trong dự án, Admin). Giống chính sách tasks_select.
-- Story E8-1 (task_relations) định nghĩa đúng hai hàm này với cùng chữ ký, tên tham số và thân hàm:
-- `create or replace` chạy được theo mọi thứ tự merge. Sửa một bên thì phải sửa bên kia.
create or replace function private.can_read_task(target_task_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.tasks t
    where t.id = target_task_id
      and (private.is_admin() or private.project_role_of(t.project_id) is not null)
  );
$$;

-- Người đang đăng nhập sửa được task: giống chính sách tasks_update (BR-03).
create or replace function private.can_edit_task(target_task_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.tasks t
    where t.id = target_task_id
      and (
        private.is_admin()
        or private.project_role_of(t.project_id) = 'pm'
        or (
          private.project_role_of(t.project_id) = 'member'
          and (t.assignee_id = auth.uid() or t.created_by = auth.uid())
        )
      )
  );
$$;
revoke all on function private.can_read_task(uuid), private.can_edit_task(uuid)
  from public, anon, authenticated;
grant execute on function private.can_read_task(uuid), private.can_edit_task(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Quyền bảng (GRANT) — lớp ngoài của RLS
-- ---------------------------------------------------------------------------
-- Không có quyền cột: id, project_id khi sửa (không chuyển sang dự án khác), created_at, updated_at.
revoke all on public.task_statuses, public.task_types, public.labels, public.task_labels
  from anon, authenticated;

grant select, delete on public.task_statuses to authenticated;
grant insert (project_id, name, category, color, position) on public.task_statuses to authenticated;
grant update (name, category, color, position) on public.task_statuses to authenticated;

grant select, delete on public.task_types to authenticated;
grant insert (project_id, name, is_milestone, color, position) on public.task_types to authenticated;
grant update (name, is_milestone, color, position) on public.task_types to authenticated;

grant select, delete on public.labels to authenticated;
grant insert (project_id, name, color) on public.labels to authenticated;
grant update (name, color) on public.labels to authenticated;

-- Gắn/gỡ nhãn; không sửa dòng (gỡ rồi gắn lại).
grant select, delete on public.task_labels to authenticated;
grant insert (task_id, label_id) on public.task_labels to authenticated;

-- tasks: nay trình duyệt ghi được loại và trạng thái (RLS tasks_insert/tasks_update quyết định ai).
-- completed_at vẫn không có quyền cột (trigger đặt).
grant insert (type_id, status_id) on public.tasks to authenticated;
grant update (type_id, status_id) on public.tasks to authenticated;

-- ---------------------------------------------------------------------------
-- 8. RLS
-- ---------------------------------------------------------------------------
alter table public.task_statuses enable row level security;
alter table public.task_types enable row level security;
alter table public.labels enable row level security;
alter table public.task_labels enable row level security;

create policy task_statuses_select on public.task_statuses
  for select to authenticated
  using ((select private.is_admin()) or private.project_role_of(project_id) is not null);
create policy task_statuses_insert on public.task_statuses
  for insert to authenticated
  with check ((select private.is_admin()) or private.project_role_of(project_id) = 'pm');
create policy task_statuses_update on public.task_statuses
  for update to authenticated
  using ((select private.is_admin()) or private.project_role_of(project_id) = 'pm')
  with check ((select private.is_admin()) or private.project_role_of(project_id) = 'pm');
create policy task_statuses_delete on public.task_statuses
  for delete to authenticated
  using ((select private.is_admin()) or private.project_role_of(project_id) = 'pm');

create policy task_types_select on public.task_types
  for select to authenticated
  using ((select private.is_admin()) or private.project_role_of(project_id) is not null);
create policy task_types_insert on public.task_types
  for insert to authenticated
  with check ((select private.is_admin()) or private.project_role_of(project_id) = 'pm');
create policy task_types_update on public.task_types
  for update to authenticated
  using ((select private.is_admin()) or private.project_role_of(project_id) = 'pm')
  with check ((select private.is_admin()) or private.project_role_of(project_id) = 'pm');
create policy task_types_delete on public.task_types
  for delete to authenticated
  using ((select private.is_admin()) or private.project_role_of(project_id) = 'pm');

create policy labels_select on public.labels
  for select to authenticated
  using ((select private.is_admin()) or private.project_role_of(project_id) is not null);
create policy labels_insert on public.labels
  for insert to authenticated
  with check ((select private.is_admin()) or private.project_role_of(project_id) = 'pm');
create policy labels_update on public.labels
  for update to authenticated
  using ((select private.is_admin()) or private.project_role_of(project_id) = 'pm')
  with check ((select private.is_admin()) or private.project_role_of(project_id) = 'pm');
create policy labels_delete on public.labels
  for delete to authenticated
  using ((select private.is_admin()) or private.project_role_of(project_id) = 'pm');

create policy task_labels_select on public.task_labels
  for select to authenticated
  using (private.can_read_task(task_id));
create policy task_labels_insert on public.task_labels
  for insert to authenticated
  with check (private.can_edit_task(task_id));
create policy task_labels_delete on public.task_labels
  for delete to authenticated
  using (private.can_edit_task(task_id));

-- ---------------------------------------------------------------------------
-- 9. Hàm cho API (SECURITY INVOKER: RLS và quyền cột của người gọi vẫn áp dụng)
-- ---------------------------------------------------------------------------
-- Xóa trạng thái; p_replace_with: chuyển mọi task sang trạng thái này trước (cùng giao dịch, AC2).
-- Trả số task đã chuyển. Lỗi P0001: status_in_use, invalid_replacement, last_status_of_category;
-- P0002 not_found (không thấy hoặc không có quyền xóa).
create or replace function public.delete_task_status(
  p_status_id uuid,
  p_replace_with uuid default null
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_project_id uuid;
  v_moved integer := 0;
begin
  select s.project_id into v_project_id from public.task_statuses s where s.id = p_status_id;
  if v_project_id is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if p_replace_with is not null then
    if p_replace_with = p_status_id or not exists (
      select 1 from public.task_statuses s
      where s.id = p_replace_with and s.project_id = v_project_id
    ) then
      raise exception 'invalid_replacement' using errcode = 'P0001';
    end if;
    update public.tasks set status_id = p_replace_with where status_id = p_status_id;
    get diagnostics v_moved = row_count;
  elsif exists (select 1 from public.tasks t where t.status_id = p_status_id) then
    raise exception 'status_in_use' using errcode = 'P0001';
  end if;
  delete from public.task_statuses where id = p_status_id;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  return v_moved;
end;
$$;

create or replace function public.delete_task_type(
  p_type_id uuid,
  p_replace_with uuid default null
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_project_id uuid;
  v_moved integer := 0;
begin
  select ty.project_id into v_project_id from public.task_types ty where ty.id = p_type_id;
  if v_project_id is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if p_replace_with is not null then
    if p_replace_with = p_type_id or not exists (
      select 1 from public.task_types ty
      where ty.id = p_replace_with and ty.project_id = v_project_id
    ) then
      raise exception 'invalid_replacement' using errcode = 'P0001';
    end if;
    update public.tasks set type_id = p_replace_with where type_id = p_type_id;
    get diagnostics v_moved = row_count;
  elsif exists (select 1 from public.tasks t where t.type_id = p_type_id) then
    raise exception 'type_in_use' using errcode = 'P0001';
  end if;
  delete from public.task_types where id = p_type_id;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  return v_moved;
end;
$$;

-- Đặt lại toàn bộ nhãn của một task trong một giao dịch (gỡ nhãn không còn, gắn nhãn mới).
create or replace function public.set_task_labels(p_task_id uuid, p_label_ids uuid[])
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_ids uuid[] := coalesce(p_label_ids, '{}');
begin
  if cardinality(v_ids) > 20 then
    raise exception 'too_many_labels' using errcode = '22023';
  end if;
  delete from public.task_labels tl
  where tl.task_id = p_task_id and not (tl.label_id = any (v_ids));
  insert into public.task_labels (task_id, label_id)
  select distinct p_task_id, x from unnest(v_ids) as x
  on conflict do nothing;
end;
$$;

-- Số task theo trạng thái, loại, nhãn của một dự án (màn cấu hình). Chỉ đếm task người gọi thấy.
create or replace function public.project_config_task_counts(p_project_id uuid)
returns table (kind text, config_id uuid, task_count integer)
language sql
stable
security invoker
set search_path = ''
as $$
  select 'status', t.status_id, count(*)::integer
  from public.tasks t where t.project_id = p_project_id group by t.status_id
  union all
  select 'type', t.type_id, count(*)::integer
  from public.tasks t where t.project_id = p_project_id group by t.type_id
  union all
  select 'label', tl.label_id, count(*)::integer
  from public.task_labels tl
  join public.tasks t on t.id = tl.task_id
  where t.project_id = p_project_id
  group by tl.label_id;
$$;

revoke all on function
  public.delete_task_status(uuid, uuid),
  public.delete_task_type(uuid, uuid),
  public.set_task_labels(uuid, uuid[]),
  public.project_config_task_counts(uuid)
from public, anon;
grant execute on function
  public.delete_task_status(uuid, uuid),
  public.delete_task_type(uuid, uuid),
  public.set_task_labels(uuid, uuid[]),
  public.project_config_task_counts(uuid)
to authenticated;
