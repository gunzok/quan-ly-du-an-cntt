-- QLDA-33 (Story E1-6): thêm thành viên, gán vai trò, gỡ thành viên (migration
-- 20261115200000_project_members_manage.sql). Kiểm: trigger PM cuối cùng (mọi đường ghi, kể cả
-- Admin và service_role; ngoại lệ xóa dự án, xóa tài khoản), set_project_member() theo từng
-- persona, search_users_for_membership() (chỉ PM/Admin, không lộ người bị khóa), giữ assignee_id
-- khi gỡ thành viên (test-strategy.md mục 2, NFR-06).
begin;
\ir _helpers.psql
select plan(61);

select tests.seed_fixture();

-- ===========================================================================
-- Cấu trúc và quyền thực thi
-- ===========================================================================
select has_trigger('public', 'project_members', 'guard_last_pm', 'Có trigger guard_last_pm');
select has_function('public', 'set_project_member', array['uuid', 'uuid', 'project_role'],
  'Có hàm set_project_member');
select has_function('public', 'search_users_for_membership', array['text', 'uuid', 'integer'],
  'Có hàm search_users_for_membership');
select ok(has_function_privilege('authenticated', 'public.set_project_member(uuid, uuid, public.project_role)', 'execute')
  and not has_function_privilege('anon', 'public.set_project_member(uuid, uuid, public.project_role)', 'execute'),
  'set_project_member: authenticated gọi được, anon thì không');
select ok(has_function_privilege('authenticated', 'public.search_users_for_membership(text, uuid, integer)', 'execute')
  and not has_function_privilege('anon', 'public.search_users_for_membership(text, uuid, integer)', 'execute'),
  'search_users_for_membership: authenticated gọi được, anon thì không');
select ok(not has_function_privilege('authenticated', 'private.guard_last_project_pm()', 'execute'),
  'Hàm trigger guard_last_project_pm không gọi trực tiếp được');
select is(
  (select prosecdef from pg_proc where oid = 'public.set_project_member(uuid, uuid, public.project_role)'::regprocedure),
  false, 'set_project_member là SECURITY INVOKER (RLS áp dụng)');
select is(
  (select prosecdef from pg_proc where oid = 'public.search_users_for_membership(text, uuid, integer)'::regprocedure),
  false, 'search_users_for_membership là SECURITY INVOKER (RLS áp dụng)');
select is(
  pg_get_function_result('public.search_users_for_membership(text, uuid, integer)'::regprocedure),
  'TABLE(id uuid, full_name text, email text, department_id uuid, department_name text)',
  'Tìm người chỉ trả id, họ tên, email, phòng ban (không is_admin, is_active, số điện thoại)');

-- ===========================================================================
-- PM cuối cùng: dự án A chỉ có pm_a là PM
-- ===========================================================================
select tests.login_as(tests.uid('pm_a'));
select throws_ok($$update public.project_members set role = 'member' where project_id = tests.uid('project_a') and user_id = tests.uid('pm_a')$$,
  'P0001', 'last_project_pm', 'PM duy nhất không tự hạ vai trò được');
select throws_ok($$delete from public.project_members where project_id = tests.uid('project_a') and user_id = tests.uid('pm_a')$$,
  'P0001', 'last_project_pm', 'PM duy nhất không tự rời dự án được');
select throws_ok($$select * from public.set_project_member(tests.uid('project_a'), tests.uid('pm_a'), 'viewer')$$,
  'P0001', 'last_project_pm', 'set_project_member cũng bị chặn khi hạ PM duy nhất');

select tests.login_as(tests.uid('admin'));
select throws_ok($$update public.project_members set role = 'viewer' where project_id = tests.uid('project_a') and user_id = tests.uid('pm_a')$$,
  'P0001', 'last_project_pm', 'Admin cũng không hạ được PM duy nhất');
select throws_ok($$delete from public.project_members where project_id = tests.uid('project_a') and user_id = tests.uid('pm_a')$$,
  'P0001', 'last_project_pm', 'Admin cũng không gỡ được PM duy nhất');

select tests.logout();
set local role service_role;
select throws_ok($$delete from public.project_members where project_id = '00000000-0000-0000-0000-00000000000a' and user_id = '00000000-0000-0000-0000-0000000000b1'$$,
  'P0001', 'last_project_pm', 'service_role (bỏ qua RLS) vẫn bị trigger chặn');
