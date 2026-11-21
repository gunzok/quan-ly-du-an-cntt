-- QLDA-78 (Story E7-1): template dự án. Cấu trúc và quyền cột, RLS project_templates theo từng vai
-- trò, public.save_project_as_template (ai được lưu, giới hạn 2.000 task, không sao chép người),
-- public.create_project_from_template (ai được tạo, nhân bản đúng cấu trúc, trigger vẫn chạy) và
-- kiểm schema structure (dữ liệu không tin cậy). Ánh xạ lỗi sang HTTP: tests/integration.
begin;
\ir _helpers.psql
select tests.seed_fixture();

select plan(94);

-- Lưu id sinh ra trong lúc test (template, dự án nhân bản) để dùng ở câu sau.
create table tests.ctx (k text primary key, v uuid not null);
grant select, insert, update on tests.ctx to authenticated;
create function tests.ctx(name text) returns uuid language sql stable security definer
set search_path = '' as $$ select c.v from tests.ctx c where c.k = ctx.name $$;
grant execute on function tests.ctx(text) to anon, authenticated;

-- Đọc với quyền postgres (không phụ thuộc RLS của vai trò đang thử).
create function tests.tpl_structure(name text) returns jsonb language sql stable security definer
set search_path = '' as $$
  select pt.structure from public.project_templates pt where pt.id = tests.ctx(tpl_structure.name)
$$;
grant execute on function tests.tpl_structure(text) to anon, authenticated;

-- Dựng structure hợp lệ nhỏ để thử từng chỗ sai (chỉ thay một phần qua jsonb_set).
create function tests.good_structure() returns jsonb language sql immutable as $$
  select '{
    "version": 1,
    "statuses": [
      {"key": "s1", "name": "Mới", "category": "todo", "color": "#8A93A6", "position": 1},
      {"key": "s2", "name": "Xong", "category": "done", "color": "#137035", "position": 2}
    ],
    "task_types": [{"key": "y1", "name": "Task", "is_milestone": false, "color": "#2054F0", "position": 1}],
    "labels": [{"key": "l1", "name": "Gấp", "color": "#C0262D"}],
    "tasks": [
      {"key": "t1", "parent": null, "title": "Gốc", "description": null, "type": "y1",
       "status": "s1", "priority": "medium", "labels": ["l1"], "position": 1,
       "start_offset": 0, "due_offset": 3},
      {"key": "t2", "parent": "t1", "title": "Con", "description": "Mô tả", "type": "y1",
       "status": "s1", "priority": "high", "labels": [], "position": 1,
       "start_offset": null, "due_offset": null}
    ]
  }'::jsonb
$$;
grant execute on function tests.good_structure() to anon, authenticated;

-- Dữ liệu dự án A (postgres): ngày bắt đầu, 2 nhãn, cây 3 cấp + 1 task giao cho member_a.
update public.projects set start_date = '2026-12-01' where id = tests.uid('project_a');
insert into public.labels (id, project_id, name, color) values
  ('00000000-0000-0000-0000-00000000e701', tests.uid('project_a'), 'Gấp', '#C0262D'),
  ('00000000-0000-0000-0000-00000000e702', tests.uid('project_a'), 'Khách hàng', '#2054F0');
insert into public.tasks (id, project_id, parent_id, title, description, priority, start_date, due_date,
                          assignee_id, created_by, position) values
  ('00000000-0000-0000-0000-00000000e711', tests.uid('project_a'), null, 'Pha 1', 'Mô tả pha 1',
   'high', '2026-12-03', '2026-12-10', tests.uid('member_a'), tests.uid('pm_a'), 1);
insert into public.tasks (id, project_id, parent_id, title, priority, created_by, position) values
  ('00000000-0000-0000-0000-00000000e712', tests.uid('project_a'),
   '00000000-0000-0000-0000-00000000e711', 'Việc con', 'low', tests.uid('pm_a'), 2);
insert into public.tasks (id, project_id, parent_id, title, created_by, position, due_date) values
  ('00000000-0000-0000-0000-00000000e713', tests.uid('project_a'),
   '00000000-0000-0000-0000-00000000e712', 'Việc cháu', tests.uid('pm_a'), 3, '2026-11-28');
insert into public.tasks (id, project_id, title, created_by, position) values
  ('00000000-0000-0000-0000-00000000e714', tests.uid('project_a'), 'Gốc 2', tests.uid('pm_a'), 4);
