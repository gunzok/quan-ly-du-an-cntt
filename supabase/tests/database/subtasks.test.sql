-- QLDA-42 (Story E2-4): subtask tối đa 3 cấp (FR-07), cùng dự án, chống vòng, quyền với task cha,
-- quy tắc đóng task cha (BR-04) kể cả khi PM đổi nhóm trạng thái. Đồng thời: tests/integration.
begin;
\ir _helpers.psql
select tests.seed_fixture();

-- Dữ liệu (dự án A trừ khi ghi khác; pm_a tạo trừ khi ghi khác):
--   r1 (…9001) gốc ─ c1 (…9002) ─ g1 (…9003)          cây 3 cấp
--   r2 (…9004) gốc, giao member_a (member sửa được)
--   r3 (…9005) gốc, member_a không sửa được
--   m1 (…9006) gốc, member_a tạo ─ m1c (…9007) member_a tạo     (cây cao 2)
--   b1 (…9008) dự án B
--   p  (…9101) ─ pc (…9102) ─ pg (…9103)               cho BR-04
create function tests.k(name text)
returns uuid
language sql
immutable
as $$
  select case name
    when 'r1' then '00000000-0000-0000-0000-000000009001'
    when 'c1' then '00000000-0000-0000-0000-000000009002'
    when 'g1' then '00000000-0000-0000-0000-000000009003'
    when 'r2' then '00000000-0000-0000-0000-000000009004'
    when 'r3' then '00000000-0000-0000-0000-000000009005'
    when 'm1' then '00000000-0000-0000-0000-000000009006'
    when 'm1c' then '00000000-0000-0000-0000-000000009007'
    when 'b1' then '00000000-0000-0000-0000-000000009008'
    when 'p' then '00000000-0000-0000-0000-000000009101'
    when 'pc' then '00000000-0000-0000-0000-000000009102'
    when 'pg' then '00000000-0000-0000-0000-000000009103'
    when 'missing' then '00000000-0000-0000-0000-00000000dead'
  end::uuid;
$$;
grant execute on function tests.k(text) to anon, authenticated;