select throws_ok($$update public.project_members set user_id = '00000000-0000-0000-0000-0000000000c1' where project_id = '00000000-0000-0000-0000-00000000000a' and user_id = '00000000-0000-0000-0000-0000000000b1'$$,
  'P0001', 'last_project_pm', 'Đổi user_id của dòng PM duy nhất (đường service) cũng bị chặn');
reset role;

-- PM bị khóa không tính là PM còn lại.
update public.project_members set role = 'pm'
  where project_id = tests.uid('project_a') and user_id = tests.uid('locked');
select tests.login_as(tests.uid('pm_a'));
select throws_ok($$update public.project_members set role = 'member' where project_id = tests.uid('project_a') and user_id = tests.uid('pm_a')$$,
  'P0001', 'last_project_pm', 'Chỉ còn PM bị khóa thì PM đang hoạt động cuối cùng không hạ được');
select is(tests.affected_rows($$update public.project_members set role = 'member' where project_id = tests.uid('project_a') and user_id = tests.uid('locked')$$), 1,
  'Hạ PM bị khóa thì được (còn pm_a đang hoạt động)');

-- Có PM thứ hai đang hoạt động: hạ hoặc rời được.
select lives_ok($$select * from public.set_project_member(tests.uid('project_a'), tests.uid('member_a'), 'pm')$$,
  'PM nâng Thành viên lên PM');
select is(tests.affected_rows($$update public.project_members set role = 'member' where project_id = tests.uid('project_a') and user_id = tests.uid('pm_a')$$), 1,
  'Có PM khác đang hoạt động: PM tự hạ vai trò được');
select tests.login_as(tests.uid('member_a'));
select throws_ok($$delete from public.project_members where project_id = tests.uid('project_a') and user_id = tests.uid('member_a')$$,
  'P0001', 'last_project_pm', 'PM mới (giờ là duy nhất) không tự rời được');
select is(tests.affected_rows($$update public.project_members set role = 'pm' where project_id = tests.uid('project_a') and user_id = tests.uid('pm_a')$$), 1,
  'PM mới trả lại vai trò PM cho pm_a');
select is(tests.affected_rows($$update public.project_members set role = 'member' where project_id = tests.uid('project_a') and user_id = tests.uid('member_a')$$), 1,
  'Rồi tự hạ về Thành viên');
select tests.login_as(tests.uid('pm_a'));
select is(
  (select array_agg(user_id order by user_id) from public.project_members where project_id = tests.uid('project_a') and role = 'pm'),
  array[tests.uid('pm_a')], 'Dự án A trở lại một PM là pm_a');

-- Hạ PM (không phải PM) không bị trigger chạm vào: Thành viên → Người xem.
select is(tests.affected_rows($$update public.project_members set role = 'viewer' where project_id = tests.uid('project_a') and user_id = tests.uid('member_a')$$), 1,
  'Đổi vai trò người không phải PM không qua kiểm PM cuối cùng');
update public.project_members set role = 'member'
  where project_id = tests.uid('project_a') and user_id = tests.uid('member_a');

-- ===========================================================================
-- set_project_member theo persona
-- ===========================================================================
select tests.login_as(tests.uid('pm_a'));
select results_eq(
  $$select user_id, role::text, created from public.set_project_member(tests.uid('project_a'), tests.uid('outsider'), 'viewer')$$,
  $$values (tests.uid('outsider'), 'viewer', true)$$,
  'AC1: PM thêm người ngoài làm Người xem, created = true');
select results_eq(
  $$select role::text, created from public.set_project_member(tests.uid('project_a'), tests.uid('outsider'), 'viewer')$$,
  $$values ('viewer', false)$$,
  'Thêm lại cùng vai trò: không lỗi, created = false (PUT lặp lại vô hại)');
select results_eq(
  $$select role::text, created from public.set_project_member(tests.uid('project_a'), tests.uid('outsider'), 'member')$$,
  $$values ('member', false)$$,
  'Đổi vai trò Người xem → Thành viên, created = false');

