-- QLDA-41 (Story E2-3): trạng thái, loại task, nhãn theo dự án (migration
-- 20261115130000_task_statuses_types_labels.sql). Mỗi chính sách có ca được phép và ca bị từ chối
-- cho PM, Thành viên, Người xem, Admin, người ngoài, người bị khóa, Admin bị khóa, anon; ràng buộc
-- cùng dự án; completed_at tự đặt; danh sách mặc định và backfill (test-strategy.md mục 2, NFR-06).
begin;
\ir _helpers.psql

-- ===========================================================================
-- Backfill (kiểm trên dữ liệu sẵn có TRƯỚC khi fixture xóa sạch)
-- ===========================================================================
select plan(124);

select is(
  (select count(*)::int from public.projects p
   where not exists (select 1 from public.task_statuses s where s.project_id = p.id and s.category = 'todo')
      or not exists (select 1 from public.task_statuses s where s.project_id = p.id and s.category = 'done')
      or not exists (select 1 from public.task_types ty where ty.project_id = p.id)),
  0, 'Backfill: mọi dự án sẵn có đều có trạng thái todo, done và loại task');
select is(
  (select count(*)::int from public.tasks t
   where (t.completed_at is not null) is distinct from exists (
     select 1 from public.task_statuses s where s.id = t.status_id and s.category = 'done')),
  0, 'Backfill: completed_at có giá trị khi và chỉ khi trạng thái thuộc nhóm done');

select tests.seed_fixture();

-- Ký hiệu: trạng thái/loại theo tên trong một dự án; task mẫu.
create function tests.st(project text, status_name text)
returns uuid language sql stable security definer set search_path = public as $$
  select id from public.task_statuses where project_id = tests.uid(project) and name = status_name;
$$;
create function tests.ty(project text, type_name text)
returns uuid language sql stable security definer set search_path = public as $$
  select id from public.task_types where project_id = tests.uid(project) and name = type_name;
$$;
-- Tra id bỏ qua RLS (SECURITY DEFINER) để ca kiểm "dự án khác" có id thật dù người gọi không thấy.
create function tests.lb(project text, label_name text)
returns uuid language sql stable security definer set search_path = public as $$
  select id from public.labels where project_id = tests.uid(project) and name = label_name;
$$;
create function tests.task(name text)
returns uuid language sql immutable as $$
  select case name
    when 'task_m' then '00000000-0000-0000-0000-000000008001'
    when 'task_pm' then '00000000-0000-0000-0000-000000008002'
    when 'task_b' then '00000000-0000-0000-0000-000000008003'
    when 'task_done' then '00000000-0000-0000-0000-000000008004'
  end::uuid;
$$;
grant execute on all functions in schema tests to anon, authenticated;

insert into public.tasks (id, project_id, title, created_by) values
  (tests.task('task_m'), tests.uid('project_a'), 'Task của member_a', tests.uid('member_a')),
  (tests.task('task_pm'), tests.uid('project_a'), 'Task của pm_a', tests.uid('pm_a')),
  (tests.task('task_b'), tests.uid('project_b'), 'Task dự án B', tests.uid('pm_b'));
insert into public.tasks (id, project_id, title, created_by, completed_at) values
  (tests.task('task_done'), tests.uid('project_a'), 'Đã xong từ trước', tests.uid('pm_a'), '2030-01-01T00:00:00Z');

-- ===========================================================================
-- Cấu trúc
-- ===========================================================================
select has_table('public', 'task_statuses', 'Có bảng task_statuses');
select has_table('public', 'task_types', 'Có bảng task_types');
select has_table('public', 'labels', 'Có bảng labels');
select has_table('public', 'task_labels', 'Có bảng task_labels');
select is(
  (select count(*)::int from pg_class
   where oid in ('public.task_statuses'::regclass, 'public.task_types'::regclass,
                 'public.labels'::regclass, 'public.task_labels'::regclass)
     and relrowsecurity),
  4, 'RLS bật trên cả bốn bảng');
