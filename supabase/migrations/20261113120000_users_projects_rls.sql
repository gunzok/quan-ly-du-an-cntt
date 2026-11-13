-- QLDA-32 (Story E1-3): người dùng, phòng ban, dự án, thành viên dự án và RLS theo vai trò
-- trong từng dự án. Thiết kế: docs/03-design/database.md mục 1, 2, 5; security.md STRIDE F2;
-- quy tắc BR-01, BR-02, BR-10, NFR-06.
--
-- Mô hình quyền:
--   * Admin = profiles.is_admin (quyền toàn hệ thống, BR-01 sửa 2026-11-13).
--   * Vai trò trong dự án (pm | member | viewer) nằm ở project_members; một người có thể có
--     vai trò khác nhau ở các dự án khác nhau.
--   * Người không phải Admin và không thuộc dự án không thấy dòng nào của dự án đó (BR-10).
--   * Người bị khóa (profiles.is_active = false) không có quyền gì, kể cả khi là Admin.
--   * Vai trò `anon` không được cấp quyền gì trên các bảng này.
--   * Việc quản trị người dùng (đổi is_admin, is_active, phòng ban, email) đi qua API máy chủ
--     dùng khóa service (Story E1-4), không có chính sách cho trình duyệt.
--
-- Hàm hỗ trợ RLS đặt trong schema `private` (PostgREST không phơi ra), SECURITY DEFINER và
-- search_path rỗng: đọc profiles/project_members mà không kích hoạt lại RLS, tránh đệ quy chính sách.

-- ---------------------------------------------------------------------------
-- 0. Schema private cho hàm nội bộ
-- ---------------------------------------------------------------------------
create schema if not exists private;
revoke all on schema private from public;
-- authenticated cần USAGE để biểu thức chính sách gọi được hàm; anon thì không.
grant usage on schema private to authenticated;

-- ---------------------------------------------------------------------------
-- 1. Bảng
-- ---------------------------------------------------------------------------
-- Phòng ban: danh mục do Admin quản lý.
create table public.departments (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint departments_name_not_blank check (char_length(btrim(name)) between 1 and 200),
  constraint departments_name_key unique (name)
);
comment on table public.departments is 'Phòng ban (danh mục do Admin quản lý).';

-- Hồ sơ người dùng, 1-1 với auth.users. Chỉ họ tên, email (NFR-14); số điện thoại tách sang
-- profile_contacts vì RLS lọc theo hàng, không theo cột.
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null default '',
  email text,
  department_id uuid references public.departments (id) on delete set null,
  is_admin boolean not null default false,
  locale text not null default 'vi',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_full_name_length check (char_length(full_name) <= 200),
  constraint profiles_locale_check check (locale in ('vi', 'en'))
);
comment on table public.profiles is
  'Hồ sơ người dùng (id = auth.users.id). is_admin là quyền toàn hệ thống; vai trò theo dự án ở project_members.';
create index profiles_department_id_idx on public.profiles (department_id);

-- Số điện thoại: chỉ chính chủ, PM của một dự án chung và Admin xem được.
create table public.profile_contacts (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  phone text not null,
  updated_at timestamptz not null default now(),
  constraint profile_contacts_phone_format check (phone ~ '^\+?[0-9][0-9 .()-]{5,19}$')
);
comment on table public.profile_contacts is
  'Thông tin liên hệ nhạy cảm (số điện thoại), tách khỏi profiles để RLS riêng.';

-- Dự án. template_id thêm khi có bảng project_templates (Story khác).
create table public.projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  start_date date,
  end_date date,
  status text not null default 'active',
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint projects_name_not_blank check (char_length(btrim(name)) between 1 and 200),
  constraint projects_status_check check (status in ('active', 'archived')),
  constraint projects_dates_check check (start_date is null or end_date is null or start_date <= end_date)
);
comment on table public.projects is 'Dự án (FR-03). Chỉ thành viên dự án và Admin thấy (BR-10).';
create index projects_created_by_idx on public.projects (created_by);

-- Thành viên dự án và vai trò theo từng dự án (BR-01).
create table public.project_members (
  project_id uuid not null references public.projects (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role public.project_role not null default 'member',
  joined_at timestamptz not null default now(),
  primary key (project_id, user_id)
);
comment on table public.project_members is
  'Vai trò của một người trong một dự án (pm | member | viewer); quyết định ai thấy dự án (BR-10).';
create index project_members_user_id_idx on public.project_members (user_id);

-- ---------------------------------------------------------------------------
-- 2. Trigger updated_at
-- ---------------------------------------------------------------------------
create trigger set_updated_at before update on public.departments
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.profile_contacts
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.projects
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 3. Đồng bộ auth.users -> profiles
-- ---------------------------------------------------------------------------
-- Tạo hồ sơ khi có người dùng mới. Họ tên lấy từ user_metadata.full_name (nếu có).
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    left(coalesce(new.raw_user_meta_data ->> 'full_name', ''), 200)
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- Giữ profiles.email khớp khi email đăng nhập đổi.
create or replace function private.handle_user_email_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles set email = new.email where id = new.id;
  return new;
end;
$$;

create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row
  when (old.email is distinct from new.email)
  execute function private.handle_user_email_change();

-- ---------------------------------------------------------------------------
-- 4. Hàm hỗ trợ RLS (đều chỉ xét người đang đăng nhập, auth.uid())
-- ---------------------------------------------------------------------------
-- Người đang đăng nhập có hồ sơ và chưa bị khóa.
create or replace function private.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.is_active
  );