select tests.login_as(tests.uid('outsider'));
select results_eq(
  $$select p.id, m.role::text from public.projects p
    join public.project_members m on m.project_id = p.id and m.user_id = auth.uid()$$,
  $$values (tests.uid('project_a'), 'member')$$,
  'AC1: người được thêm thấy dự án A với đúng vai trò');

select tests.login_as(tests.uid('pm_a'));
select throws_ok($$select * from public.set_project_member(tests.uid('project_a'), tests.uid('locked'), 'viewer')$$,
  'P0001', 'member_user_inactive', 'Không gán vai trò cho người bị khóa');
select throws_ok($$select * from public.set_project_member(tests.uid('project_a'), '00000000-0000-0000-0000-00000000dead', 'viewer')$$,
  'P0001', 'member_user_inactive', 'Không thêm người không tồn tại');
select throws_ok($$select * from public.set_project_member(tests.uid('project_b'), tests.uid('outsider'), 'member')$$,
  '42501', 'member_forbidden', 'pm_a là Người xem ở dự án B: không thêm được');

select tests.login_as(tests.uid('member_a'));
select throws_ok($$select * from public.set_project_member(tests.uid('project_a'), tests.uid('pm_b'), 'member')$$,
  '42501', 'member_forbidden', 'AC2: Thành viên không thêm người được');
select throws_ok($$select * from public.set_project_member(tests.uid('project_a'), tests.uid('member_a'), 'pm')$$,
  '42501', 'member_forbidden', 'AC2: Thành viên không tự nâng lên PM');
select throws_ok($$select * from public.set_project_member(tests.uid('project_a'), '00000000-0000-0000-0000-00000000dead', 'pm')$$,
  '42501', 'member_forbidden', 'Không có quyền thì bị từ chối trước khi kiểm người đích (không dò được ai tồn tại)');

select tests.login_as(tests.uid('viewer_a'));
select throws_ok($$select * from public.set_project_member(tests.uid('project_a'), tests.uid('viewer_a'), 'member')$$,
  '42501', 'member_forbidden', 'AC2: Người xem không tự nâng vai trò');

select tests.login_as(tests.uid('pm_b'));
select throws_ok($$select * from public.set_project_member(tests.uid('project_a'), tests.uid('pm_b'), 'pm')$$,
  '42501', 'member_forbidden', 'PM dự án khác không thêm mình vào dự án A');

select tests.login_as(tests.uid('locked'));
select throws_ok($$select * from public.set_project_member(tests.uid('project_a'), tests.uid('outsider'), 'viewer')$$,
  '42501', 'member_forbidden', 'Người bị khóa không gán vai trò được');
select tests.login_as(tests.uid('locked_admin'));
select throws_ok($$select * from public.set_project_member(tests.uid('project_a'), tests.uid('outsider'), 'viewer')$$,
  '42501', 'member_forbidden', 'Admin bị khóa không gán vai trò được');

select tests.login_anon();
select throws_ok($$select * from public.set_project_member(tests.uid('project_a'), tests.uid('outsider'), 'viewer')$$,
  '42501', null, 'anon không gọi được set_project_member');

select tests.login_as(tests.uid('admin'));
select results_eq(
  $$select role::text, created from public.set_project_member(tests.uid('project_b'), tests.uid('outsider'), 'pm')$$,
  $$values ('pm', true)$$,
  'Admin (không thuộc dự án B) thêm người làm PM dự án B');
select tests.logout();
select is(
  (select count(*)::int from public.activity_logs
    where entity_type = 'project_member' and project_id = tests.uid('project_b')
      and entity_id = tests.uid('outsider') and action = 'create' and actor_id = tests.uid('admin')),
  1, 'Thêm thành viên được ghi nhật ký (E6-1) với người thực hiện');

-- ===========================================================================
-- Gỡ thành viên: giữ assignee_id cũ trên task (quyết định E2-2)
-- ===========================================================================
insert into public.tasks (id, project_id, title, created_by, assignee_id) values
  ('00000000-0000-0000-0000-000000009001', tests.uid('project_a'), 'Task giao cho outsider',
   tests.uid('pm_a'), tests.uid('outsider'));
select tests.login_as(tests.uid('pm_a'));
select is(tests.affected_rows($$delete from public.project_members where project_id = tests.uid('project_a') and user_id = tests.uid('outsider')$$), 1,
  'PM gỡ thành viên khỏi dự án');