select col_not_null('public', 'tasks', 'type_id', 'tasks.type_id bắt buộc');
select fk_ok('public', 'tasks', array['project_id', 'status_id'],
  'public', 'task_statuses', array['project_id', 'id'],
  'Khóa ngoại kép tasks (project_id, status_id) → task_statuses (project_id, id)');
select fk_ok('public', 'tasks', array['project_id', 'type_id'],
  'public', 'task_types', array['project_id', 'id'],
  'Khóa ngoại kép tasks (project_id, type_id) → task_types (project_id, id)');
select has_index('public', 'tasks', 'tasks_project_type_idx', 'Chỉ mục tasks (project_id, type_id)');
select has_index('public', 'task_labels', 'task_labels_label_id_idx', 'Chỉ mục task_labels (label_id)');

-- ===========================================================================
-- Mặc định khi tạo dự án (AC1) và hàm backfill
-- ===========================================================================
select results_eq(
  $$select name, category::text from public.task_statuses
    where project_id = tests.uid('project_a') order by position$$,
  $$values ('Mới', 'todo'), ('Đang thực hiện', 'in_progress'), ('Đang kiểm thử', 'in_progress'),
           ('Cần phản hồi', 'in_progress'), ('Đã xong', 'done'), ('Đã đóng', 'done'),
           ('Từ chối', 'done')$$,
  'AC1: dự án mới có 7 trạng thái mặc định theo OpenProject, đúng nhóm và thứ tự');
select results_eq(
  $$select name, is_milestone from public.task_types
    where project_id = tests.uid('project_a') order by position$$,
  $$values ('Task', false), ('Bug', false), ('Milestone', true), ('Phase', false)$$,
  'AC1: dự án mới có loại Task, Bug, Milestone (mốc), Phase');
select is((select count(*)::int from public.labels where project_id = tests.uid('project_a')), 0,
  'Dự án mới chưa có nhãn');

select tests.login_as(tests.uid('pm_a'));
select lives_ok($$select public.create_project('Dự án qua RPC')$$, 'PM tạo dự án qua create_project()');
select is(
  (select count(*)::int from public.task_statuses s join public.projects p on p.id = s.project_id
   where p.name = 'Dự án qua RPC'),
  7, 'Dự án do PM tạo (RLS) cũng có đủ trạng thái mặc định');
select tests.logout();

-- Mô phỏng dự án có từ trước migration: tắt trigger trong giao dịch test.
alter table public.projects disable trigger seed_config_defaults;
insert into public.projects (id, name) values ('00000000-0000-0000-0000-0000000000cc', 'Dự án cũ');
alter table public.projects enable trigger seed_config_defaults;
select is((select count(*)::int from public.task_statuses where project_id = '00000000-0000-0000-0000-0000000000cc'),
  0, 'Dự án tạo khi chưa có trigger thì chưa có trạng thái');
select private.seed_project_defaults('00000000-0000-0000-0000-0000000000cc');
select private.seed_project_defaults('00000000-0000-0000-0000-0000000000cc');
select is(
  (select count(*)::int from public.task_statuses where project_id = '00000000-0000-0000-0000-0000000000cc')
  + (select count(*)::int from public.task_types where project_id = '00000000-0000-0000-0000-0000000000cc'),
  11, 'Hàm backfill thêm 7 trạng thái + 4 loại, gọi lại không nhân đôi');
select ok(not has_function_privilege('authenticated', 'private.seed_project_defaults(uuid)', 'execute'),
  'Trình duyệt không gọi được hàm sinh mặc định');

-- ===========================================================================
-- Task: mặc định, cùng dự án, completed_at
-- ===========================================================================
select is((select status_id from public.tasks where id = tests.task('task_m')), tests.st('project_a', 'Mới'),
  'Task mới không gửi status_id lấy trạng thái todo đầu tiên ("Mới")');
select is((select type_id from public.tasks where id = tests.task('task_m')), tests.ty('project_a', 'Task'),
  'Task mới không gửi type_id lấy loại "Task"');