$$;

-- Admin toàn hệ thống và chưa bị khóa.
create or replace function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.is_active and p.is_admin
  );
$$;

-- Vai trò của người đang đăng nhập trong một dự án; null nếu không thuộc dự án hoặc bị khóa.
create or replace function private.project_role_of(target_project_id uuid)
returns public.project_role
language sql
stable
security definer
set search_path = ''
as $$
  select m.role
  from public.project_members m
  join public.profiles p on p.id = m.user_id
  where m.project_id = target_project_id
    and m.user_id = auth.uid()
    and p.is_active;
$$;

-- Được tạo dự án mới: Admin, hoặc đang là PM ở ít nhất một dự án.
create or replace function private.can_create_project()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_admin() or exists (
    select 1
    from public.project_members m
    join public.profiles p on p.id = m.user_id
    where m.user_id = auth.uid() and m.role = 'pm' and p.is_active
  );
$$;

-- Người đang đăng nhập và target_user_id cùng thuộc ít nhất một dự án.
create or replace function private.shares_project_with(target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_active_user() and exists (
    select 1
    from public.project_members mine
    join public.project_members theirs on theirs.project_id = mine.project_id
    where mine.user_id = auth.uid() and theirs.user_id = target_user_id
  );
$$;

-- Người đang đăng nhập là PM của một dự án mà target_user_id thuộc về.
create or replace function private.is_pm_of_user(target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_active_user() and exists (
    select 1
    from public.project_members mine
    join public.project_members theirs on theirs.project_id = mine.project_id
    where mine.user_id = auth.uid() and mine.role = 'pm' and theirs.user_id = target_user_id
  );
$$;

-- Supabase mặc định cấp EXECUTE cho anon/authenticated; thu lại rồi chỉ cấp hàm cần cho chính sách.
revoke all on all functions in schema private from public, anon, authenticated;
grant execute on function
  private.is_active_user(),
  private.is_admin(),
  private.project_role_of(uuid),
  private.can_create_project(),
  private.shares_project_with(uuid),
  private.is_pm_of_user(uuid)
to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Người tạo dự án tự thành PM
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER vì lúc này người tạo chưa là PM nên chưa qua được chính sách
-- INSERT của project_members.
create or replace function private.add_project_creator_as_pm()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.created_by is not null then
    insert into public.project_members (project_id, user_id, role)
    values (new.id, new.created_by, 'pm')
    on conflict (project_id, user_id) do update set role = 'pm';
  end if;
  return new;
end;
$$;
revoke all on function private.add_project_creator_as_pm() from public, anon, authenticated;

create trigger add_creator_as_pm
  after insert on public.projects
  for each row execute function private.add_project_creator_as_pm();

-- ---------------------------------------------------------------------------
-- 6. Quyền bảng (GRANT) — lớp ngoài của RLS
-- ---------------------------------------------------------------------------
-- Supabase mặc định GRANT ALL cho anon/authenticated trên bảng mới ở public; thu lại hết,
-- rồi cấp đúng phần cần. service_role (API máy chủ) giữ nguyên toàn quyền và bỏ qua RLS.
revoke all on public.departments, public.profiles, public.profile_contacts,
  public.projects, public.project_members from anon, authenticated;

grant select, insert, update, delete on public.departments to authenticated;

-- Người dùng chỉ tự sửa họ tên và ngôn ngữ; is_admin, is_active, email, department_id
-- không có quyền cột UPDATE nên mọi câu UPDATE chạm vào chúng bị từ chối.
grant select on public.profiles to authenticated;
grant update (full_name, locale) on public.profiles to authenticated;

grant select, delete on public.profile_contacts to authenticated;
grant insert (user_id, phone) on public.profile_contacts to authenticated;
grant update (phone) on public.profile_contacts to authenticated;

-- created_by không nằm trong quyền cột: luôn lấy mặc định auth.uid(), không đổi được về sau.
-- Cho phép client tự sinh id: INSERT ... RETURNING bị chặn với người tạo không phải Admin vì
-- chính sách SELECT được kiểm trước khi trigger AFTER thêm họ làm PM (xem create_project()).
grant select, delete on public.projects to authenticated;
grant insert (id, name, description, start_date, end_date, status) on public.projects to authenticated;
grant update (name, description, start_date, end_date, status) on public.projects to authenticated;

grant select, delete on public.project_members to authenticated;
grant insert (project_id, user_id, role) on public.project_members to authenticated;
grant update (role) on public.project_members to authenticated;

-- ---------------------------------------------------------------------------
-- 7. RLS
-- ---------------------------------------------------------------------------
alter table public.departments enable row level security;
alter table public.profiles enable row level security;
alter table public.profile_contacts enable row level security;
alter table public.projects enable row level security;
alter table public.project_members enable row level security;

-- departments: người dùng đang hoạt động đọc; Admin toàn quyền.
create policy departments_select on public.departments
  for select to authenticated
  using ((select private.is_active_user()));
create policy departments_insert_admin on public.departments
  for insert to authenticated
  with check ((select private.is_admin()));
create policy departments_update_admin on public.departments
  for update to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));
