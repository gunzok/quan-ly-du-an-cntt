-- QLDA-33 (Story E1-6): PM thêm thành viên vào dự án và gán vai trò PM, Thành viên, Người xem.
-- Thiết kế: docs/03-design/database.md mục 5 (RLS project_members), api-contract.md mục 3
-- (PUT/DELETE /projects/{id}/members/{user_id}); quy tắc BR-01, BR-10.
--
-- Quyết định:
--   1. Bất biến "mỗi dự án luôn còn ít nhất một PM ĐANG HOẠT ĐỘNG" giữ bằng trigger
--      `guard_last_pm` (BEFORE UPDATE/DELETE trên project_members), áp cho MỌI đường ghi kể cả
--      service_role và Admin. Hai ngoại lệ: xóa cả dự án (xóa dây chuyền, dòng dự án đã mất) và
--      xóa hẳn tài khoản (xóa dây chuyền từ auth.users → profiles, hồ sơ đã mất).
--   2. Chống đua: trigger khóa dòng dự án (FOR UPDATE) trước khi đếm PM còn lại, giống
--      guard_last_task_status ở E2-3. Hai PM tự hạ/gỡ nhau cùng lúc: giao dịch sau chờ khóa, đọc
--      lại (READ COMMITTED: câu lệnh mới, ảnh chụp mới) và bị chặn.
--   3. PM bị khóa (profiles.is_active = false) không được tính là PM còn lại: dự án chỉ còn PM bị
--      khóa thì không ai trong dự án quản lý được nữa.
--   4. `public.set_project_member()` (SECURITY INVOKER: RLS và quyền cột vẫn áp dụng) thêm hoặc
--      đổi vai trò trong một câu lệnh, cho biết dòng mới hay cũ (API trả 201 hoặc 200), và từ chối
--      người dùng đích không tồn tại hoặc bị khóa (`member_user_inactive`).
--   5. `public.search_users_for_membership()` (SECURITY INVOKER) cho ô tìm người: chỉ Admin hoặc
--      PM của ít nhất một dự án (sếp chốt 2026-11-13: PM đọc được mọi hồ sơ để tìm người); chỉ trả
--      id, họ tên, email, phòng ban của người đang hoạt động; tìm ILIKE trên họ tên/email (chưa bỏ
--      dấu, E3-3 làm riêng); tối đa 20 dòng.
--   6. Không đụng tasks.assignee_id khi gỡ thành viên (quyết định E2-2: giữ người phụ trách cũ để
--      không mất lịch sử; trigger check_assignee chỉ kiểm khi gán mới).

-- ---------------------------------------------------------------------------
-- 1. Không gỡ, không hạ vai trò PM đang hoạt động cuối cùng của dự án
-- ---------------------------------------------------------------------------
create or replace function private.guard_last_project_pm()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result public.project_members := case when tg_op = 'DELETE' then old else new end;
begin
  if old.role <> 'pm' then
    return v_result;
  end if;
  if tg_op = 'UPDATE' and new.role = 'pm'
     and new.project_id = old.project_id and new.user_id = old.user_id then
    return v_result;
  end if;

  -- Khóa dòng dự án: hai giao dịch hạ/gỡ PM cùng lúc phải lần lượt đếm. Dự án đang bị xóa (xóa dây
  -- chuyền) thì không còn dòng: cho qua.
  perform 1 from public.projects p where p.id = old.project_id for update;
  if not found then
    return v_result;
  end if;
  -- Tài khoản đang bị xóa hẳn (auth.users → profiles → project_members): cho qua.
  if tg_op = 'DELETE' and not exists (
    select 1 from public.profiles p where p.id = old.user_id
  ) then
    return v_result;
  end if;

  if not exists (
    select 1
    from public.project_members m
    join public.profiles p on p.id = m.user_id
    where m.project_id = old.project_id
      and m.role = 'pm'
      and m.user_id <> old.user_id
      and p.is_active
  ) then
    raise exception 'last_project_pm'
      using errcode = 'P0001',
            detail = 'Dự án phải còn ít nhất một PM đang hoạt động.';
  end if;
  return v_result;
end;
$$;
revoke all on function private.guard_last_project_pm() from public, anon, authenticated;

