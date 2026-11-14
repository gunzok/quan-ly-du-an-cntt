-- QLDA-38 (Story E2-2): RLS, quyền cột và ràng buộc của bảng tasks.
-- Mỗi chính sách có ca được phép và ca bị từ chối cho: PM, Thành viên là người tạo, Thành viên
-- là người phụ trách, Thành viên không phải người tạo hay phụ trách, Người xem, Admin, người
-- ngoài dự án, người bị khóa, Admin bị khóa, anon (test-strategy.md mục 2, NFR-06).
-- Ràng buộc ngày BR-13 (tiêu chí chấp nhận 2) và người được giao phải thuộc dự án.
begin;
\ir _helpers.psql
select tests.seed_fixture();

-- Thêm một Thành viên thứ hai của dự án A (không tạo, không phụ trách task nào) và dữ liệu task.
--   task_m   (…7001) A, do member_a tạo, chưa giao
--   task_as  (…7002) A, do pm_a tạo, giao cho member_a
--   task_pm  (…7003) A, do pm_a tạo, chưa giao
--   task_b   (…7004) B, do pm_b tạo
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000c2', 'member2_a@test.example', '{"full_name":"Member 2 A"}');
insert into public.project_members (project_id, user_id, role) values
  (tests.uid('project_a'), '00000000-0000-0000-0000-0000000000c2', 'member');

create function tests.t(name text)
returns uuid
language sql
immutable
as $$
  select case name
    when 'member2' then '00000000-0000-0000-0000-0000000000c2'
    when 'task_m' then '00000000-0000-0000-0000-000000007001'
    when 'task_as' then '00000000-0000-0000-0000-000000007002'
    when 'task_pm' then '00000000-0000-0000-0000-000000007003'
    when 'task_b' then '00000000-0000-0000-0000-000000007004'
  end::uuid;
$$;
grant execute on function tests.t(text) to anon, authenticated;

insert into public.tasks (id, project_id, title, created_by, assignee_id) values
  (tests.t('task_m'), tests.uid('project_a'), 'Task của member_a', tests.uid('member_a'), null),
  (tests.t('task_as'), tests.uid('project_a'), 'Task giao cho member_a', tests.uid('pm_a'), tests.uid('member_a')),
  (tests.t('task_pm'), tests.uid('project_a'), 'Task của pm_a', tests.uid('pm_a'), null),
  (tests.t('task_b'), tests.uid('project_b'), 'Task dự án B', tests.uid('pm_b'), null);

select plan(74);

-- ===========================================================================
-- Cấu trúc
-- ===========================================================================
select has_table('public', 'tasks', 'Có bảng public.tasks');
select col_type_is('public', 'tasks', 'priority', 'task_priority', 'priority dùng enum task_priority');
select col_default_is('public', 'tasks', 'priority', 'medium'::public.task_priority, 'priority mặc định medium');
select col_default_is('public', 'tasks', 'depth', '1', 'depth mặc định 1');
select col_is_null('public', 'tasks', 'parent_id', 'parent_id cho phép null');
select col_is_null('public', 'tasks', 'status_id', 'status_id cho phép null (khóa ngoại thêm ở E2-3)');
select has_index('public', 'tasks', 'tasks_project_status_position_idx', 'Chỉ mục Kanban');
select has_index('public', 'tasks', 'tasks_project_assignee_idx', 'Chỉ mục người phụ trách');
select has_index('public', 'tasks', 'tasks_project_due_date_idx', 'Chỉ mục hạn chót');
select has_index('public', 'tasks', 'tasks_parent_id_idx', 'Chỉ mục subtask');
select is((select relrowsecurity from pg_class where oid = 'public.tasks'::regclass), true,
  'RLS bật trên tasks');

-- ===========================================================================
-- SELECT (tasks_select): mọi vai trò trong dự án và Admin
-- ===========================================================================
select tests.login_as(tests.uid('admin'));
select is((select count(*)::int from public.tasks), 4, 'Admin thấy mọi task');

select tests.login_as(tests.uid('pm_a'));
select is((select count(*)::int from public.tasks), 4,
  'pm_a (PM ở A, Người xem ở B) thấy task của A và B');

select tests.login_as(tests.uid('member_a'));
select is((select count(*)::int from public.tasks), 3, 'Thành viên A thấy 3 task của A');
select is_empty(format('select 1 from public.tasks where id = %L', tests.t('task_b')),
  'Thành viên A không thấy task dự án B');

select tests.login_as(tests.t('member2'));
select is((select count(*)::int from public.tasks), 3,
  'Thành viên không tạo, không phụ trách vẫn đọc mọi task của A');

