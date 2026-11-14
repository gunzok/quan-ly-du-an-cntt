-- QLDA-39 (Story E1-5): danh mục Phòng ban cho Admin và lọc người dùng theo Phòng ban.
-- Thiết kế: docs/03-design/api-contract.md (/api/v1/departments, GET /api/v1/users?department_id=),
-- database.md mục departments; màn S08 v2.
--
-- 1. Lưu trữ phòng ban bằng cột archived_at (null = đang dùng). Không xóa cứng qua ứng dụng.
-- 2. Tên phòng ban duy nhất không phân biệt hoa thường và khoảng trắng hai đầu.
-- 3. Chính sách DELETE: Admin chỉ xóa được phòng ban KHÔNG còn ai (API không có DELETE; đây là
--    lớp chặn ở CSDL cho client trình duyệt).
-- 4. admin_list_users thêm lọc theo phòng ban / người chưa có phòng ban.
-- 5. admin_update_user từ chối gán phòng ban đã lưu trữ (giữ nguyên nếu người đó đang ở phòng đó).

-- ---------------------------------------------------------------------------
-- 1. Lưu trữ
-- ---------------------------------------------------------------------------
alter table public.departments add column archived_at timestamptz;
comment on column public.departments.archived_at is
  'Thời điểm lưu trữ; null = đang dùng. Phòng ban lưu trữ không gán mới được, người đang thuộc vẫn giữ.';

-- ---------------------------------------------------------------------------
-- 2. Tên duy nhất không phân biệt hoa thường. Giữ ràng buộc departments_name_key (scripts seed
--    dùng ON CONFLICT (name)); chỉ mục dưới đây chặt hơn nên bao trùm nó.
-- ---------------------------------------------------------------------------
create unique index departments_name_ci_key on public.departments (lower(btrim(name)));

-- ---------------------------------------------------------------------------
-- 3. Không xóa phòng ban đang có người
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER để đếm cả hồ sơ người bị khóa (RLS profiles có thể ẩn với người gọi).
create or replace function private.department_has_members(p_department_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p where p.department_id = p_department_id
  );
$$;

revoke all on function private.department_has_members(uuid) from public, anon, authenticated;
grant execute on function private.department_has_members(uuid) to authenticated;

drop policy departments_delete_admin on public.departments;
create policy departments_delete_admin on public.departments
  for delete to authenticated
  using ((select private.is_admin()) and not private.department_has_members(id));

-- ---------------------------------------------------------------------------
-- 4. admin_list_users: thêm p_department_id, p_without_department
-- ---------------------------------------------------------------------------
-- Đổi chữ ký nên phải xóa hàm cũ (tạo thêm bản nạp chồng sẽ làm lời gọi không tham số mơ hồ).
drop function public.admin_list_users(text, text, uuid, integer, uuid);