create trigger guard_last_pm
  before update or delete on public.project_members
  for each row execute function private.guard_last_project_pm();

-- ---------------------------------------------------------------------------
-- 2. Thêm thành viên hoặc đổi vai trò (PUT /api/v1/projects/{id}/members/{user_id})
-- ---------------------------------------------------------------------------
-- Lỗi:
--   42501 member_forbidden      người gọi không phải Admin hay PM đang hoạt động của dự án
--   P0001 member_user_inactive  người dùng đích không tồn tại hoặc bị khóa
--   P0001 last_project_pm       (từ trigger) hạ vai trò PM đang hoạt động cuối cùng
-- created = true khi vừa thêm; false khi đổi vai trò hoặc vai trò đã đúng (PUT lặp lại vô hại).
create or replace function public.set_project_member(
  p_project_id uuid,
  p_user_id uuid,
  p_role public.project_role
)
returns table (
  user_id uuid,
  role public.project_role,
  joined_at timestamptz,
  created boolean
)
language plpgsql
security invoker
set search_path = ''
as $$
#variable_conflict use_column
begin
  -- Kiểm quyền trước để người không có quyền không dò được người dùng nào tồn tại.
  -- coalesce: project_role_of trả null với người ngoài dự án; `not (false or null)` là null và IF
  -- coi như false, sẽ để lọt.
  if not coalesce((select private.is_admin()) or private.project_role_of(p_project_id) = 'pm', false) then
    raise exception 'member_forbidden' using errcode = '42501';
  end if;
  -- Hồ sơ đọc qua RLS: PM và Admin đọc được mọi hồ sơ (profiles_select, can_create_project).
  if not exists (
    select 1 from public.profiles p where p.id = p_user_id and p.is_active
  ) then
    raise exception 'member_user_inactive' using errcode = 'P0001';
  end if;

  return query
    insert into public.project_members as m (project_id, user_id, role)
    values (p_project_id, p_user_id, p_role)
    on conflict on constraint project_members_pkey do update
      set role = excluded.role
      where m.role is distinct from excluded.role
    returning m.user_id, m.role, m.joined_at, (xmax = 0);
  if not found then
    -- Vai trò đã đúng: ON CONFLICT ... WHERE không cập nhật, trả dòng hiện có.
    return query
      select m.user_id, m.role, m.joined_at, false
      from public.project_members m
      where m.project_id = p_project_id and m.user_id = p_user_id;
  end if;
end;
$$;
revoke all on function public.set_project_member(uuid, uuid, public.project_role) from public, anon;
grant execute on function public.set_project_member(uuid, uuid, public.project_role) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Tìm người để thêm vào dự án
-- ---------------------------------------------------------------------------
-- p_q: chuỗi con trong họ tên hoặc email, không phân biệt hoa thường (%, _ là ký tự thường).
-- p_exclude_project_id: bỏ những người đã là thành viên dự án đó (người gọi phải thấy dự án).
create or replace function public.search_users_for_membership(
  p_q text,
  p_exclude_project_id uuid default null,
  p_limit integer default 20
)
returns table (
  id uuid,
  full_name text,
  email text,
  department_id uuid,
  department_name text
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_pattern text;
begin
  if not coalesce((select private.can_create_project()), false) then
    raise exception 'member_search_forbidden' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_q, '')), '') is null then
    return;
  end if;
  v_pattern := '%' || replace(replace(replace(btrim(p_q), '\', '\\'), '%', '\%'), '_', '\_') || '%';

  return query
    select p.id, p.full_name, p.email, p.department_id, d.name
    from public.profiles p
    left join public.departments d on d.id = p.department_id
    where p.is_active
      and (p.full_name ilike v_pattern or coalesce(p.email, '') ilike v_pattern)
      and (
        p_exclude_project_id is null
        or not exists (
          select 1 from public.project_members m
          where m.project_id = p_exclude_project_id and m.user_id = p.id
        )
      )
    order by lower(coalesce(nullif(btrim(p.full_name), ''), p.email, '')), p.id
    limit least(greatest(coalesce(p_limit, 20), 1), 20);
end;
$$;
revoke all on function public.search_users_for_membership(text, uuid, integer) from public, anon;
grant execute on function public.search_users_for_membership(text, uuid, integer) to authenticated;