select tests.logout();
select is(
  (select assignee_id from public.tasks where id = '00000000-0000-0000-0000-000000009001'),
  tests.uid('outsider'), 'Task của người bị gỡ vẫn giữ assignee_id cũ');
select tests.login_as(tests.uid('outsider'));
select is((select count(*)::int from public.projects where id = tests.uid('project_a')), 0,
  'Người bị gỡ không còn thấy dự án A');

-- ===========================================================================
-- Xóa dự án, xóa tài khoản: ngoại lệ của trigger
-- ===========================================================================
select tests.login_as(tests.uid('admin'));
select is(tests.affected_rows($$delete from public.projects where id = tests.uid('project_b')$$), 1,
  'Admin xóa cả dự án B: thành viên (kể cả PM cuối) xóa theo, trigger không chặn');
select tests.logout();
select is((select count(*)::int from public.project_members where project_id = tests.uid('project_b')), 0,
  'Không còn thành viên nào của dự án B');
insert into public.projects (id, name, created_by) values
  ('00000000-0000-0000-0000-00000000000c', 'Dự án C', tests.uid('pm_b'));
select lives_ok($$delete from auth.users where id = tests.uid('pm_b')$$,
  'Xóa hẳn tài khoản PM duy nhất của dự án C: không bị trigger chặn (xóa dây chuyền)');

-- ===========================================================================
-- Tìm người để thêm
-- ===========================================================================
select tests.login_as(tests.uid('pm_a'));
select results_eq(
  $$select id, full_name, email from public.search_users_for_membership('outsider')$$,
  $$values (tests.uid('outsider'), 'Outsider', 'outsider@test.example')$$,
  'PM tìm người theo họ tên/email');
select results_eq(
  $$select id from public.search_users_for_membership('OUTSIDER@TEST')$$,
  $$values (tests.uid('outsider'))$$,
  'Không phân biệt hoa thường, tìm được theo email');
select is((select count(*)::int from public.search_users_for_membership('locked')), 0,
  'Không lộ người bị khóa (kể cả Admin bị khóa)');
select is((select count(*)::int from public.search_users_for_membership('   ')), 0,
  'Chuỗi rỗng: không trả ai');
select is((select count(*)::int from public.search_users_for_membership('%')), 0,
  '% là ký tự thường, không phải ký tự đại diện');
select ok(
  tests.uid('member_a') not in (select id from public.search_users_for_membership('member', tests.uid('project_a'))),
  'Bỏ người đã là thành viên của dự án đang thêm');
select is((select count(*)::int from public.search_users_for_membership('test.example', null, 1000)), 5,
  'Trả mọi người đang hoạt động khớp (5), giới hạn tối đa 20 dòng');
select tests.logout();
insert into auth.users (id, email, raw_user_meta_data)
  select gen_random_uuid(), format('bulk%s@test.example', g), '{"full_name":"Bulk"}'
  from generate_series(1, 25) g;
select tests.login_as(tests.uid('pm_a'));
select is((select count(*)::int from public.search_users_for_membership('bulk', null, 1000)), 20,
  'Không vượt 20 dòng dù xin nhiều hơn');

select tests.login_as(tests.uid('admin'));
select is((select count(*)::int from public.search_users_for_membership('outsider')), 1,
  'Admin tìm được người');
select tests.login_as(tests.uid('member_a'));
select throws_ok($$select * from public.search_users_for_membership('outsider')$$,
  '42501', 'member_search_forbidden', 'Thành viên (không là PM ở dự án nào) không dùng được tìm người');
select tests.login_as(tests.uid('viewer_a'));
select throws_ok($$select * from public.search_users_for_membership('outsider')$$,
  '42501', 'member_search_forbidden', 'Người xem không dùng được tìm người');
select tests.login_as(tests.uid('locked_admin'));
select throws_ok($$select * from public.search_users_for_membership('outsider')$$,
  '42501', 'member_search_forbidden', 'Admin bị khóa không dùng được tìm người');
select tests.login_anon();
select throws_ok($$select * from public.search_users_for_membership('outsider')$$,
  '42501', null, 'anon không gọi được tìm người');

select * from finish();
rollback;