select tests.login_as(tests.uid('viewer_a'));
select is((select count(*)::int from public.tasks), 3, 'Người xem A đọc được task của A');

select tests.login_as(tests.uid('outsider'));
select is_empty('select * from public.tasks', 'Người ngoài dự án không thấy task nào (BR-10)');

select tests.login_as(tests.uid('locked'));
select is_empty('select * from public.tasks', 'Người bị khóa không thấy task nào');

select tests.login_as(tests.uid('locked_admin'));
select is_empty('select * from public.tasks', 'Admin bị khóa không thấy task nào');

select tests.login_anon();
select throws_ok('select * from public.tasks', '42501', null, 'anon không có quyền đọc tasks');

-- ===========================================================================
-- INSERT (tasks_insert): PM, Thành viên, Admin; Người xem và người ngoài không
-- ===========================================================================
select tests.login_as(tests.uid('pm_a'));
select lives_ok(format(
  'insert into public.tasks (project_id, title, priority) values (%L, ''PM tạo'', ''high'')',
  tests.uid('project_a')), 'PM tạo task trong dự án mình');
select is((select created_by from public.tasks where title = 'PM tạo'), tests.uid('pm_a'),
  'created_by tự lấy auth.uid()');

select tests.login_as(tests.uid('member_a'));
select lives_ok(format(
  'insert into public.tasks (project_id, title, assignee_id) values (%L, ''Member tạo'', %L)',
  tests.uid('project_a'), tests.t('member2')), 'Thành viên tạo task, giao cho thành viên khác');

select tests.login_as(tests.uid('admin'));
select lives_ok(format(
  'insert into public.tasks (project_id, title) values (%L, ''Admin tạo'')',
  tests.uid('project_b')), 'Admin tạo task ở dự án mình không là thành viên');

select tests.login_as(tests.uid('viewer_a'));
select throws_ok(format(
  'insert into public.tasks (project_id, title) values (%L, ''x'')', tests.uid('project_a')),
  '42501', null, 'Người xem không tạo được task (BR-02)');

select tests.login_as(tests.uid('pm_a'));
select throws_ok(format(
  'insert into public.tasks (project_id, title) values (%L, ''x'')', tests.uid('project_b')),
  '42501', null, 'pm_a là Người xem ở B nên không tạo task ở B (vai trò theo dự án)');

select tests.login_as(tests.uid('outsider'));
select throws_ok(format(
  'insert into public.tasks (project_id, title) values (%L, ''x'')', tests.uid('project_a')),
  '42501', null, 'Người ngoài dự án không tạo được task');

select tests.login_as(tests.uid('locked'));
select throws_ok(format(
  'insert into public.tasks (project_id, title) values (%L, ''x'')', tests.uid('project_a')),
  '42501', null, 'Người bị khóa không tạo được task');

select tests.login_as(tests.uid('locked_admin'));
select throws_ok(format(
  'insert into public.tasks (project_id, title) values (%L, ''x'')', tests.uid('project_a')),
  '42501', null, 'Admin bị khóa không tạo được task');

select tests.login_anon();
select throws_ok(format(
  'insert into public.tasks (project_id, title) values (%L, ''x'')', tests.uid('project_a')),
  '42501', null, 'anon không tạo được task');

-- Quyền cột: không tự đặt người tạo, cha, cấp, trạng thái, loại, completed_at.
select tests.login_as(tests.uid('member_a'));
select throws_ok(format(
  'insert into public.tasks (project_id, title, created_by) values (%L, ''x'', %L)',
  tests.uid('project_a'), tests.uid('pm_a')),
  '42501', null, 'Không giả mạo created_by khi tạo');
select throws_ok(format(
  'insert into public.tasks (project_id, title, parent_id) values (%L, ''x'', %L)',
  tests.uid('project_a'), tests.t('task_m')),
  '42501', null, 'Chưa ghi được parent_id (subtask là Story E2-4)');
select throws_ok(format(
  'insert into public.tasks (project_id, title, status_id) values (%L, ''x'', gen_random_uuid())',
  tests.uid('project_a')),
  '42501', null, 'Chưa ghi được status_id (trạng thái là Story E2-3)');

-- ===========================================================================
-- UPDATE (tasks_update): PM, Admin mọi task; Thành viên chỉ task mình tạo hoặc phụ trách (BR-03)
-- ===========================================================================
select tests.login_as(tests.uid('pm_a'));
select is(tests.affected_rows(format(
  'update public.tasks set title = ''PM sửa'' where id = %L', tests.t('task_m'))), 1,
  'PM sửa được task do Thành viên tạo');