select is((select status_id from public.tasks where id = tests.task('task_done')), tests.st('project_a', 'Đã xong'),
  'Task chèn kèm completed_at (nhập dữ liệu) lấy trạng thái done đầu tiên');
select is((select completed_at from public.tasks where id = tests.task('task_done')), '2030-01-01T00:00:00Z'::timestamptz,
  'completed_at có sẵn được giữ nguyên');

select tests.login_as(tests.uid('member_a'));
select lives_ok(format(
  'insert into public.tasks (project_id, title, status_id, type_id) values (%L, ''Bug đang làm'', %L, %L)',
  tests.uid('project_a'), tests.st('project_a', 'Đang thực hiện'), tests.ty('project_a', 'Bug')),
  'Thành viên tạo task với trạng thái và loại của dự án');
select throws_ok(format(
  'insert into public.tasks (project_id, title, status_id) values (%L, ''x'', %L)',
  tests.uid('project_a'), tests.st('project_b', 'Mới')),
  'P0001', 'status_not_in_project', 'Không dùng trạng thái của dự án khác');
select throws_ok(format(
  'insert into public.tasks (project_id, title, type_id) values (%L, ''x'', %L)',
  tests.uid('project_a'), tests.ty('project_b', 'Task')),
  'P0001', 'type_not_in_project', 'Không dùng loại task của dự án khác');
select throws_ok(format(
  'update public.tasks set status_id = %L where id = %L', tests.st('project_b', 'Đã xong'), tests.task('task_m')),
  'P0001', 'status_not_in_project', 'Không đổi sang trạng thái của dự án khác');

-- completed_at theo nhóm (Thành viên đổi trạng thái task mình tạo, BR-03).
select is(tests.affected_rows(format(
  'update public.tasks set status_id = %L where id = %L', tests.st('project_a', 'Đã xong'), tests.task('task_m'))),
  1, 'Thành viên đổi trạng thái task mình tạo');
select isnt((select completed_at from public.tasks where id = tests.task('task_m')), null,
  'Vào nhóm done: completed_at tự đặt');
select tests.logout();
update public.tasks set completed_at = '2030-02-02T00:00:00Z' where id = tests.task('task_m');
select tests.login_as(tests.uid('member_a'));
select lives_ok(format(
  'update public.tasks set status_id = %L where id = %L', tests.st('project_a', 'Đã đóng'), tests.task('task_m')),
  'Chuyển giữa hai trạng thái done');
select is((select completed_at from public.tasks where id = tests.task('task_m')), '2030-02-02T00:00:00Z'::timestamptz,
  'Chuyển giữa hai trạng thái done giữ thời điểm hoàn thành ban đầu');
select lives_ok(format(
  'update public.tasks set status_id = %L where id = %L', tests.st('project_a', 'Cần phản hồi'), tests.task('task_m')),
  'Mở lại task');
select is((select completed_at from public.tasks where id = tests.task('task_m')), null,
  'Ra khỏi nhóm done: completed_at về null');
select throws_ok(format(
  'update public.tasks set completed_at = now() where id = %L', tests.task('task_m')),
  '42501', null, 'Trình duyệt vẫn không ghi trực tiếp completed_at');
select is(tests.affected_rows(format(
  'update public.tasks set status_id = %L where id = %L', tests.st('project_a', 'Đã xong'), tests.task('task_pm'))),
  0, 'Thành viên không đổi trạng thái task người khác tạo, không giao cho mình (BR-03)');

select tests.login_as(tests.uid('viewer_a'));
select is(tests.affected_rows(format(
  'update public.tasks set status_id = %L where id = %L', tests.st('project_a', 'Đã xong'), tests.task('task_m'))),
  0, 'Người xem không đổi trạng thái task (BR-02)');

-- Tiến độ E2-1 (project_stats đếm completed_at) đúng theo trạng thái mà không phải sửa.
select tests.login_as(tests.uid('pm_a'));
select lives_ok(format(
  'update public.tasks set status_id = %L where id = %L', tests.st('project_a', 'Từ chối'), tests.task('task_pm')),
  'PM đóng task bằng trạng thái "Từ chối" (nhóm done)');
