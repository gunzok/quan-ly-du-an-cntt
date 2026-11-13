-- QLDA-32 (Story E1-3): RLS của projects và project_members theo vai trò TRONG TỪNG DỰ ÁN.
-- Tiêu chí chấp nhận 1: người có vai trò khác nhau ở hai dự án chỉ thấy và làm đúng theo vai trò
-- từng dự án (pm_a là PM ở A, Người xem ở B). Tiêu chí 2: người ngoài không nhận dòng nào.
-- Mỗi chính sách có ca được phép và ca bị từ chối (test-strategy.md mục 2, NFR-06).
begin;
\ir _helpers.psql
select tests.seed_fixture();

select plan(57);

-- ===========================================================================
-- projects SELECT (projects_select): thành viên dự án và Admin
-- ===========================================================================
select tests.login_as(tests.uid('admin'));
select results_eq('select id from public.projects order by id',
  array[tests.uid('project_a'), tests.uid('project_b')],
  'Admin thấy mọi dự án');

select tests.login_as(tests.uid('pm_a'));
select results_eq('select id from public.projects order by id',
  array[tests.uid('project_a'), tests.uid('project_b')],
  'pm_a (PM ở A, Người xem ở B) thấy cả A và B');

select tests.login_as(tests.uid('pm_b'));
select results_eq('select id from public.projects', array[tests.uid('project_b')],
  'pm_b chỉ thấy dự án B');

select tests.login_as(tests.uid('member_a'));
select results_eq('select id from public.projects', array[tests.uid('project_a')],
  'Thành viên A chỉ thấy dự án A');

select tests.login_as(tests.uid('viewer_a'));
select results_eq('select id from public.projects', array[tests.uid('project_a')],
  'Người xem A chỉ thấy dự án A');

select tests.login_as(tests.uid('outsider'));
select is_empty('select * from public.projects',
  'Người ngoài dự án không thấy dự án nào (BR-10, AC2)');
select is_empty('select * from public.project_members',
  'Người ngoài dự án không thấy thành viên dự án nào (AC2)');
select is(private.project_role_of(tests.uid('project_a')), null,
  'Người ngoài không có vai trò ở dự án A');

select tests.login_as(tests.uid('locked'));
select is_empty('select * from public.projects',
  'Người bị khóa (thành viên A) không thấy dự án nào');

select tests.login_as(tests.uid('locked_admin'));
select is_empty('select * from public.projects',
  'Admin bị khóa không thấy dự án nào');

select tests.login_anon();
select throws_ok('select * from public.projects', '42501', null,
  'anon không có quyền đọc projects');
select throws_ok('select * from public.project_members', '42501', null,
  'anon không có quyền đọc project_members');

-- ===========================================================================
-- project_members SELECT: thành viên cùng dự án và Admin
-- ===========================================================================
select tests.login_as(tests.uid('member_a'));
select is((select count(*)::int from public.project_members), 4,
  'Thành viên A thấy 4 thành viên của A, không thấy thành viên B');
select is((select count(*)::int from public.project_members where project_id = tests.uid('project_b')), 0,
  'Thành viên A không thấy thành viên của dự án B');

select tests.login_as(tests.uid('pm_a'));
select is((select count(*)::int from public.project_members), 6,
  'pm_a thấy thành viên của cả A (4) và B (2)');
select is(private.project_role_of(tests.uid('project_a')), 'pm'::public.project_role,
  'Vai trò của pm_a ở A là pm');
select is(private.project_role_of(tests.uid('project_b')), 'viewer'::public.project_role,
  'Vai trò của pm_a ở B là viewer');

select tests.login_as(tests.uid('admin'));
select is((select count(*)::int from public.project_members), 6, 'Admin thấy mọi thành viên');

-- ===========================================================================
-- projects UPDATE (projects_update): PM của dự án hoặc Admin
-- ===========================================================================
select tests.login_as(tests.uid('pm_a'));
select is(tests.affected_rows($$update public.projects set description = 'pm_a sửa' where id = tests.uid('project_a')$$), 1,
  'PM sửa được dự án mình làm PM');
select is(tests.affected_rows($$update public.projects set description = 'pm_a sửa' where id = tests.uid('project_b')$$), 0,
  'pm_a KHÔNG sửa được dự án B nơi mình là Người xem (AC1)');
