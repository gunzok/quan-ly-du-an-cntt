-- QLDA-36 (Story E1-4): hàm quản trị người dùng admin_list_users, admin_update_user.
-- Quyền gọi (chỉ service_role), quy tắc tự khóa, tự thu quyền, Admin cuối cùng, xóa phiên khi khóa.
begin;
\ir _helpers.psql
select tests.seed_fixture();

select plan(25);

-- ===========================================================================
-- Cấu hình an toàn và quyền gọi
-- ===========================================================================
select ok(
  (select bool_and(prosecdef and proconfig = array['search_path=""']) from pg_proc
    where oid in ('public.admin_list_users(text,text,uuid,integer,uuid)'::regprocedure,
      'public.admin_update_user(uuid,uuid,boolean,boolean,boolean,uuid)'::regprocedure)),
  'Hai hàm quản trị là SECURITY DEFINER với search_path rỗng');

select ok(
  not has_function_privilege('anon', 'public.admin_list_users(text,text,uuid,integer,uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.admin_list_users(text,text,uuid,integer,uuid)', 'execute')
  and not has_function_privilege('anon', 'public.admin_update_user(uuid,uuid,boolean,boolean,boolean,uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.admin_update_user(uuid,uuid,boolean,boolean,boolean,uuid)', 'execute'),
  'anon và authenticated (kể cả Admin từ trình duyệt) không gọi được hàm quản trị');

select ok(
  has_function_privilege('service_role', 'public.admin_list_users(text,text,uuid,integer,uuid)', 'execute')
  and has_function_privilege('service_role', 'public.admin_update_user(uuid,uuid,boolean,boolean,boolean,uuid)', 'execute'),
  'service_role (API máy chủ) gọi được hàm quản trị');

select tests.login_as(tests.uid('admin'));
select throws_ok(
  $$ select * from public.admin_list_users() $$,
  '42501', null,
  'Admin gọi trực tiếp bằng phiên trình duyệt bị từ chối');
select tests.logout();

-- ===========================================================================
-- admin_list_users
-- ===========================================================================
select is((select count(*)::integer from public.admin_list_users()), 8,
  'Liệt kê đủ 8 người dùng của fixture');

select is(
  (select array_agg(email order by sort_key, id) from public.admin_list_users(p_q => 'pm_'))::text[],
  array['pm_a@test.example', 'pm_b@test.example'],
  'Tìm theo email; ký tự _ trong từ khóa là ký tự thường');

select is((select count(*)::integer from public.admin_list_users(p_q => '%')), 0,
  'Ký tự % trong từ khóa không khớp mọi dòng');

select is(
  (select email from public.admin_list_users(p_q => 'MEMBER A')),
  'member_a@test.example',
  'Tìm theo họ tên không phân biệt hoa thường');

select is(
  (select row(project_count, pm_project_count)::text from public.admin_list_users(p_user_id => tests.uid('pm_a'))),
  '(2,1)',
  'pm_a tham gia 2 dự án, là PM ở 1');

select is(
  (select array_agg(email order by sort_key, id) from public.admin_list_users(p_limit => 3))::text[]
    || (select array_agg(email order by sort_key, id) from public.admin_list_users(
          p_after_key => (select sort_key from public.admin_list_users(p_limit => 3) order by sort_key desc, id desc limit 1),
          p_after_id => (select id from public.admin_list_users(p_limit => 3) order by sort_key desc, id desc limit 1)))::text[],
  (select array_agg(email order by sort_key, id) from public.admin_list_users())::text[],
  'Phân trang keyset: trang 1 + phần sau con trỏ = toàn bộ, đúng thứ tự, không trùng');

update public.profiles set department_id = tests.uid('dept_1') where id = tests.uid('member_a');
select is(
  (select department_name from public.admin_list_users(p_user_id => tests.uid('member_a'))),
  'Phòng Thử 1',
  'Trả tên phòng ban');