select results_eq(
  $$select task_count, done_task_count from public.project_stats(array[tests.uid('project_a')])$$,
  $$values (4, 2)$$, 'project_stats (E2-1): 2/4 task xong theo nhóm done');

-- Đổi nhóm của một trạng thái: task đang ở đó cập nhật completed_at.
select lives_ok(format(
  'update public.task_statuses set category = ''in_progress'' where id = %L', tests.st('project_a', 'Từ chối')),
  'PM đổi nhóm "Từ chối" sang in_progress');
select is((select completed_at from public.tasks where id = tests.task('task_pm')), null,
  'Task ở trạng thái vừa ra khỏi nhóm done có completed_at = null');
select lives_ok(format(
  'update public.task_statuses set category = ''done'' where id = %L', tests.st('project_a', 'Từ chối')),
  'Đổi lại nhóm done');
select isnt((select completed_at from public.tasks where id = tests.task('task_pm')), null,
  'Task ở trạng thái vừa vào nhóm done có completed_at');

-- ===========================================================================
-- task_statuses: SELECT
-- ===========================================================================
-- Dự án A, B mỗi dự án 7 trạng thái; dự án "qua RPC" (pm_a là PM) 7; "Dự án cũ" 7.
select tests.login_as(tests.uid('admin'));
select is((select count(*)::int from public.task_statuses), 28, 'Admin đọc mọi trạng thái');
select tests.login_as(tests.uid('pm_a'));
select is((select count(*)::int from public.task_statuses where project_id in (tests.uid('project_a'), tests.uid('project_b'))),
  14, 'pm_a (PM ở A, Người xem ở B) đọc trạng thái của A và B');
select tests.login_as(tests.uid('member_a'));
select is((select count(*)::int from public.task_statuses), 7, 'Thành viên A chỉ đọc trạng thái của A');
select tests.login_as(tests.uid('viewer_a'));
select is((select count(*)::int from public.task_statuses), 7, 'Người xem A đọc trạng thái của A');
select tests.login_as(tests.uid('outsider'));
select is_empty('select 1 from public.task_statuses', 'Người ngoài không thấy trạng thái nào (BR-10)');
select tests.login_as(tests.uid('locked'));
select is_empty('select 1 from public.task_statuses', 'Người bị khóa không thấy trạng thái nào');
select tests.login_as(tests.uid('locked_admin'));
select is_empty('select 1 from public.task_statuses', 'Admin bị khóa không thấy trạng thái nào');
select tests.login_anon();
select throws_ok('select 1 from public.task_statuses', '42501', null, 'anon không đọc được trạng thái');

-- ===========================================================================
-- task_statuses: INSERT / UPDATE / DELETE
-- ===========================================================================
select tests.login_as(tests.uid('pm_a'));
select lives_ok(format(
  'insert into public.task_statuses (project_id, name, category, color, position) values (%L, ''Chờ duyệt'', ''in_progress'', ''#E56DAF'', 4.5)',
  tests.uid('project_a')), 'PM thêm trạng thái cho dự án mình');
select throws_ok(format(
  'insert into public.task_statuses (project_id, name, category) values (%L, ''  chờ DUYỆT '', ''todo'')',
  tests.uid('project_a')), '23505', null, 'Tên trạng thái trùng (không phân biệt hoa thường) bị từ chối');
select throws_ok(format(
  'insert into public.task_statuses (project_id, name, category, color) values (%L, ''Màu sai'', ''todo'', ''red'')',
  tests.uid('project_a')), '23514', null, 'Màu không phải #RRGGBB bị từ chối');
select throws_ok(format(
  'insert into public.task_statuses (project_id, name, category) values (%L, ''x'', ''todo'')',
  tests.uid('project_b')), '42501', null, 'pm_a là Người xem ở B nên không thêm trạng thái ở B');
select is(tests.affected_rows(format(
  'update public.task_statuses set name = ''Mới tinh'' where id = %L', tests.st('project_a', 'Mới'))),
  1, 'PM đổi tên trạng thái');