select throws_ok($$update public.projects set created_by = tests.uid('pm_a') where id = tests.uid('project_a')$$,
  '42501', null, 'Không ai đổi được created_by từ trình duyệt (quyền cột)');

select tests.login_as(tests.uid('member_a'));
select is(tests.affected_rows($$update public.projects set name = 'x' where id = tests.uid('project_a')$$), 0,
  'Thành viên không sửa được dự án');

select tests.login_as(tests.uid('viewer_a'));
select is(tests.affected_rows($$update public.projects set name = 'x' where id = tests.uid('project_a')$$), 0,
  'Người xem không sửa được dự án');

select tests.login_as(tests.uid('outsider'));
select is(tests.affected_rows($$update public.projects set name = 'x' where id = tests.uid('project_a')$$), 0,
  'Người ngoài không sửa được dự án');

select tests.login_as(tests.uid('admin'));
select is(tests.affected_rows($$update public.projects set status = 'archived' where id = tests.uid('project_b')$$), 1,
  'Admin sửa được dự án không tham gia');

-- PM bị khóa mất quyền sửa.
select tests.logout();
update public.project_members set role = 'pm'
  where project_id = tests.uid('project_a') and user_id = tests.uid('locked');
select tests.login_as(tests.uid('locked'));
select is(tests.affected_rows($$update public.projects set name = 'x' where id = tests.uid('project_a')$$), 0,
  'PM bị khóa không sửa được dự án');

select tests.logout();
select is((select name from public.projects where id = tests.uid('project_a')), 'Dự án A',
  'Tên dự án A không bị các ca bị từ chối thay đổi');

-- ===========================================================================
-- projects INSERT (projects_insert): Admin hoặc người đang là PM ở ít nhất một dự án
-- ===========================================================================
select tests.login_as(tests.uid('pm_b'));
select lives_ok($$insert into public.projects (id, name) values ('00000000-0000-0000-0000-0000000000c0', 'Dự án của pm_b')$$,
  'PM (ở dự án B) tạo được dự án mới');
select is(private.project_role_of('00000000-0000-0000-0000-0000000000c0'), 'pm'::public.project_role,
  'Người tạo tự thành PM của dự án mới (trigger add_creator_as_pm)');
select is((select created_by from public.projects where id = '00000000-0000-0000-0000-0000000000c0'), tests.uid('pm_b'),
  'created_by = người tạo');
select throws_ok($$insert into public.projects (name, created_by) values ('giả mạo', tests.uid('pm_a'))$$,
  '42501', null, 'Không tự đặt created_by thành người khác');

select tests.login_as(tests.uid('pm_a'));
select is((select name from public.create_project('Tạo qua RPC')), 'Tạo qua RPC',
  'create_project() trả về dòng vừa tạo cho PM');

select tests.login_as(tests.uid('admin'));
select lives_ok($$insert into public.projects (name) values ('Dự án của Admin')$$, 'Admin tạo được dự án');

select tests.login_as(tests.uid('member_a'));
select throws_ok($$insert into public.projects (name) values ('x')$$, '42501', null,
  'Thành viên (không là PM ở đâu) không tạo được dự án');
select throws_ok($$select public.create_project('x')$$, '42501', null,
  'Thành viên cũng không tạo được qua create_project()');

select tests.login_as(tests.uid('viewer_a'));
select throws_ok($$insert into public.projects (name) values ('x')$$, '42501', null,
  'Người xem không tạo được dự án');

select tests.login_as(tests.uid('outsider'));
select throws_ok($$insert into public.projects (name) values ('x')$$, '42501', null,
  'Người ngoài không tạo được dự án');

select tests.login_as(tests.uid('locked_admin'));
select throws_ok($$insert into public.projects (name) values ('x')$$, '42501', null,
  'Admin bị khóa không tạo được dự án');

select tests.login_anon();
select throws_ok($$select public.create_project('x')$$, '42501', null,
  'anon không gọi được create_project()');

-- ===========================================================================
-- project_members INSERT/UPDATE/DELETE: chỉ PM của dự án hoặc Admin
-- ===========================================================================
select tests.login_as(tests.uid('pm_a'));
select lives_ok($$insert into public.project_members (project_id, user_id, role) values (tests.uid('project_a'), tests.uid('outsider'), 'member')$$,
  'PM thêm được thành viên vào dự án mình làm PM');