-- Trạng thái mặc định của dự án A theo tên (seed_project_defaults).
create function tests.st(name text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select s.id from public.task_statuses s
  where s.project_id = '00000000-0000-0000-0000-00000000000a' and s.name = st.name;
$$;
grant execute on function tests.st(text) to anon, authenticated;

create function tests.depth_of(name text)
returns smallint
language sql
stable
security definer
set search_path = ''
as $$
  select t.depth from public.tasks t where t.id = tests.k(depth_of.name);
$$;
grant execute on function tests.depth_of(text) to anon, authenticated;

-- Câu lệnh tạo task dưới cha (vai trò hiện tại; authenticated không ghi được cột id).
create function tests.child_sql(title text, parent uuid, project text default 'project_a')
returns text
language sql
immutable
as $$
  select format(
    'insert into public.tasks (project_id, title, parent_id) values (%L, %L, %L)',
    tests.uid(project), title, parent);
$$;
grant execute on function tests.child_sql(text, uuid, text) to anon, authenticated;

create function tests.move_sql(name text, parent uuid)
returns text
language sql
immutable
as $$
  select format('update public.tasks set parent_id = %L where id = %L', parent, tests.k(name));
$$;
grant execute on function tests.move_sql(text, uuid) to anon, authenticated;

create function tests.status_sql(name text, status text)
returns text
language sql
stable
as $$
  select format('update public.tasks set status_id = %L where id = %L', tests.st(status), tests.k(name));
$$;
grant execute on function tests.status_sql(text, text) to anon, authenticated;

insert into public.tasks (id, project_id, title, created_by, assignee_id) values
  (tests.k('r1'), tests.uid('project_a'), 'R1', tests.uid('pm_a'), null),
  (tests.k('r2'), tests.uid('project_a'), 'R2', tests.uid('pm_a'), tests.uid('member_a')),
  (tests.k('r3'), tests.uid('project_a'), 'R3', tests.uid('pm_a'), null),
  (tests.k('m1'), tests.uid('project_a'), 'M1', tests.uid('member_a'), null),
  (tests.k('p'), tests.uid('project_a'), 'P', tests.uid('pm_a'), null),
  (tests.k('b1'), tests.uid('project_b'), 'B1', tests.uid('pm_b'), null);
insert into public.tasks (id, project_id, title, created_by, parent_id) values
  (tests.k('c1'), tests.uid('project_a'), 'C1', tests.uid('pm_a'), tests.k('r1')),
  (tests.k('m1c'), tests.uid('project_a'), 'M1C', tests.uid('member_a'), tests.k('m1')),
  (tests.k('pc'), tests.uid('project_a'), 'PC', tests.uid('pm_a'), tests.k('p'));
insert into public.tasks (id, project_id, title, created_by, parent_id) values
  (tests.k('g1'), tests.uid('project_a'), 'G1', tests.uid('pm_a'), tests.k('c1')),
  (tests.k('pg'), tests.uid('project_a'), 'PG', tests.uid('pm_a'), tests.k('pc'));

select plan(66);

-- ===========================================================================
-- Cấu trúc, quyền cột
-- ===========================================================================
select has_trigger('public', 'tasks', 'check_task_tree', 'Có trigger check_task_tree');
select has_trigger('public', 'tasks', 'lock_tree_on_move', 'Có khóa cây mức câu lệnh');
select has_trigger('public', 'tasks', 'cascade_subtask_depth', 'Có trigger cập nhật depth hậu duệ');
select has_trigger('public', 'tasks', 'check_parent_close', 'Có trigger BR-04');
select has_trigger('public', 'task_statuses', 'check_category_close', 'Có trigger BR-04 khi đổi nhóm');
select ok(has_column_privilege('authenticated', 'public.tasks', 'parent_id', 'insert')
  and has_column_privilege('authenticated', 'public.tasks', 'parent_id', 'update'),
  'authenticated ghi được parent_id');
select ok(not has_column_privilege('authenticated', 'public.tasks', 'depth', 'insert')
  and not has_column_privilege('authenticated', 'public.tasks', 'depth', 'update'),
  'authenticated không ghi được depth');
select ok(not has_function_privilege('authenticated', 'private.open_subtask_ids(uuid[], integer)', 'execute')
  and not has_function_privilege('authenticated', 'private.check_task_tree()', 'execute'),
  'Hàm trigger trong private không cho authenticated gọi');

-- ===========================================================================
-- depth do trigger đặt
-- ===========================================================================
select is(tests.depth_of('r1'), 1::smallint, 'Task gốc cấp 1');
select is(tests.depth_of('c1'), 2::smallint, 'Con cấp 2');
select is(tests.depth_of('g1'), 3::smallint, 'Cháu cấp 3');

-- ===========================================================================
-- AC1: cấp 3 tạo con bị từ chối, cấp 2 tạo con được
-- ===========================================================================
select tests.login_as(tests.uid('pm_a'));
select throws_ok(tests.child_sql('Quá cấp', tests.k('g1')), 'P0001', 'subtask_depth_exceeded',
  'AC1: tạo con dưới task cấp 3 bị từ chối');
select lives_ok(tests.child_sql('Cháu mới', tests.k('c1')), 'AC1: tạo con dưới task cấp 2 được');
select tests.logout();
select is((select depth from public.tasks where title = 'Cháu mới'), 3::smallint,
  'Con của task cấp 2 có depth 3');

-- depth gửi tay bị bỏ qua (service_role/postgres): trigger tính lại.
insert into public.tasks (project_id, title, parent_id, depth)
  values (tests.uid('project_a'), 'Depth giả', tests.k('r1'), 1);
select is((select depth from public.tasks where title = 'Depth giả'), 2::smallint,
  'INSERT với depth sai: trigger đặt lại theo cha');
update public.tasks set depth = 3 where id = tests.k('r1');
select is(tests.depth_of('r1'), 1::smallint, 'UPDATE depth trực tiếp: trigger tính lại theo cha');
select throws_ok(
  format('insert into public.tasks (project_id, title, parent_id) values (%L, %L, %L)',
    tests.uid('project_a'), 'Quá cấp service', tests.k('g1')),
  'P0001', 'subtask_depth_exceeded', 'Giới hạn 3 cấp áp dụng cả cho service_role/postgres');

-- ===========================================================================
-- Chuyển cây: kiểm cả chiều dưới; depth hậu duệ cập nhật theo
-- ===========================================================================
select tests.login_as(tests.uid('pm_a'));
select throws_ok(tests.move_sql('m1', tests.k('c1')), 'P0001', 'subtask_depth_exceeded',
  'Chuyển cây cao 2 vào dưới task cấp 2 (thành 4 cấp) bị từ chối');
select throws_ok(tests.move_sql('r1', tests.k('r2')), 'P0001', 'subtask_depth_exceeded',
  'Chuyển cây cao 3 vào dưới task gốc bị từ chối');
select lives_ok(tests.move_sql('m1', tests.k('r2')), 'Chuyển cây cao 2 vào dưới task gốc được');
select is(tests.depth_of('m1'), 2::smallint, 'Task chuyển: depth 2');
select is(tests.depth_of('m1c'), 3::smallint, 'Con của task chuyển: depth cập nhật thành 3');
select lives_ok(tests.move_sql('m1', null), 'Gỡ về gốc được');
select is(tests.depth_of('m1c'), 2::smallint, 'Gỡ về gốc: depth con trở lại 2');
select lives_ok(tests.move_sql('g1', tests.k('r1')), 'Chuyển cháu lên làm con trực tiếp của gốc');
select is(tests.depth_of('g1'), 2::smallint, 'depth 2 sau khi chuyển lên');
select lives_ok(tests.move_sql('g1', tests.k('c1')), 'Chuyển lại về dưới c1');

-- ===========================================================================
-- Tự làm cha, vòng, khác dự án, cha không tồn tại
-- ===========================================================================
select throws_ok(tests.move_sql('r1', tests.k('r1')), 'P0001', 'task_parent_cycle',
  'Tự làm cha của chính mình bị từ chối');
select throws_ok(tests.move_sql('r1', tests.k('g1')), 'P0001', 'task_parent_cycle',
  'Đặt cha là cháu của chính mình (vòng) bị từ chối');
select throws_ok(tests.move_sql('c1', tests.k('g1')), 'P0001', 'task_parent_cycle',
  'Đặt cha là con của chính mình (vòng) bị từ chối');
select throws_ok(tests.child_sql('Khác dự án', tests.k('b1')), 'P0001', 'parent_not_in_project',
  'Cha thuộc dự án khác: parent_not_in_project');
select throws_ok(tests.child_sql('Không tồn tại', tests.k('missing')), 'P0001', 'parent_not_in_project',
  'Cha không tồn tại: CÙNG lỗi parent_not_in_project (không phân biệt được với khác dự án)');
select throws_ok(tests.move_sql('r3', tests.k('b1')), 'P0001', 'parent_not_in_project',
  'Chuyển sang cha thuộc dự án khác bị từ chối');

-- ===========================================================================
-- Chống dò và quyền với task cha
-- ===========================================================================
-- Người ngoài, người xem, người bị khóa: lỗi RLS (42501) trước khi biết gì về cha.
select tests.login_as(tests.uid('outsider'));
select throws_ok(tests.child_sql('Dò', tests.k('g1')), '42501',
  'new row violates row-level security policy for table "tasks"',
  'Người ngoài gửi cha cấp 3: lỗi RLS, không lộ subtask_depth_exceeded hay parent_not_editable');
select throws_ok(tests.child_sql('Dò', tests.k('missing')), '42501',
  'new row violates row-level security policy for table "tasks"',
  'Người ngoài gửi cha không tồn tại: CÙNG lỗi RLS');
select throws_ok(tests.child_sql('Dò', tests.k('b1'), 'project_b'), '42501',
  'new row violates row-level security policy for table "tasks"',
  'Người ngoài ghi vào dự án B với cha ở B: cùng lỗi RLS');
select tests.login_as(tests.uid('viewer_a'));
select throws_ok(tests.child_sql('Xem', tests.k('r1')), '42501', null, 'Người xem không tạo việc con');
select tests.login_as(tests.uid('locked'));
select throws_ok(tests.child_sql('Khóa', tests.k('r1')), '42501', null, 'Người bị khóa không tạo việc con');
-- PM dự án B (Người xem dự án A) dùng cha ở A cho task dự án B: chỉ thấy lỗi "không thuộc dự án".
select tests.login_as(tests.uid('pm_b'));
select throws_ok(tests.child_sql('Dò chéo', tests.k('g1'), 'project_b'), 'P0001', 'parent_not_in_project',
  'Cha ở dự án khác không lộ cấp của nó');
-- Thành viên: được gắn con vào task mình sửa được, không vào task người khác.
select tests.login_as(tests.uid('member_a'));
select lives_ok(tests.child_sql('Con của R2', tests.k('r2')),
  'Thành viên tạo việc con dưới task mình phụ trách');
select throws_ok(tests.child_sql('Con của R3', tests.k('r3')), '42501', 'parent_not_editable',
  'Thành viên không tạo việc con dưới task mình không sửa được');
select throws_ok(tests.move_sql('m1', tests.k('r3')), '42501', 'parent_not_editable',
  'Thành viên không chuyển task của mình vào dưới task mình không sửa được');
select is(tests.affected_rows(tests.move_sql('r3', tests.k('r2'))), 0,
  'Thành viên không sửa được task (RLS USING): đổi cha 0 dòng');
select throws_ok('update public.tasks set depth = 1 where id = ''00000000-0000-0000-0000-000000009007''',
  '42501', null, 'Thành viên không ghi trực tiếp cột depth');
select tests.logout();

-- service_role/postgres đổi project_id của task đang có con: bị từ chối.
select throws_ok(
  format('update public.tasks set project_id = %L, status_id = %L, type_id = %L where id = %L',
    tests.uid('project_b'),
    (select id from public.task_statuses where project_id = tests.uid('project_b') limit 1),
    (select id from public.task_types where project_id = tests.uid('project_b') limit 1),
    tests.k('m1')),
  'P0001', 'task_has_subtasks', 'Đổi dự án của task có con bị từ chối');

-- ===========================================================================
-- AC2 (BR-04): đóng cha khi còn hậu duệ chưa xong
-- ===========================================================================
select tests.login_as(tests.uid('pm_a'));
select throws_ok(tests.status_sql('p', 'Đã xong'), 'P0001', 'parent_has_open_subtasks',
  'AC2: cha còn con chưa xong không đóng được');
select throws_ok(tests.status_sql('pc', 'Đã đóng'), 'P0001', 'parent_has_open_subtasks',
  'Trạng thái Đã đóng cũng là nhóm done: cũng bị chặn');
select lives_ok(tests.status_sql('pc', 'Đang thực hiện'), 'Đổi cha sang trạng thái chưa done thì được');
select lives_ok(tests.status_sql('pg', 'Từ chối'), 'Cháu sang Từ chối (nhóm done)');
select lives_ok(tests.status_sql('pc', 'Đã xong'), 'Con xong khi cháu đã ở nhóm done');
select lives_ok(tests.status_sql('p', 'Đã xong'), 'AC2: mọi hậu duệ ở nhóm done thì đóng cha được');
select isnt((select completed_at from public.tasks where id = tests.k('p')), null,
  'Cha đã đóng có completed_at');

-- Mở lại cháu khi ông đã done: KHÔNG chặn (quyết định 5); ông vẫn done.
select lives_ok(tests.status_sql('pg', 'Đang thực hiện'), 'Mở lại cháu khi ông đã done: được');
select is((select s.category::text from public.tasks t join public.task_statuses s on s.id = t.status_id
  where t.id = tests.k('p')), 'done', 'Ông vẫn ở nhóm done (không tự mở lại)');
-- Ông chuyển từ done này sang done khác khi cháu đã mở lại: bị chặn.
select throws_ok(tests.status_sql('p', 'Đã đóng'), 'P0001', 'parent_has_open_subtasks',
  'Đổi cha giữa hai trạng thái done khi còn hậu duệ mở: bị chặn');
-- Cháu chưa xong chặn ông dù con đã xong.
select lives_ok(tests.status_sql('p', 'Mới'), 'Mở lại ông');
select throws_ok(tests.status_sql('p', 'Đã xong'), 'P0001', 'parent_has_open_subtasks',
  'AC2: cháu chưa xong chặn đóng ông (con trực tiếp đã xong)');
select tests.logout();

-- DETAIL liệt kê đúng id hậu duệ chưa xong (API trả danh sách này).
create function tests.close_error_detail(name text, status text)
returns text
language plpgsql
as $$
declare
  v_detail text;
begin
  execute tests.status_sql(name, status);
  return null;
exception when sqlstate 'P0001' then
  get stacked diagnostics v_detail = pg_exception_detail;
  return v_detail;
end;
$$;
select is(tests.close_error_detail('p', 'Đã xong'), tests.k('pg')::text,
  'DETAIL lỗi BR-04 là id của cháu chưa xong');

-- Task không có con: đóng bình thường. service_role/postgres cũng bị BR-04 chặn.
select lives_ok(tests.status_sql('r3', 'Đã xong'), 'Task không có con đóng bình thường');
select throws_ok(tests.status_sql('r1', 'Đã xong'), 'P0001', 'parent_has_open_subtasks',
  'BR-04 áp dụng cả cho service_role/postgres');

-- ===========================================================================
-- BR-04 khi PM đổi nhóm trạng thái (quyết định 6)
-- ===========================================================================
-- Trạng thái riêng "Chờ duyệt" (todo). Cha ở trạng thái đó, con đang thực hiện.
insert into public.task_statuses (id, project_id, name, category, position) values
  ('00000000-0000-0000-0000-00000000c001', tests.uid('project_a'), 'Chờ duyệt', 'todo', 10);
update public.tasks set status_id = '00000000-0000-0000-0000-00000000c001'
  where id in (tests.k('r2'));
select tests.login_as(tests.uid('pm_a'));
select throws_ok(
  'update public.task_statuses set category = ''done'' where id = ''00000000-0000-0000-0000-00000000c001''',
  'P0001', 'parent_has_open_subtasks',
  'Đổi nhóm trạng thái sang done khi một task cha ở đó còn con chưa xong: bị chặn');
-- Mọi hậu duệ của r2 cùng ở trạng thái đó: đổi nhóm làm cả cha lẫn con done → được.
select tests.logout();
update public.tasks set status_id = '00000000-0000-0000-0000-00000000c001'
  where parent_id = tests.k('r2');
select tests.login_as(tests.uid('pm_a'));
select lives_ok(
  'update public.task_statuses set category = ''done'' where id = ''00000000-0000-0000-0000-00000000c001''',
  'Hậu duệ ở chính trạng thái đang đổi nhóm tính là xong: được');
select is((select count(*)::integer from public.tasks
  where status_id = '00000000-0000-0000-0000-00000000c001' and completed_at is null), 0,
  'Mọi task ở trạng thái vừa đổi nhóm có completed_at');

-- delete_task_status chuyển cả cha lẫn con sang trạng thái done trong MỘT lệnh: không bị chặn oan.
select tests.logout();
insert into public.task_statuses (id, project_id, name, category, position) values
  ('00000000-0000-0000-0000-00000000c002', tests.uid('project_a'), 'Tạm', 'todo', 11);
update public.tasks set status_id = '00000000-0000-0000-0000-00000000c002'
  where id in (tests.k('m1'), tests.k('m1c'));
select tests.login_as(tests.uid('pm_a'));
select is(public.delete_task_status('00000000-0000-0000-0000-00000000c002', tests.st('Đã xong')), 2,
  'Xóa trạng thái, chuyển cả cha và con sang done trong một lệnh: được');

-- ===========================================================================
-- Xóa task cha: QLDA-81 thay hành vi E2-2 (không còn xóa dây chuyền). Ca đầy đủ theo vai trò,
-- xóa dự án và xóa tài khoản: block-parent-delete.test.sql.
-- ===========================================================================
select throws_ok(format('delete from public.tasks where id = %L', tests.k('p')), '23503', null,
  'PM xóa task cha còn việc con: bị từ chối (QLDA-81)');
select tests.logout();
select is((select count(*)::integer from public.tasks where id in (tests.k('pc'), tests.k('pg'))), 2,
  'Việc con, cháu còn nguyên (không còn ON DELETE CASCADE)');

select * from finish();
rollback;