select is(tests.affected_rows(format(
  'update public.task_statuses set name = ''x'' where id = %L', tests.st('project_b', 'Mới'))),
  0, 'pm_a không sửa trạng thái của B');
select throws_ok(format(
  'update public.task_statuses set project_id = %L where id = %L', tests.uid('project_b'), tests.st('project_a', 'Đã đóng')),
  '42501', null, 'Không chuyển trạng thái sang dự án khác (không có quyền cột project_id)');

select tests.login_as(tests.uid('member_a'));
select throws_ok(format(
  'insert into public.task_statuses (project_id, name, category) values (%L, ''x'', ''todo'')',
  tests.uid('project_a')), '42501', null, 'Thành viên không thêm trạng thái');
select is(tests.affected_rows(format(
  'update public.task_statuses set name = ''x'' where id = %L', tests.st('project_a', 'Đã đóng'))),
  0, 'Thành viên không sửa trạng thái');
select is(tests.affected_rows(format(
  'delete from public.task_statuses where id = %L', tests.st('project_a', 'Chờ duyệt'))),
  0, 'Thành viên không xóa trạng thái');

select tests.login_as(tests.uid('viewer_a'));
select throws_ok(format(
  'insert into public.task_statuses (project_id, name, category) values (%L, ''x'', ''todo'')',
  tests.uid('project_a')), '42501', null, 'Người xem không thêm trạng thái');
select is(tests.affected_rows(format(
  'update public.task_statuses set name = ''x'' where id = %L', tests.st('project_a', 'Đã đóng'))),
  0, 'Người xem không sửa trạng thái');

select tests.login_as(tests.uid('outsider'));
select throws_ok(format(
  'insert into public.task_statuses (project_id, name, category) values (%L, ''x'', ''todo'')',
  tests.uid('project_a')), '42501', null, 'Người ngoài không thêm trạng thái');
select tests.login_as(tests.uid('locked'));
select throws_ok(format(
  'insert into public.task_statuses (project_id, name, category) values (%L, ''x'', ''todo'')',
  tests.uid('project_a')), '42501', null, 'Người bị khóa không thêm trạng thái');
select tests.login_as(tests.uid('locked_admin'));
select is(tests.affected_rows(format(
  'update public.task_statuses set name = ''x'' where id = %L', tests.st('project_a', 'Đã đóng'))),
  0, 'Admin bị khóa không sửa trạng thái');

select tests.login_as(tests.uid('admin'));
select lives_ok(format(
  'insert into public.task_statuses (project_id, name, category) values (%L, ''Admin thêm'', ''in_progress'')',
  tests.uid('project_b')), 'Admin thêm trạng thái ở dự án mình không là thành viên');
select is(tests.affected_rows(format(
  'delete from public.task_statuses where project_id = %L and name = ''Admin thêm''', tests.uid('project_b'))),
  1, 'Admin xóa trạng thái không có task');

-- Bất biến: còn ít nhất một todo, một done.
select tests.login_as(tests.uid('pm_a'));
select throws_ok(format(
  'update public.task_statuses set category = ''in_progress'' where id = %L', tests.st('project_a', 'Mới tinh')),
  'P0001', 'last_status_of_category', 'Không đổi nhóm của trạng thái todo cuối cùng');
select lives_ok(format(
  'update public.tasks set status_id = %L where status_id = %L', tests.st('project_a', 'Cần phản hồi'), tests.st('project_a', 'Mới tinh')),
  'Chuyển hết task khỏi "Mới tinh"');
select throws_ok(format(
  'delete from public.task_statuses where id = %L', tests.st('project_a', 'Mới tinh')),
  'P0001', 'last_status_of_category', 'Không xóa trạng thái todo cuối cùng');
select lives_ok(format(
  'delete from public.task_statuses where project_id = %L and name in (''Đã đóng'', ''Đã xong'') and not exists (select 1 from public.tasks t where t.status_id = task_statuses.id)',
  tests.uid('project_a')), 'Xóa các trạng thái done không có task');

