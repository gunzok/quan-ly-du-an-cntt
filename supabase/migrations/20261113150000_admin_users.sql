-- QLDA-36 (Story E1-4): hàm quản trị người dùng cho API máy chủ /api/v1/users.
-- Thiết kế: docs/03-design/api-contract.md mục 3, security.md STRIDE F2/F5, system-design.md mục 5.
--
-- Hai hàm dưới đây CHỈ cho vai trò service_role gọi (API máy chủ, sau khi Route Handler đã
-- kiểm người gọi là Admin bằng phiên của họ qua RLS). anon/authenticated không có EXECUTE.
-- SECURITY DEFINER vì cần đọc auth.users (đăng nhập gần nhất, trạng thái mời) và xóa
-- auth.sessions khi khóa tài khoản; search_path rỗng, mọi tên đều ghi đủ schema.

-- ---------------------------------------------------------------------------
-- 1. Danh sách người dùng cho màn S08: phòng ban, số dự án, dữ liệu đăng nhập từ auth.users.
-- ---------------------------------------------------------------------------
-- Phân trang keyset theo (sort_key, id); sort_key = tên (chữ thường), rỗng thì lấy email.
-- p_q tìm trong họ tên hoặc email (không phân biệt hoa thường; %, _ trong p_q là ký tự thường).
-- p_user_id: chỉ lấy một người (API dùng để trả dòng vừa sửa).
create or replace function public.admin_list_users(
  p_q text default null,
  p_after_key text default null,
  p_after_id uuid default null,
  p_limit integer default 50,
  p_user_id uuid default null
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

-- ---------------------------------------------------------------------------
-- 2. Đổi quyền Admin, khóa/mở, đổi phòng ban của một người, có kiểm quy tắc nguyên tử.
-- ---------------------------------------------------------------------------
-- Tham số null = không đổi trường đó; p_set_department = true mới đổi phòng ban (để đặt null
-- được). Lỗi nghiệp vụ trả bằng RAISE với mã P0001 và thông điệp là mã máy đọc:
--   actor_not_admin       người gọi không (còn) là Admin đang hoạt động
--   user_not_found        không có người dùng đích
--   self_lock             Admin tự khóa mình
--   self_revoke_admin     Admin tự thu quyền Admin của mình
--   last_admin            thao tác làm hệ thống không còn Admin đang hoạt động nào
--   department_not_found  phòng ban không tồn tại
-- Thứ tự kiểm: last_admin trước self_*, để Admin duy nhất tự thu quyền nhận lý do đúng.
-- Chống tranh chấp: khóa (FOR UPDATE, theo thứ tự id) mọi Admin đang hoạt động cùng người đích
-- TRƯỚC khi kiểm. Hai Admin thu quyền của nhau cùng lúc: giao dịch sau chờ khóa, đọc lại và
-- thấy người gọi không còn là Admin (actor_not_admin), nên số Admin không thể về 0.
-- Khi khóa tài khoản: xóa mọi phiên của người đó trong auth.sessions (refresh token mất hiệu lực);
-- việc chặn đăng nhập (ban) làm ở API bằng Auth Admin API.
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

  if p_set_department and p_department_id is not null and not exists (
    select 1 from public.departments d where d.id = p_department_id
  ) then
    raise exception 'department_not_found';
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

-- Supabase mặc định cấp EXECUTE cho anon/authenticated trên hàm mới ở public: thu lại hết.
revoke all on function public.admin_list_users(text, text, uuid, integer, uuid)
  from public, anon, authenticated;
revoke all on function public.admin_update_user(uuid, uuid, boolean, boolean, boolean, uuid)
  from public, anon, authenticated;
grant execute on function public.admin_list_users(text, text, uuid, integer, uuid) to service_role;
grant execute on function public.admin_update_user(uuid, uuid, boolean, boolean, boolean, uuid)
  to service_role;