select is(tests.affected_rows(format(
  'update public.tasks set title = ''x'' where id = %L', tests.t('task_b'))), 0,
  'pm_a (Người xem ở B) không sửa được task của B');

select tests.login_as(tests.uid('member_a'));
select is(tests.affected_rows(format(
  'update public.tasks set priority = ''urgent'' where id = %L', tests.t('task_m'))), 1,
  'Thành viên sửa được task mình tạo');
select is(tests.affected_rows(format(
  'update public.tasks set priority = ''low'' where id = %L', tests.t('task_as'))), 1,
  'Thành viên sửa được task mình phụ trách');
select is(tests.affected_rows(format(
  'update public.tasks set title = ''x'' where id = %L', tests.t('task_pm'))), 0,
  'Thành viên không sửa được task người khác tạo và không giao cho mình (BR-03)');
select throws_ok(format(
  'update public.tasks set assignee_id = %L where id = %L', tests.t('member2'), tests.t('task_as')),
  '42501', null,
  'Thành viên chỉ phụ trách (không tạo) không giao task đi cho người khác');
select lives_ok(format(
  'update public.tasks set assignee_id = %L where id = %L', tests.t('member2'), tests.t('task_m')),
  'Thành viên là người tạo giao task cho thành viên khác');
select throws_ok(format(
  'update public.tasks set project_id = %L where id = %L', tests.uid('project_b'), tests.t('task_m')),
  '42501', null, 'Không chuyển task sang dự án khác (không có quyền cột project_id)');
select throws_ok(format(
  'update public.tasks set created_by = %L where id = %L', tests.t('member2'), tests.t('task_m')),
  '42501', null, 'Không đổi created_by');
select throws_ok(format(
  'update public.tasks set completed_at = now() where id = %L', tests.t('task_m')),
  '42501', null, 'Chưa ghi được completed_at (theo trạng thái, Story E2-3)');

select tests.login_as(tests.t('member2'));
select is(tests.affected_rows(format(
  'update public.tasks set title = ''x'' where id = %L', tests.t('task_pm'))), 0,
  'Thành viên không tạo, không phụ trách không sửa được task');

select tests.login_as(tests.uid('viewer_a'));
select is(tests.affected_rows(format(
  'update public.tasks set title = ''x'' where id = %L', tests.t('task_m'))), 0,
  'Người xem không sửa được task (BR-02)');

select tests.login_as(tests.uid('outsider'));
select is(tests.affected_rows(format(
  'update public.tasks set title = ''x'' where id = %L', tests.t('task_m'))), 0,
  'Người ngoài không sửa được task');

select tests.login_as(tests.uid('locked'));
select is(tests.affected_rows(format(
  'update public.tasks set title = ''x'' where id = %L', tests.t('task_m'))), 0,
  'Người bị khóa không sửa được task (kể cả task từng tạo ở A)');

select tests.login_as(tests.uid('locked_admin'));
select is(tests.affected_rows(format(
  'update public.tasks set title = ''x'' where id = %L', tests.t('task_m'))), 0,
  'Admin bị khóa không sửa được task');

select tests.login_as(tests.uid('admin'));
select is(tests.affected_rows(format(
  'update public.tasks set title = ''Admin sửa'' where id = %L', tests.t('task_b'))), 1,
  'Admin sửa được mọi task');

-- ===========================================================================
-- Ràng buộc: BR-13, tên, người được giao
-- ===========================================================================
select tests.login_as(tests.uid('pm_a'));
select throws_ok(format(
  'insert into public.tasks (project_id, title, start_date, due_date) values (%L, ''x'', ''2026-12-10'', ''2026-12-05'')',
  tests.uid('project_a')), '23514', null,
  'BR-13: tạo task có ngày kết thúc sớm hơn ngày bắt đầu bị từ chối');
select lives_ok(format(
  'insert into public.tasks (project_id, title, start_date, due_date) values (%L, ''Cùng ngày'', ''2026-12-05'', ''2026-12-05'')',
  tests.uid('project_a')), 'BR-13: ngày bắt đầu bằng ngày kết thúc hợp lệ');
select lives_ok(format(
  'update public.tasks set start_date = ''2026-12-01'', due_date = ''2026-12-20'' where id = %L',
  tests.t('task_pm')), 'Đặt khoảng ngày hợp lệ');
select throws_ok(format(
  'update public.tasks set due_date = ''2026-11-30'' where id = %L', tests.t('task_pm')),
  '23514', null, 'BR-13: sửa ngày kết thúc sớm hơn ngày bắt đầu bị từ chối');