-- ===========================================================================
-- Xóa trạng thái đang có task (AC2): delete_task_status
-- ===========================================================================
select tests.logout();
update public.tasks set status_id = tests.st('project_a', 'Từ chối') where id = tests.task('task_done');
select tests.login_as(tests.uid('pm_a'));
select throws_ok(format(
  'delete from public.task_statuses where id = %L', tests.st('project_a', 'Cần phản hồi')),
  '23503', null, 'Xóa thẳng trạng thái đang có task: khóa ngoại chặn');
select throws_ok(format(
  'select public.delete_task_status(%L)', tests.st('project_a', 'Cần phản hồi')),
  'P0001', 'status_in_use', 'AC2: xóa trạng thái đang có task mà không chọn thay thế bị từ chối');
select throws_ok(format(
  'select public.delete_task_status(%L, %L)', tests.st('project_a', 'Cần phản hồi'), tests.st('project_b', 'Mới')),
  'P0001', 'invalid_replacement', 'Trạng thái thay thế phải cùng dự án');
select throws_ok(format(
  'select public.delete_task_status(%L, %L)', tests.st('project_a', 'Cần phản hồi'), tests.st('project_a', 'Cần phản hồi')),
  'P0001', 'invalid_replacement', 'Trạng thái thay thế không được là chính nó');

select tests.login_as(tests.uid('member_a'));
select throws_ok(format(
  'select public.delete_task_status(%L, %L)', tests.st('project_a', 'Cần phản hồi'), tests.st('project_a', 'Mới tinh')),
  null, null, 'Thành viên không xóa được trạng thái qua hàm');
select tests.login_as(tests.uid('outsider'));
select throws_ok(format(
  'select public.delete_task_status(%L)', tests.st('project_a', 'Chờ duyệt')),
  'P0002', 'not_found', 'Người ngoài: trạng thái coi như không tồn tại');

select tests.login_as(tests.uid('pm_a'));
select is(
  (select public.delete_task_status(tests.st('project_a', 'Cần phản hồi'), tests.st('project_a', 'Mới tinh'))),
  1, 'AC2: chọn trạng thái thay thế thì hàm chuyển task rồi xóa trong cùng giao dịch');
select is((select count(*)::int from public.tasks where id = tests.task('task_m')
           and status_id = tests.st('project_a', 'Mới tinh')), 1,
  'Task đã sang trạng thái thay thế');
select is((select count(*)::int from public.task_statuses where project_id = tests.uid('project_a') and name = 'Cần phản hồi'),
  0, 'Trạng thái đã bị xóa');
select is((select public.delete_task_status(tests.st('project_a', 'Từ chối'), tests.st('project_a', 'Mới tinh'))), 2,
  'Chuyển task đã xong sang todo khi xóa trạng thái done');
select is((select completed_at from public.tasks where id = tests.task('task_done')), null,
  'Task chuyển từ done sang todo có completed_at = null');
select throws_ok(format(
  'select public.delete_task_status(%L)', (select id from public.task_statuses where project_id = tests.uid('project_a') and category = 'done' limit 1)),
  'P0001', 'last_status_of_category', 'Không xóa trạng thái done cuối cùng qua hàm');

-- ===========================================================================
-- task_types
-- ===========================================================================
select tests.login_as(tests.uid('viewer_a'));
select is((select count(*)::int from public.task_types), 4, 'Người xem đọc loại task của A');
select throws_ok(format(
  'insert into public.task_types (project_id, name) values (%L, ''x'')', tests.uid('project_a')),
  '42501', null, 'Người xem không thêm loại task');
select tests.login_as(tests.uid('member_a'));
select throws_ok(format(
  'insert into public.task_types (project_id, name) values (%L, ''x'')', tests.uid('project_a')),
  '42501', null, 'Thành viên không thêm loại task');
select is(tests.affected_rows(format(
  'update public.task_types set name = ''x'' where id = %L', tests.ty('project_a', 'Bug'))),
  0, 'Thành viên không sửa loại task');