select throws_ok($$insert into public.project_members (project_id, user_id, role) values (tests.uid('project_b'), tests.uid('outsider'), 'member')$$,
  '42501', null, 'pm_a không thêm được thành viên vào dự án B nơi mình là Người xem');

select tests.login_as(tests.uid('outsider'));
select results_eq('select id from public.projects', array[tests.uid('project_a')],
  'Sau khi được thêm, người đó thấy dự án A');

select tests.login_as(tests.uid('member_a'));
select throws_ok($$insert into public.project_members (project_id, user_id, role) values (tests.uid('project_a'), tests.uid('pm_b'), 'member')$$,
  '42501', null, 'Thành viên không thêm được người vào dự án');
select is(tests.affected_rows($$update public.project_members set role = 'pm' where project_id = tests.uid('project_a') and user_id = tests.uid('member_a')$$), 0,
  'Thành viên không tự nâng mình lên PM');
select is(tests.affected_rows($$update public.project_members set role = 'member' where project_id = tests.uid('project_a') and user_id = tests.uid('viewer_a')$$), 0,
  'Thành viên không gán vai trò cho người khác');
select is(tests.affected_rows($$delete from public.project_members where project_id = tests.uid('project_a') and user_id = tests.uid('viewer_a')$$), 0,
  'Thành viên không gỡ được người khác khỏi dự án');

select tests.login_as(tests.uid('viewer_a'));
select throws_ok($$insert into public.project_members (project_id, user_id, role) values (tests.uid('project_a'), tests.uid('pm_b'), 'viewer')$$,
  '42501', null, 'Người xem không thêm được người vào dự án');
select is(tests.affected_rows($$update public.project_members set role = 'pm' where project_id = tests.uid('project_a') and user_id = tests.uid('viewer_a')$$), 0,
  'Người xem không tự nâng vai trò');

select tests.login_as(tests.uid('pm_a'));
select is(tests.affected_rows($$update public.project_members set role = 'member' where project_id = tests.uid('project_a') and user_id = tests.uid('viewer_a')$$), 1,
  'PM đổi được vai trò trong dự án mình làm PM');
select is(tests.affected_rows($$update public.project_members set role = 'pm' where project_id = tests.uid('project_b') and user_id = tests.uid('pm_a')$$), 0,
  'pm_a không tự nâng mình lên PM ở dự án B');
select throws_ok($$update public.project_members set project_id = tests.uid('project_b') where user_id = tests.uid('viewer_a')$$,
  '42501', null, 'Không chuyển thành viên sang dự án khác bằng UPDATE (quyền cột chỉ có role)');
select is(tests.affected_rows($$delete from public.project_members where project_id = tests.uid('project_a') and user_id = tests.uid('outsider')$$), 1,
  'PM gỡ được thành viên khỏi dự án mình làm PM');

select tests.login_as(tests.uid('admin'));
select lives_ok($$insert into public.project_members (project_id, user_id, role) values (tests.uid('project_b'), tests.uid('outsider'), 'viewer')$$,
  'Admin thêm được thành viên vào dự án bất kỳ');
select is(tests.affected_rows($$update public.project_members set role = 'member' where project_id = tests.uid('project_b') and user_id = tests.uid('outsider')$$), 1,
  'Admin đổi được vai trò ở dự án bất kỳ');

-- ===========================================================================
-- projects DELETE (projects_delete_admin): chỉ Admin
-- ===========================================================================
select tests.login_as(tests.uid('pm_a'));
select is(tests.affected_rows($$delete from public.projects where id = tests.uid('project_a')$$), 0,
  'PM không xóa được dự án (database.md mục 5: chỉ Admin toàn quyền)');

select tests.login_as(tests.uid('admin'));
select is(tests.affected_rows($$delete from public.projects where id = tests.uid('project_b')$$), 1,
  'Admin xóa được dự án');
select tests.logout();
select is((select count(*)::int from public.project_members where project_id = tests.uid('project_b')), 0,
  'Xóa dự án xóa theo thành viên dự án (ON DELETE CASCADE)');

select * from finish();
rollback;