create policy departments_delete_admin on public.departments
  for delete to authenticated
  using ((select private.is_admin()));

-- profiles: đọc hồ sơ của mình, của người cùng dự án; Admin đọc tất cả; người đang là PM
-- (được tạo dự án) đọc tất cả để tìm người thêm vào dự án. Chỉ tự sửa hồ sơ của mình
-- (cột giới hạn bởi GRANT ở trên). Không INSERT/DELETE từ trình duyệt.
create policy profiles_select on public.profiles
  for select to authenticated
  using (
    (select private.is_active_user()) and (
      id = (select auth.uid())
      or (select private.can_create_project())
      or private.shares_project_with(id)
    )
  );
create policy profiles_update_self on public.profiles
  for update to authenticated
  using ((select private.is_active_user()) and id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- profile_contacts: chính chủ, PM của dự án chung, Admin đọc; chính chủ thêm, sửa, xóa.
create policy profile_contacts_select on public.profile_contacts
  for select to authenticated
  using (
    (select private.is_active_user()) and (
      user_id = (select auth.uid())
      or (select private.is_admin())
      or private.is_pm_of_user(user_id)
    )
  );
create policy profile_contacts_insert_self on public.profile_contacts
  for insert to authenticated
  with check ((select private.is_active_user()) and user_id = (select auth.uid()));
create policy profile_contacts_update_self on public.profile_contacts
  for update to authenticated
  using ((select private.is_active_user()) and user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy profile_contacts_delete_self on public.profile_contacts
  for delete to authenticated
  using ((select private.is_active_user()) and user_id = (select auth.uid()));

-- projects: thành viên dự án (mọi vai trò) và Admin đọc; Admin hoặc PM ở dự án nào đó tạo;
-- PM của dự án hoặc Admin sửa; chỉ Admin xóa (database.md mục 5: PM không có quyền xóa).
create policy projects_select on public.projects
  for select to authenticated
  using ((select private.is_admin()) or private.project_role_of(id) is not null);
create policy projects_insert on public.projects
  for insert to authenticated
  with check ((select private.can_create_project()) and created_by = (select auth.uid()));
create policy projects_update on public.projects
  for update to authenticated
  using ((select private.is_admin()) or private.project_role_of(id) = 'pm')
  with check ((select private.is_admin()) or private.project_role_of(id) = 'pm');
create policy projects_delete_admin on public.projects
  for delete to authenticated
  using ((select private.is_admin()));

-- project_members: thành viên cùng dự án và Admin đọc; PM của dự án hoặc Admin thêm, đổi vai trò, gỡ.
create policy project_members_select on public.project_members
  for select to authenticated
  using ((select private.is_admin()) or private.project_role_of(project_id) is not null);
create policy project_members_insert on public.project_members
  for insert to authenticated
  with check ((select private.is_admin()) or private.project_role_of(project_id) = 'pm');
create policy project_members_update on public.project_members
  for update to authenticated
  using ((select private.is_admin()) or private.project_role_of(project_id) = 'pm')
  with check ((select private.is_admin()) or private.project_role_of(project_id) = 'pm');
create policy project_members_delete on public.project_members
  for delete to authenticated
  using ((select private.is_admin()) or private.project_role_of(project_id) = 'pm');

-- ---------------------------------------------------------------------------
-- 8. Tạo dự án và nhận lại dòng vừa tạo
-- ---------------------------------------------------------------------------
-- `insert into projects ... returning *` (supabase-js `.insert().select()`) thất bại với PM không
-- phải Admin: Postgres kiểm chính sách SELECT cho RETURNING TRƯỚC khi trigger AFTER INSERT thêm
-- người tạo vào project_members. Hàm này chèn không RETURNING rồi đọc lại. SECURITY INVOKER nên
-- mọi chính sách RLS và quyền cột vẫn áp dụng như khi chèn trực tiếp.
create or replace function public.create_project(
  p_name text,
  p_description text default null,
  p_start_date date default null,
  p_end_date date default null
)
returns public.projects
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid := gen_random_uuid();
  v_row public.projects;
begin
  insert into public.projects (id, name, description, start_date, end_date)
  values (v_id, p_name, p_description, p_start_date, p_end_date);
  select * into v_row from public.projects where id = v_id;
  return v_row;
end;
$$;
revoke all on function public.create_project(text, text, date, date) from public, anon;
grant execute on function public.create_project(text, text, date, date) to authenticated;