insert into public.task_labels (task_id, label_id) values
  ('00000000-0000-0000-0000-00000000e711', '00000000-0000-0000-0000-00000000e701'),
  ('00000000-0000-0000-0000-00000000e711', '00000000-0000-0000-0000-00000000e702'),
  ('00000000-0000-0000-0000-00000000e713', '00000000-0000-0000-0000-00000000e702');
-- Trạng thái "Đã xong" cho Việc cháu (nhóm done).
update public.tasks set status_id = (
  select s.id from public.task_statuses s where s.project_id = tests.uid('project_a') and s.name = 'Đã xong')
where id = '00000000-0000-0000-0000-00000000e713';

-- ===========================================================================
-- Cấu trúc, quyền cột
-- ===========================================================================
select has_table('public', 'project_templates', 'Có bảng project_templates');
select ok((select relrowsecurity from pg_class where oid = 'public.project_templates'::regclass),
  'project_templates bật RLS');
select ok(
  (select prosecdef and proconfig = array['search_path=""'] from pg_proc
    where oid = 'public.save_project_as_template(uuid, text)'::regprocedure),
  'save_project_as_template là SECURITY DEFINER với search_path rỗng');
select ok(
  (select prosecdef and proconfig = array['search_path=""'] from pg_proc
    where oid = 'public.create_project_from_template(uuid, text, text, date, date)'::regprocedure),
  'create_project_from_template là SECURITY DEFINER với search_path rỗng');
select ok(not has_function_privilege('anon', 'public.save_project_as_template(uuid, text)', 'execute'),
  'anon không gọi được save_project_as_template');
select ok(not has_function_privilege('anon',
  'public.create_project_from_template(uuid, text, text, date, date)', 'execute'),
  'anon không gọi được create_project_from_template');
select ok(not has_function_privilege('anon',
  'private.project_template_structure_error(jsonb)', 'execute'),
  'anon không gọi được hàm kiểm schema');
select ok(not has_table_privilege('anon', 'public.project_templates', 'select'), 'anon không có quyền select');
select ok(not has_table_privilege('authenticated', 'public.project_templates', 'insert'),
  'authenticated không INSERT trực tiếp (chỉ qua RPC)');
select ok(not has_column_privilege('authenticated', 'public.project_templates', 'structure', 'select'),
  'Trình duyệt không đọc cột structure');
select ok(not has_column_privilege('authenticated', 'public.project_templates', 'structure', 'update'),
  'Không ai sửa structure');
select ok(not has_column_privilege('authenticated', 'public.project_templates', 'created_by', 'update'),
  'Không ai đổi created_by');
select ok(not has_column_privilege('authenticated', 'public.projects', 'template_id', 'insert'),
  'Trình duyệt không tự ghi projects.template_id');

-- ===========================================================================
-- Kiểm schema structure (dữ liệu không tin cậy)
-- ===========================================================================
select is(private.project_template_structure_error(tests.good_structure()), null, 'Structure mẫu hợp lệ');
select is(private.project_template_structure_error(tests.good_structure() || '{"extra": 1}'),
  'bad_keys', 'Khóa lạ ở gốc bị từ chối');
select is(private.project_template_structure_error(jsonb_set(tests.good_structure(), '{version}', '2')),
  'bad_version', 'Version khác 1 bị từ chối');
select is(private.project_template_structure_error(
  jsonb_set(tests.good_structure(), '{tasks,0,assignee_id}', to_jsonb(tests.uid('admin')::text))),
  'tasks_invalid', 'Task có trường người phụ trách bị từ chối (không có đường gán người)');
select is(private.project_template_structure_error(
  jsonb_set(tests.good_structure(), '{statuses,0,color}', '"red"')),
  'statuses_invalid', 'Màu sai định dạng bị từ chối');
select is(private.project_template_structure_error(
  jsonb_set(tests.good_structure(), '{statuses,1,category}', '"todo"')),
  'statuses_invalid', 'Thiếu trạng thái nhóm done bị từ chối');
select is(private.project_template_structure_error(
  jsonb_set(tests.good_structure(), '{statuses,1,name}', '" mới "')),
  'statuses_invalid', 'Tên trạng thái trùng (không phân biệt hoa thường) bị từ chối');
select is(private.project_template_structure_error(
  jsonb_set(tests.good_structure(), '{tasks,0,labels}', '["l9"]')),
  'tasks_refs', 'Nhãn không khai báo bị từ chối');