select tests.login_as(tests.uid('outsider'));
select is_empty('select 1 from public.task_types', 'Người ngoài không thấy loại task nào');
select tests.login_as(tests.uid('locked'));
select is_empty('select 1 from public.task_types', 'Người bị khóa không thấy loại task nào');

select tests.login_as(tests.uid('pm_a'));
select lives_ok(format(
  'insert into public.task_types (project_id, name, is_milestone, color, position) values (%L, ''Mốc phụ'', true, ''#E56DAF'', 9)',
  tests.uid('project_a')), 'PM thêm loại task là mốc');
select throws_ok(format(
  'insert into public.task_types (project_id, name) values (%L, ''bug'')', tests.uid('project_a')),
  '23505', null, 'Tên loại task trùng (không phân biệt hoa thường) bị từ chối');
select throws_ok(format(
  'select public.delete_task_type(%L)', tests.ty('project_a', 'Bug')),
  'P0001', 'type_in_use', 'Xóa loại đang dùng mà không chọn thay thế bị từ chối');
select is((select public.delete_task_type(tests.ty('project_a', 'Bug'), tests.ty('project_a', 'Task'))), 1,
  'Xóa loại đang dùng, chuyển task sang loại thay thế');
select is((select count(*)::int from public.tasks where project_id = tests.uid('project_a') and type_id = tests.ty('project_a', 'Task')),
  4, 'Mọi task của A giờ là loại Task');
select lives_ok(format(
  'delete from public.task_types where project_id = %L and id <> %L', tests.uid('project_a'), tests.ty('project_a', 'Task')),
  'Xóa các loại không dùng');
select throws_ok(format(
  'select public.delete_task_type(%L, null)', tests.ty('project_a', 'Task')),
  'P0001', null, 'Không xóa loại cuối cùng (đang dùng hoặc cuối cùng)');
select tests.login_as(tests.uid('admin'));
select throws_ok(format(
  'delete from public.task_types where id = %L', tests.ty('project_b', 'Task')),
  '23503', null, 'Xóa thẳng loại đang có task: khóa ngoại chặn');
select throws_ok(format(
  'delete from public.task_types where id = %L', tests.ty('project_a', 'Task')),
  'P0001', 'last_task_type', 'Admin cũng không xóa được loại cuối cùng của dự án');

-- ===========================================================================
-- labels
-- ===========================================================================
select tests.login_as(tests.uid('pm_a'));
select lives_ok(format(
  'insert into public.labels (project_id, name, color) values (%L, ''Bảo mật'', ''#C0262D'')',
  tests.uid('project_a')), 'PM thêm nhãn');
select throws_ok(format(
  'insert into public.labels (project_id, name) values (%L, '' BẢO MẬT '')', tests.uid('project_a')),
  '23505', null, 'Tên nhãn trùng không phân biệt hoa thường bị từ chối');
select lives_ok(format(
  'insert into public.labels (project_id, name) values (%L, ''bảo mật 2'')', tests.uid('project_a')),
  'Tên khác thì được');
select tests.login_as(tests.uid('pm_b'));
select lives_ok(format(
  'insert into public.labels (project_id, name) values (%L, ''Bảo mật'')',
  tests.uid('project_b')), 'Dự án khác dùng lại cùng tên nhãn');
select tests.login_as(tests.uid('member_a'));
select throws_ok(format(
  'insert into public.labels (project_id, name) values (%L, ''x'')', tests.uid('project_a')),
  '42501', null, 'Thành viên không thêm nhãn');
select is(tests.affected_rows(
  'update public.labels set name = ''x'' where id = tests.lb(''project_a'', ''Bảo mật'')'),
  0, 'Thành viên không sửa nhãn');
select tests.login_as(tests.uid('viewer_a'));
select is((select count(*)::int from public.labels), 2, 'Người xem đọc nhãn của A');
select is(tests.affected_rows(
  'delete from public.labels where id = tests.lb(''project_a'', ''Bảo mật'')'),
  0, 'Người xem không xóa nhãn');