-- ===========================================================================
-- admin_update_user: quy tắc
-- ===========================================================================
select throws_ok(
  $$ select public.admin_update_user(tests.uid('pm_a'), tests.uid('member_a'), p_is_active => false) $$,
  'P0001', 'actor_not_admin',
  'Người gọi không phải Admin bị từ chối');

select throws_ok(
  $$ select public.admin_update_user(tests.uid('locked_admin'), tests.uid('member_a'), p_is_active => false) $$,
  'P0001', 'actor_not_admin',
  'Admin đã bị khóa không thao tác được');

select throws_ok(
  $$ select public.admin_update_user(tests.uid('admin'), gen_random_uuid(), p_is_active => false) $$,
  'P0001', 'user_not_found',
  'Người đích không tồn tại');

-- Có thêm một Admin khác (pm_b) để lý do là tự thao tác, không phải Admin cuối cùng.
update public.profiles set is_admin = true where id = tests.uid('pm_b');
select throws_ok(
  $$ select public.admin_update_user(tests.uid('admin'), tests.uid('admin'), p_is_active => false) $$,
  'P0001', 'self_lock',
  'Admin không tự khóa mình');

select throws_ok(
  $$ select public.admin_update_user(tests.uid('admin'), tests.uid('admin'), p_is_admin => false) $$,
  'P0001', 'self_revoke_admin',
  'Admin không tự thu quyền Admin của mình');
update public.profiles set is_admin = false where id = tests.uid('pm_b');

select throws_ok(
  $$ select public.admin_update_user(tests.uid('admin'), tests.uid('member_a'),
       p_set_department => true, p_department_id => gen_random_uuid()) $$,
  'P0001', 'department_not_found',
  'Phòng ban không tồn tại');

-- Cấp Admin cho pm_a, rồi để pm_a (Admin mới) thu quyền của admin gốc: còn pm_a nên được.
select is(
  (select is_admin from public.admin_update_user(tests.uid('admin'), tests.uid('pm_a'), p_is_admin => true)),
  true,
  'Admin cấp quyền Admin cho người khác');
select is(
  (select is_admin from public.admin_update_user(tests.uid('pm_a'), tests.uid('admin'), p_is_admin => false)),
  false,
  'Admin thu quyền Admin của người khác khi vẫn còn Admin khác');
select throws_ok(
  $$ select public.admin_update_user(tests.uid('admin'), tests.uid('pm_a'), p_is_admin => false) $$,
  'P0001', 'actor_not_admin',
  'Người vừa bị thu quyền không thu ngược lại được (tình huống hai Admin thu quyền của nhau)');

-- pm_a giờ là Admin đang hoạt động duy nhất; locked_admin là Admin bị khóa, không tính.
select throws_ok(
  $$ select public.admin_update_user(tests.uid('pm_a'), tests.uid('pm_a'), p_is_admin => false) $$,
  'P0001', 'last_admin',
  'Không thu quyền Admin cuối cùng (Admin bị khóa không tính)');
select throws_ok(
  $$ select public.admin_update_user(tests.uid('pm_a'), tests.uid('pm_a'), p_is_active => false) $$,
  'P0001', 'last_admin',
  'Không khóa Admin cuối cùng');
select is(
  (select is_active from public.admin_update_user(tests.uid('pm_a'), tests.uid('member_a'),
     p_set_department => true, p_department_id => tests.uid('dept_1'))),
  true,
  'Đổi phòng ban không đụng is_active');
select is(
  (select department_id from public.admin_update_user(tests.uid('pm_a'), tests.uid('member_a'),
     p_set_department => true, p_department_id => null)),
  null,
  'Bỏ phòng ban (đặt null)');

-- ===========================================================================
-- Khóa xóa phiên đăng nhập
-- ===========================================================================
insert into auth.sessions (id, user_id, created_at, updated_at)
values (gen_random_uuid(), tests.uid('member_a'), now(), now());
select public.admin_update_user(tests.uid('pm_a'), tests.uid('member_a'), p_is_active => false);
select is(
  (select count(*)::integer from auth.sessions where user_id = tests.uid('member_a')), 0,
  'Khóa tài khoản xóa mọi phiên của người đó');

select * from finish();
rollback;