select is(private.project_template_structure_error(
  jsonb_set(tests.good_structure(), '{tasks,0,status}', '"s9"')),
  'tasks_refs', 'Trạng thái không khai báo bị từ chối');
select is(private.project_template_structure_error(
  jsonb_set(tests.good_structure(), '{tasks,0,parent}', '"t2"')),
  'tasks_tree', 'Vòng cha-con (cha đứng sau con) bị từ chối');
select is(private.project_template_structure_error(
  jsonb_set(tests.good_structure(), '{tasks,0,priority}', '"critical"')),
  'tasks_invalid', 'Ưu tiên ngoài enum bị từ chối');
select is(private.project_template_structure_error(
  jsonb_set(tests.good_structure(), '{tasks,0,start_offset}', '9')),
  'tasks_dates', 'Ngày bắt đầu sau hạn bị từ chối');
select is(private.project_template_structure_error(
  jsonb_set(tests.good_structure(), '{tasks,0,due_offset}', '1.5')),
  'tasks_invalid', 'Offset không phải số nguyên bị từ chối');
select is(private.project_template_structure_error(
  jsonb_set(tests.good_structure(), '{tasks,0,position}', '"1"')),
  'tasks_invalid', 'Thứ tự không phải số bị từ chối');
select is(private.project_template_structure_error(
  jsonb_set(tests.good_structure(), '{tasks}', (tests.good_structure() -> 'tasks') || '[
    {"key": "t3", "parent": "t2", "title": "Cháu", "description": null, "type": "y1", "status": "s1",
     "priority": "low", "labels": [], "position": 1, "start_offset": null, "due_offset": null},
    {"key": "t4", "parent": "t3", "title": "Chắt", "description": null, "type": "y1", "status": "s1",
     "priority": "low", "labels": [], "position": 1, "start_offset": null, "due_offset": null}]'::jsonb)),
  'tasks_tree', 'Cây 4 cấp bị từ chối');
select is(private.project_template_structure_error(
  jsonb_set(tests.good_structure(), '{tasks}', (
    select jsonb_agg(jsonb_build_object('key', 't' || i, 'parent', null, 'title', 'T' || i,
      'description', null, 'type', 'y1', 'status', 's1', 'priority', 'low', 'labels', '[]'::jsonb,
      'position', i, 'start_offset', null, 'due_offset', null))
    from generate_series(1, 2001) i))),
  'too_many_tasks', 'Quá 2.000 task bị từ chối');
select throws_ok(
  $$insert into public.project_templates (name, structure) values ('pgTAP E7 sai', '{"version": 1}')$$,
  '23514', null, 'CHECK của bảng chặn structure sai (kể cả postgres/service_role)');

-- ===========================================================================
-- Lưu dự án thành template: ai được lưu
-- ===========================================================================
select tests.login_as(tests.uid('pm_a'));
select lives_ok(
  $$insert into tests.ctx values ('t1', public.save_project_as_template(tests.uid('project_a'), ' pgTAP E7 Mẫu A '))$$,
  'PM của dự án lưu được dự án thành template');
select tests.logout();
select is((select name from public.project_templates where id = tests.ctx('t1')), 'pgTAP E7 Mẫu A',
  'Tên được cắt khoảng trắng hai đầu');
select is((select array[status_count, task_type_count, label_count, task_count] from public.project_templates
  where id = tests.ctx('t1')), array[7, 4, 2, 4], 'Tóm tắt: 7 trạng thái, 4 loại, 2 nhãn, 4 task');
select is((select created_by from public.project_templates where id = tests.ctx('t1')), tests.uid('pm_a'),
  'created_by là người lưu');
select ok(tests.tpl_structure('t1')::text !~ '[0-9a-f]{8}-[0-9a-f]{4}-',
  'structure không chứa uuid nào (không id dự án, task, người phụ trách)');
select is((select e ->> 'title' from jsonb_array_elements(tests.tpl_structure('t1') -> 'tasks') e
  where e ->> 'key' = 't1'), 'Pha 1', 'Task cấp 1 đứng đầu');
select is((select array[e ->> 'start_offset', e ->> 'due_offset'] from jsonb_array_elements(
  tests.tpl_structure('t1') -> 'tasks') e where e ->> 'title' = 'Pha 1'), array['2', '9'],
  'Offset ngày tính theo ngày bắt đầu dự án');
select is((select e ->> 'due_offset' from jsonb_array_elements(tests.tpl_structure('t1') -> 'tasks') e
  where e ->> 'title' = 'Việc cháu'), '-3', 'Offset âm (hạn trước ngày bắt đầu dự án) được giữ');

select tests.login_as(tests.uid('member_a'));
select throws_ok($$select public.save_project_as_template(tests.uid('project_a'), 'pgTAP E7 X1')$$,
  '42501', null, 'Thành viên không lưu được');
select tests.login_as(tests.uid('viewer_a'));
select throws_ok($$select public.save_project_as_template(tests.uid('project_a'), 'pgTAP E7 X2')$$,
  '42501', null, 'Người xem không lưu được');
select tests.login_as(tests.uid('pm_a'));
select throws_ok($$select public.save_project_as_template(tests.uid('project_b'), 'pgTAP E7 X3')$$,
  '42501', null, 'PM dự án A chỉ là Người xem ở B: không lưu được B');
select tests.login_as(tests.uid('pm_b'));
select throws_ok($$select public.save_project_as_template(tests.uid('project_a'), 'pgTAP E7 X4')$$,
  'P0002', 'project_not_found', 'PM dự án khác không thấy dự án A: không tồn tại (không lộ)');
select tests.login_as(tests.uid('outsider'));
select throws_ok($$select public.save_project_as_template(tests.uid('project_a'), 'pgTAP E7 X5')$$,
  'P0002', 'project_not_found', 'Người ngoài: không tồn tại');
select tests.login_as(tests.uid('locked'));
select throws_ok($$select public.save_project_as_template(tests.uid('project_a'), 'pgTAP E7 X6')$$,
  '42501', null, 'Người bị khóa không lưu được');
select tests.login_as(tests.uid('locked_admin'));
select throws_ok($$select public.save_project_as_template(tests.uid('project_a'), 'pgTAP E7 X7')$$,
  '42501', null, 'Admin bị khóa không lưu được');
select tests.login_anon();
select throws_ok($$select public.save_project_as_template(tests.uid('project_a'), 'pgTAP E7 X8')$$,
  '42501', null, 'anon không lưu được');
select tests.login_as(tests.uid('admin'));
select lives_ok(
  $$insert into tests.ctx values ('t2', public.save_project_as_template(tests.uid('project_b'), 'pgTAP E7 Mẫu B'))$$,
  'Admin lưu được dự án bất kỳ');
select throws_ok($$select public.save_project_as_template(tests.uid('project_b'), 'PGTAP e7 mẫu b')$$,
  '23505', null, 'Tên trùng (không phân biệt hoa thường) bị từ chối');
select throws_ok($$select public.save_project_as_template('00000000-0000-0000-0000-00000000dead', 'pgTAP E7 X9')$$,
  'P0002', 'project_not_found', 'Dự án không tồn tại');

-- Quá 2.000 task: dự án B có 2.001 task.
select tests.logout();
insert into public.tasks (project_id, title, created_by)
select tests.uid('project_b'), 'Nhiều ' || i, tests.uid('pm_b') from generate_series(1, 2001) i;
select tests.login_as(tests.uid('pm_b'));
select throws_ok($$select public.save_project_as_template(tests.uid('project_b'), 'pgTAP E7 Lớn')$$,
  'P0001', 'template_too_many_tasks', 'Dự án quá 2.000 task: template_too_many_tasks');
select tests.logout();
delete from public.tasks where project_id = tests.uid('project_b') and title like 'Nhiều %';

-- ===========================================================================
-- Đọc, sửa, xóa theo vai trò
-- ===========================================================================
select tests.login_as(tests.uid('admin'));
select is((select count(*)::int from public.project_templates where id in (tests.ctx('t1'), tests.ctx('t2'))), 2,
  'Admin đọc được');
select tests.login_as(tests.uid('pm_a'));
select is((select count(*)::int from public.project_templates where id in (tests.ctx('t1'), tests.ctx('t2'))), 2,
  'PM đọc được mọi template (dùng chung)');
select tests.login_as(tests.uid('pm_b'));
select is((select count(*)::int from public.project_templates where id in (tests.ctx('t1'), tests.ctx('t2'))), 2,
  'PM dự án khác cũng đọc được');
select throws_ok($$select structure from public.project_templates$$, '42501', null,
  'PM không đọc được cột structure');
select tests.login_as(tests.uid('member_a'));
select is((select count(*)::int from public.project_templates), 0, 'Thành viên không đọc được');
select tests.login_as(tests.uid('viewer_a'));
select is((select count(*)::int from public.project_templates), 0, 'Người xem không đọc được');
select tests.login_as(tests.uid('outsider'));
select is((select count(*)::int from public.project_templates), 0, 'Người ngoài không đọc được');
select tests.login_as(tests.uid('locked'));
select is((select count(*)::int from public.project_templates), 0, 'Người bị khóa không đọc được');
select tests.login_anon();
select throws_ok($$select count(*) from public.project_templates$$, '42501', null, 'anon bị từ chối');

select tests.login_as(tests.uid('pm_a'));
select throws_ok(
  $$insert into public.project_templates (name, structure) values ('pgTAP E7 tay', tests.good_structure())$$,
  '42501', null, 'PM không INSERT trực tiếp được');
select is(tests.affected_rows(format(
  $$update public.project_templates set name = 'pgTAP E7 đổi' where id = %L$$, tests.ctx('t2'))), 0,
  'PM không đổi tên template của người khác');
select is(tests.affected_rows(format(
  $$delete from public.project_templates where id = %L$$, tests.ctx('t2'))), 0,
  'PM không xóa template của người khác');
select is(tests.affected_rows(format(
  $$update public.project_templates set name = 'pgTAP E7 Mẫu A2' where id = %L$$, tests.ctx('t1'))), 1,
  'Người tạo đổi tên được');
select tests.login_as(tests.uid('member_a'));
select is(tests.affected_rows(format(
  $$update public.project_templates set archived_at = now() where id = %L$$, tests.ctx('t1'))), 0,
  'Thành viên không lưu trữ được');
select is(tests.affected_rows(format(
  $$delete from public.project_templates where id = %L$$, tests.ctx('t1'))), 0, 'Thành viên không xóa được');
select tests.login_as(tests.uid('admin'));
select is(tests.affected_rows(format(
  $$update public.project_templates set name = 'pgTAP E7 Mẫu A3' where id = %L$$, tests.ctx('t1'))), 1,
  'Admin đổi tên được template của người khác');

-- ===========================================================================
-- Tạo dự án từ template
-- ===========================================================================
select tests.login_as(tests.uid('pm_b'));
select lives_ok(format(
  $$insert into tests.ctx select 'p1', id from public.create_project_from_template(%L, 'pgTAP E7 Nhân bản', 'Mô tả', '2027-01-10', null)$$,
  tests.ctx('t1')), 'PM (ở dự án khác) tạo được dự án từ template');
select tests.logout();
select is((select role::text from public.project_members where project_id = tests.ctx('p1') and user_id = tests.uid('pm_b')),
  'pm', 'Người tạo là PM của dự án mới');
select is((select count(*)::int from public.project_members where project_id = tests.ctx('p1')), 1,
  'Không sao chép thành viên');
select is((select template_id from public.projects where id = tests.ctx('p1')), tests.ctx('t1'),
  'projects.template_id ghi nguồn');
select is(
  (select array_agg(name order by position) from public.task_statuses where project_id = tests.ctx('p1')),
  (select array_agg(name order by position) from public.task_statuses where project_id = tests.uid('project_a')),
  'Trạng thái giống dự án nguồn (tên, thứ tự), mặc định đã được thay');
select is((select count(*)::int from public.task_types where project_id = tests.ctx('p1')), 4, '4 loại task');
select is((select array_agg(name order by name) from public.labels where project_id = tests.ctx('p1')),
  array['Gấp', 'Khách hàng'], 'Nhãn được nhân bản');
select is((select count(*)::int from public.tasks where project_id = tests.ctx('p1')), 4, '4 task');
select is(
  (select array_agg(c.title || '>' || p.title order by c.depth) from public.tasks c
   join public.tasks p on p.id = c.parent_id where c.project_id = tests.ctx('p1')),
  array['Việc con>Pha 1', 'Việc cháu>Việc con'], 'Quan hệ cha-con giữ nguyên');
select is((select array_agg(depth order by depth) from public.tasks where project_id = tests.ctx('p1')),
  array[1, 1, 2, 3]::smallint[], 'depth do trigger tính (1, 1, 2, 3)');
select is((select count(*)::int from public.tasks where project_id = tests.ctx('p1')
  and (assignee_id is not null or created_by is distinct from tests.uid('pm_b'))), 0,
  'Không sao chép người phụ trách; người tạo task là người tạo dự án');
select is((select array[start_date::text, due_date::text] from public.tasks
  where project_id = tests.ctx('p1') and title = 'Pha 1'), array['2027-01-12', '2027-01-19'],
  'Ngày task = ngày bắt đầu dự án mới + offset');
select ok((select completed_at is not null from public.tasks
  where project_id = tests.ctx('p1') and title = 'Việc cháu'),
  'Task ở trạng thái done có completed_at (trigger apply_task_config chạy)');
select is((select count(*)::int from public.task_labels tl join public.tasks t on t.id = tl.task_id
  where t.project_id = tests.ctx('p1')), 3, 'Nhãn gắn task được nhân bản');
select is((select count(*)::int from public.activity_logs where project_id = tests.ctx('p1')
  and entity_type = 'task' and action = 'create'), 4, 'Nhật ký ghi việc tạo 4 task (trigger activity_log)');
select is((select count(*)::int from public.notifications where project_id = tests.ctx('p1')), 0,
  'Không sinh thông báo');

select tests.login_as(tests.uid('pm_a'));
select lives_ok(format(
  $$insert into tests.ctx select 'p2', id from public.create_project_from_template(%L, 'pgTAP E7 Không ngày')$$,
  tests.ctx('t1')), 'Tạo dự án không có ngày bắt đầu');
select tests.logout();
select is((select count(*)::int from public.tasks where project_id = tests.ctx('p2')
  and (start_date is not null or due_date is not null)), 0, 'Dự án mới không có ngày bắt đầu: task không có ngày');

select tests.login_as(tests.uid('member_a'));
select throws_ok(format($$select public.create_project_from_template(%L, 'pgTAP E7 Y1')$$, tests.ctx('t1')),
  '42501', null, 'Thành viên (không là PM ở đâu) không tạo được');
select tests.login_as(tests.uid('viewer_a'));
select throws_ok(format($$select public.create_project_from_template(%L, 'pgTAP E7 Y2')$$, tests.ctx('t1')),
  '42501', null, 'Người xem không tạo được');
select tests.login_as(tests.uid('outsider'));
select throws_ok(format($$select public.create_project_from_template(%L, 'pgTAP E7 Y3')$$, tests.ctx('t1')),
  '42501', null, 'Người ngoài không tạo được');
select tests.login_as(tests.uid('pm_a'));
select throws_ok($$select public.create_project_from_template('00000000-0000-0000-0000-00000000dead', 'pgTAP E7 Y4')$$,
  'P0002', 'template_not_found', 'Template không tồn tại');

-- Lưu trữ thì không tạo được nữa.
select is(tests.affected_rows(format(
  $$update public.project_templates set archived_at = now() where id = %L$$, tests.ctx('t1'))), 1,
  'Người tạo lưu trữ được');
select throws_ok(format($$select public.create_project_from_template(%L, 'pgTAP E7 Y5')$$, tests.ctx('t1')),
  'P0002', 'template_not_found', 'Template đã lưu trữ không dùng được');

-- structure bị sửa tay (bỏ CHECK trong giao dịch test): kiểm lại trước khi chèn.
select tests.logout();
alter table public.project_templates drop constraint project_templates_structure_valid;
update public.project_templates
set structure = jsonb_set(tests.good_structure(), '{tasks,1,parent}', '"t9"')
where id = tests.ctx('t2');
select tests.login_as(tests.uid('pm_a'));
select throws_ok(format($$select public.create_project_from_template(%L, 'pgTAP E7 Y6')$$, tests.ctx('t2')),
  'P0001', 'template_invalid', 'Structure sai bị từ chối trước khi chèn');
select tests.logout();
select is((select count(*)::int from public.projects where name = 'pgTAP E7 Y6'), 0,
  'Không còn dự án dở dang (một giao dịch)');

-- Xóa template: dự án đã tạo không bị ảnh hưởng.
select tests.login_as(tests.uid('pm_a'));
select is(tests.affected_rows(format(
  $$delete from public.project_templates where id = %L$$, tests.ctx('t1'))), 1, 'Người tạo xóa được');
select tests.logout();
select is((select count(*)::int from public.tasks where project_id = tests.ctx('p1')), 4,
  'Xóa template không đụng dự án đã tạo');

select * from finish();
rollback;