-- p_department_id: chỉ người thuộc phòng ban đó. p_without_department = true: chỉ người chưa có
-- phòng ban (bỏ qua p_department_id). Các tham số khác giữ nguyên ý nghĩa như migration
-- 20261113150000_admin_users.sql.
create function public.admin_list_users(
  p_q text default null,
  p_after_key text default null,
  p_after_id uuid default null,
  p_limit integer default 50,
  p_user_id uuid default null,
  p_department_id uuid default null,
  p_without_department boolean default false
)
returns table (
  id uuid,
  full_name text,
  email text,
  department_id uuid,
  department_name text,
  is_admin boolean,
  is_active boolean,
  project_count integer,
  pm_project_count integer,
  last_sign_in_at timestamptz,
  invited_at timestamptz,
  email_confirmed_at timestamptz,
  created_at timestamptz,
  sort_key text
)
language sql
stable
security definer
set search_path = ''
as $$
  with base as (
    select
      p.id,
      p.full_name,
      p.email,
      p.department_id,
      d.name as department_name,
      p.is_admin,
      p.is_active,
      p.created_at,
      u.last_sign_in_at,
      u.invited_at,
      u.email_confirmed_at,
      lower(coalesce(nullif(btrim(p.full_name), ''), p.email, '')) as sort_key
    from public.profiles p
    join auth.users u on u.id = p.id
    left join public.departments d on d.id = p.department_id
    where (
      case
        when coalesce(p_without_department, false) then p.department_id is null
        when p_department_id is not null then p.department_id = p_department_id
        else true
      end
    )
  ),
  needle as (
    select '%' || replace(replace(replace(lower(btrim(p_q)), '\', '\\'), '%', '\%'), '_', '\_') || '%' as pattern
  )
  select
    b.id,
    b.full_name,
    b.email,
    b.department_id,
    b.department_name,
    b.is_admin,
    b.is_active,
    coalesce(m.project_count, 0)::integer,
    coalesce(m.pm_project_count, 0)::integer,
    b.last_sign_in_at,
    b.invited_at,
    b.email_confirmed_at,
    b.created_at,
    b.sort_key
  from base b
  cross join needle n
  left join lateral (
    select
      count(*) as project_count,
      count(*) filter (where pm.role = 'pm') as pm_project_count
    from public.project_members pm
    where pm.user_id = b.id
  ) m on true
  where (p_user_id is null or b.id = p_user_id)
    and (
      nullif(btrim(p_q), '') is null
      or lower(b.full_name) like n.pattern
      or lower(coalesce(b.email, '')) like n.pattern
    )
    and (p_after_id is null or (b.sort_key, b.id) > (p_after_key, p_after_id))
  order by b.sort_key, b.id
  limit least(greatest(coalesce(p_limit, 50), 1), 101);
$$;

revoke all on function public.admin_list_users(text, text, uuid, integer, uuid, uuid, boolean)
  from public, anon, authenticated;
grant execute on function public.admin_list_users(text, text, uuid, integer, uuid, uuid, boolean)
  to service_role;

-- ---------------------------------------------------------------------------
-- 5. admin_update_user: thêm lỗi department_archived. Thân hàm giữ nguyên bản 20261113150000,
--    chỉ thêm kiểm phòng ban lưu trữ (mã lỗi máy đọc mới: department_archived).
-- ---------------------------------------------------------------------------
create or replace function public.admin_update_user(
  p_actor_id uuid,
  p_target_id uuid,
  p_is_admin boolean default null,
  p_is_active boolean default null,
  p_set_department boolean default false,
  p_department_id uuid default null
)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target public.profiles;
  v_result public.profiles;
  v_removes_admin boolean;
  v_department public.departments;
begin
  perform 1
  from public.profiles p
  where (p.is_admin and p.is_active) or p.id = p_target_id or p.id = p_actor_id
  order by p.id
  for update;

  if not exists (
    select 1 from public.profiles a
    where a.id = p_actor_id and a.is_admin and a.is_active
  ) then
    raise exception 'actor_not_admin';
  end if;

  select * into v_target from public.profiles where id = p_target_id;
  if not found then
    raise exception 'user_not_found';
  end if;

  v_removes_admin := v_target.is_admin and v_target.is_active
    and (p_is_admin is false or p_is_active is false);
  if v_removes_admin and not exists (
    select 1 from public.profiles o
    where o.is_admin and o.is_active and o.id <> p_target_id
  ) then
    raise exception 'last_admin';
  end if;

  if p_actor_id = p_target_id and p_is_active is false then
    raise exception 'self_lock';
  end if;
  if p_actor_id = p_target_id and p_is_admin is false then
    raise exception 'self_revoke_admin';
  end if;

  if p_set_department and p_department_id is not null then
    -- FOR SHARE: không cho lưu trữ phòng ban giữa lúc kiểm và lúc gán.
    select * into v_department from public.departments d
    where d.id = p_department_id
    for share;
    if not found then
      raise exception 'department_not_found';
    end if;
    if v_department.archived_at is not null
      and v_target.department_id is distinct from p_department_id then
      raise exception 'department_archived';
    end if;
  end if;

  update public.profiles
  set
    is_admin = coalesce(p_is_admin, is_admin),
    is_active = coalesce(p_is_active, is_active),
    department_id = case when p_set_department then p_department_id else department_id end
  where id = p_target_id
  returning * into v_result;

  if p_is_active is false then
    delete from auth.sessions where user_id = p_target_id;
  end if;

  return v_result;
end;
$$;

revoke all on function public.admin_update_user(uuid, uuid, boolean, boolean, boolean, uuid)
  from public, anon, authenticated;
grant execute on function public.admin_update_user(uuid, uuid, boolean, boolean, boolean, uuid)
  to service_role;