select tests.login_as(tests.uid('outsider'));
select is_empty('select 1 from public.labels', 'Người ngoài không thấy nhãn');
select tests.login_as(tests.uid('locked'));
select is_empty('select 1 from public.labels', 'Người bị khóa không thấy nhãn');

-- ===========================================================================
-- task_labels: theo quyền sửa task, nhãn cùng dự án
-- ===========================================================================
select tests.login_as(tests.uid('member_a'));
select lives_ok(format(
  'insert into public.task_labels (task_id, label_id) values (%L, tests.lb(''project_a'', ''Bảo mật''))',
  tests.task('task_m')), 'Thành viên gắn nhãn vào task mình tạo');
select throws_ok(format(
  'insert into public.task_labels (task_id, label_id) values (%L, tests.lb(''project_a'', ''Bảo mật''))',
  tests.task('task_pm')), '42501', null, 'Thành viên không gắn nhãn vào task người khác (BR-03)');
select throws_ok(format(
  'insert into public.task_labels (task_id, label_id) values (%L, tests.lb(''project_b'', ''Bảo mật''))',
  tests.task('task_m')), 'P0001', 'label_not_in_project', 'Không gắn nhãn của dự án khác');
select tests.login_as(tests.uid('viewer_a'));
select is((select count(*)::int from public.task_labels), 1, 'Người xem đọc nhãn đã gắn');
select throws_ok(format(
  'insert into public.task_labels (task_id, label_id) values (%L, tests.lb(''project_a'', ''Bảo mật''))',
  tests.task('task_pm')), '42501', null, 'Người xem không gắn nhãn');
select is(tests.affected_rows(format(
  'delete from public.task_labels where task_id = %L', tests.task('task_m'))), 0, 'Người xem không gỡ nhãn');
select tests.login_as(tests.uid('outsider'));
select is_empty('select 1 from public.task_labels', 'Người ngoài không thấy nhãn đã gắn');
select tests.login_as(tests.uid('locked'));
select is_empty('select 1 from public.task_labels', 'Người bị khóa không thấy nhãn đã gắn');

select tests.login_as(tests.uid('pm_a'));
select lives_ok(format(
  'select public.set_task_labels(%L, array[(select id from public.labels where name = ''bảo mật 2'')])',
  tests.task('task_pm')), 'PM đặt nhãn cho task qua set_task_labels');
select lives_ok(format(
  'select public.set_task_labels(%L, array[tests.lb(''project_a'', ''Bảo mật''), (select id from public.labels where name = ''bảo mật 2'')])',
  tests.task('task_m')), 'PM đặt lại hai nhãn cho task_m');
select results_eq(
  $$select kind, task_count from public.project_config_task_counts(tests.uid('project_a'))
    where kind = 'label' order by task_count$$,
  $$values ('label', 1), ('label', 2)$$, 'project_config_task_counts đếm task theo nhãn');
select lives_ok(format('select public.set_task_labels(%L, ''{}'')', tests.task('task_m')),
  'Mảng rỗng gỡ hết nhãn');
select is((select count(*)::int from public.task_labels where task_id = tests.task('task_m')), 0,
  'task_m không còn nhãn');
select tests.login_as(tests.uid('admin'));
select is(tests.affected_rows(
  'delete from public.labels where id = tests.lb(''project_b'', ''Bảo mật'')'), 1, 'Admin xóa nhãn');

-- ===========================================================================
-- Xóa dự án xóa theo cấu hình
-- ===========================================================================
select tests.logout();
insert into public.task_labels (task_id, label_id) values (tests.task('task_m'), tests.lb('project_a', 'Bảo mật'));
delete from public.projects where id = tests.uid('project_a');
select is(
  (select count(*)::int from public.task_statuses where project_id = tests.uid('project_a'))
  + (select count(*)::int from public.task_types where project_id = tests.uid('project_a'))
  + (select count(*)::int from public.labels where project_id = tests.uid('project_a'))
  + (select count(*)::int from public.task_labels where task_id = tests.task('task_m')),
  0, 'Xóa dự án xóa theo trạng thái, loại, nhãn, nhãn đã gắn (database.md mục 7)');

select * from finish();
rollback;