select throws_ok(format(
  'insert into public.tasks (project_id, title) values (%L, ''   '')', tests.uid('project_a')),
  '23514', null, 'Tên task chỉ có khoảng trắng bị từ chối');
select throws_ok(format(
  'insert into public.tasks (project_id, title, position) values (%L, ''x'', ''NaN'')', tests.uid('project_a')),
  '23514', null, 'position NaN bị từ chối');

select throws_ok(format(
  'insert into public.tasks (project_id, title, assignee_id) values (%L, ''x'', %L)',
  tests.uid('project_a'), tests.uid('outsider')),
  'P0001', 'assignee_not_member', 'Không giao việc cho người ngoài dự án');
select throws_ok(format(
  'insert into public.tasks (project_id, title, assignee_id) values (%L, ''x'', %L)',
  tests.uid('project_a'), tests.uid('pm_b')),
  'P0001', 'assignee_not_member', 'Không giao việc cho người chỉ thuộc dự án khác');
select throws_ok(format(
  'insert into public.tasks (project_id, title, assignee_id) values (%L, ''x'', %L)',
  tests.uid('project_a'), tests.uid('viewer_a')),
  'P0001', 'assignee_not_member', 'Không giao việc cho Người xem (chỉ đọc)');
select throws_ok(format(
  'update public.tasks set assignee_id = %L where id = %L', tests.uid('locked'), tests.t('task_pm')),
  'P0001', 'assignee_not_member', 'Không giao việc cho thành viên bị khóa');
select lives_ok(format(
  'update public.tasks set assignee_id = %L where id = %L', tests.uid('pm_a'), tests.t('task_pm')),
  'Giao việc cho PM của dự án');

-- ===========================================================================
-- DELETE (tasks_delete): PM, Admin; Thành viên chỉ task mình tạo (xóa vĩnh viễn, BR-11)
-- ===========================================================================
select tests.login_as(tests.uid('member_a'));
select is(tests.affected_rows(format(
  'delete from public.tasks where id = %L', tests.t('task_as'))), 0,
  'Thành viên không xóa task chỉ được giao (không phải người tạo)');
select tests.login_as(tests.t('member2'));
select is(tests.affected_rows(format(
  'delete from public.tasks where id = %L', tests.t('task_m'))), 0,
  'Thành viên không xóa task người khác tạo dù đang phụ trách');
select tests.login_as(tests.uid('viewer_a'));
select is(tests.affected_rows(format(
  'delete from public.tasks where id = %L', tests.t('task_m'))), 0, 'Người xem không xóa được task');
select tests.login_as(tests.uid('outsider'));
select is(tests.affected_rows(format(
  'delete from public.tasks where id = %L', tests.t('task_m'))), 0, 'Người ngoài không xóa được task');
select tests.login_as(tests.uid('locked'));
select is(tests.affected_rows(format(
  'delete from public.tasks where id = %L', tests.t('task_m'))), 0, 'Người bị khóa không xóa được task');
select tests.login_as(tests.uid('locked_admin'));
select is(tests.affected_rows(format(
  'delete from public.tasks where id = %L', tests.t('task_b'))), 0, 'Admin bị khóa không xóa được task');
select tests.login_as(tests.uid('pm_a'));
select is(tests.affected_rows(format(
  'delete from public.tasks where id = %L', tests.t('task_b'))), 0,
  'pm_a (Người xem ở B) không xóa task của B');
select tests.login_anon();
select throws_ok(format('delete from public.tasks where id = %L', tests.t('task_m')),
  '42501', null, 'anon không xóa được task');

select tests.login_as(tests.uid('member_a'));
select is(tests.affected_rows(format(
  'delete from public.tasks where id = %L', tests.t('task_m'))), 1, 'Thành viên xóa được task mình tạo');
select tests.login_as(tests.uid('pm_a'));
select is(tests.affected_rows(format(
  'delete from public.tasks where id = %L', tests.t('task_as'))), 1, 'PM xóa được task trong dự án');
select tests.login_as(tests.uid('admin'));
select is(tests.affected_rows(format(
  'delete from public.tasks where id = %L', tests.t('task_b'))), 1, 'Admin xóa được mọi task');

select tests.logout();
select is((select count(*)::int from public.tasks where id in (tests.t('task_m'), tests.t('task_as'), tests.t('task_b'))), 0,
  'Xóa là vĩnh viễn: dòng không còn trong bảng (BR-11)');

-- Xóa dự án xóa theo task (database.md mục 7).
delete from public.projects where id = tests.uid('project_a');
select is((select count(*)::int from public.tasks where project_id = tests.uid('project_a')), 0,
  'Xóa dự án xóa theo mọi task của dự án');

select * from finish();
rollback;
