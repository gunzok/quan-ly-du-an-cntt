-- QLDA-59 (Story E4-1): thông báo trong app (migration 20261115270000_notifications.sql).
-- Kiểm: cấu trúc, quyền bảng/cột (không ai INSERT, kể cả service_role; payload không đọc thẳng
-- được), RLS cho PM, Thành viên, Người xem, Admin, người ngoài, người bị khóa, Admin bị khóa, anon;
-- trigger tạo đúng người nhận, không tự thông báo, không gửi cho người đã mất quyền; payload nhỏ,
-- cắt tiêu đề; đọc payload qua hàm chỉ khi còn đọc được task (không rò rỉ).
begin;
\ir _helpers.psql
select tests.seed_fixture();

-- Thành viên thứ hai của dự án A.
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000c2', 'member2_a@test.example', '{"full_name":"Member 2 A"}');
insert into public.project_members (project_id, user_id, role) values
  (tests.uid('project_a'), '00000000-0000-0000-0000-0000000000c2', 'member');

create function tests.t(name text)
returns uuid language sql immutable as $$
  select case name
    when 'member2' then '00000000-0000-0000-0000-0000000000c2'
    when 'task_1' then '00000000-0000-0000-0000-000000009001'
    when 'task_2' then '00000000-0000-0000-0000-000000009002'
    when 'task_3' then '00000000-0000-0000-0000-000000009003'
    when 'task_4' then '00000000-0000-0000-0000-000000009004'
    when 'task_5' then '00000000-0000-0000-0000-000000009005'
    when 'task_b' then '00000000-0000-0000-0000-000000009010'
  end::uuid;
$$;
-- id trạng thái mặc định theo tên (bỏ qua RLS).
create function tests.st(project text, status_name text)
returns uuid language sql stable security definer set search_path = public as $$
  select id from public.task_statuses where project_id = tests.uid(project) and name = status_name;
$$;
-- Đếm thông báo (bỏ qua RLS) theo người nhận, loại, task.
create function tests.n_count(recipient uuid, kind text default null, task uuid default null)
returns integer language sql stable security definer set search_path = public as $$
  select count(*)::int from public.notifications
  where user_id = recipient and (kind is null or type = kind) and (task is null or task_id = task);
$$;
create function tests.n_payload(recipient uuid, kind text, task uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select payload from public.notifications
  where user_id = recipient and type = kind and task_id = task
  order by created_at desc, id desc limit 1;
$$;
create function tests.n_id(recipient uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select id from public.notifications where user_id = recipient order by created_at, id limit 1;
$$;
-- Đặt auth.uid() (người làm) mà vẫn giữ vai trò postgres: phần này kiểm logic trigger, không kiểm
-- RLS của tasks (đã có rls-tasks.test.sql), và cần chèn task với id cố định.
create function tests.act_as(user_id uuid)
returns void language plpgsql as $f$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', user_id, 'role', 'authenticated')::text, true);
end;
$f$;
grant execute on all functions in schema tests to anon, authenticated;

select plan(82);

-- ===========================================================================
-- Cấu trúc, quyền bảng/cột
-- ===========================================================================
select has_table('public', 'notifications', 'Có bảng notifications');
select is((select relrowsecurity from pg_class where oid = 'public.notifications'::regclass), true,
  'RLS bật');
select has_index('public', 'notifications', 'notifications_user_created_idx', 'Chỉ mục danh sách');
select has_index('public', 'notifications', 'notifications_user_unread_idx', 'Chỉ mục chưa đọc');
select ok(not has_table_privilege('anon', 'public.notifications', 'select'), 'anon không đọc');
select ok(not has_table_privilege('authenticated', 'public.notifications', 'insert'),
  'Trình duyệt không có quyền INSERT');
select ok(not has_table_privilege('service_role', 'public.notifications', 'insert'),
  'service_role cũng không INSERT (chỉ trigger hệ thống)');
select ok(not has_table_privilege('authenticated', 'public.notifications', 'delete'),
  'Trình duyệt không xóa');
select ok(not has_column_privilege('authenticated', 'public.notifications', 'payload', 'select'),
  'Trình duyệt không đọc thẳng cột payload');
select ok(has_column_privilege('authenticated', 'public.notifications', 'read_at', 'update'),
  'Trình duyệt chỉ cập nhật được read_at');
select ok(not has_column_privilege('authenticated', 'public.notifications', 'user_id', 'update')
  and not has_column_privilege('authenticated', 'public.notifications', 'payload', 'update')
  and not has_column_privilege('authenticated', 'public.notifications', 'type', 'update'),
  'Không đổi được người nhận, loại, payload');
select ok(not has_function_privilege('authenticated', 'private.notify_task_updated()', 'execute')
  and not has_function_privilege('authenticated', 'private.notify_task_inserted()', 'execute'),
  'Trình duyệt không gọi được hàm trigger');
select ok(not has_function_privilege('anon', 'public.notification_payloads(uuid[])', 'execute'),
  'anon không gọi hàm đọc payload');

-- ===========================================================================
-- Trigger: task_assigned
-- ===========================================================================
-- PM A tạo task giao cho member_a → member_a nhận một thông báo; PM không nhận.
select tests.act_as(tests.uid('pm_a'));
insert into public.tasks (id, project_id, title, assignee_id) values
  (tests.t('task_1'), tests.uid('project_a'), 'Viết đặc tả', tests.uid('member_a'));
select tests.logout();
select is(tests.n_count(tests.uid('member_a'), 'task_assigned', tests.t('task_1')), 1,
  'AC1: được giao khi tạo task → một thông báo task_assigned');
select is(tests.n_count(tests.uid('pm_a')), 0, 'Người giao không nhận thông báo');
select is(tests.n_payload(tests.uid('member_a'), 'task_assigned', tests.t('task_1')),
  jsonb_build_object('title', 'Viết đặc tả', 'actor_id', tests.uid('pm_a')),
  'payload chỉ có tiêu đề và id người giao');

-- Tự giao cho mình: không thông báo.
select tests.act_as(tests.uid('pm_a'));
insert into public.tasks (id, project_id, title, assignee_id) values
  (tests.t('task_2'), tests.uid('project_a'), 'Việc của PM', tests.uid('pm_a'));
select tests.logout();
select is(tests.n_count(tests.uid('pm_a')), 0, 'Tự giao cho chính mình: không thông báo');

-- Tạo task không giao ai: không thông báo.
select tests.act_as(tests.uid('pm_a'));
insert into public.tasks (id, project_id, title) values
  (tests.t('task_3'), tests.uid('project_a'), repeat('Dài ', 40) || 'cuối');
select tests.logout();
select is((select count(*)::int from public.notifications where task_id = tests.t('task_3')), 0,
  'Task chưa giao: không thông báo');

-- Đổi người phụ trách task_3 sang member2 → member2 nhận; tiêu đề cắt 80 ký tự kèm "…".
select tests.act_as(tests.uid('pm_a'));
update public.tasks set assignee_id = tests.t('member2') where id = tests.t('task_3');
select tests.logout();
select is(tests.n_count(tests.t('member2'), 'task_assigned', tests.t('task_3')), 1,
  'Đổi người phụ trách → người mới nhận task_assigned');
select is(char_length(tests.n_payload(tests.t('member2'), 'task_assigned', tests.t('task_3')) ->> 'title'),
  80, 'Tiêu đề cắt còn 80 ký tự');
select ok((tests.n_payload(tests.t('member2'), 'task_assigned', tests.t('task_3')) ->> 'title') like '%…',
  'Tiêu đề bị cắt kết thúc bằng …');

-- Ghi lại cùng người phụ trách, hoặc chỉ kéo thả (position): không thông báo thêm.
select tests.act_as(tests.uid('pm_a'));
update public.tasks set assignee_id = tests.t('member2'), position = 5 where id = tests.t('task_3');
select tests.logout();
select is(tests.n_count(tests.t('member2')), 1, 'Không đổi người phụ trách: không thông báo thêm');

-- Bỏ giao (null): không thông báo.
select tests.act_as(tests.uid('pm_a'));
update public.tasks set assignee_id = null where id = tests.t('task_3');
select tests.logout();
select is((select count(*)::int from public.notifications where task_id = tests.t('task_3')), 1,
  'Bỏ giao (assignee null): không thông báo');

-- Thành viên tự nhận việc của mình (member_a tạo rồi giao cho chính mình): không thông báo.
select tests.act_as(tests.uid('member_a'));
insert into public.tasks (id, project_id, title) values
  (tests.t('task_4'), tests.uid('project_a'), 'Việc member tạo');
update public.tasks set assignee_id = tests.uid('member_a') where id = tests.t('task_4');
select tests.logout();
select is(tests.n_count(tests.uid('member_a'), null, tests.t('task_4')), 0,
  'Tự nhận việc: không thông báo');

-- ===========================================================================
-- Trigger: task_status_changed
-- ===========================================================================
-- member_a (người phụ trách task_1) đổi trạng thái → pm_a (người tạo) nhận; member_a không.
select tests.act_as(tests.uid('member_a'));
update public.tasks set status_id = tests.st('project_a', 'Đang thực hiện') where id = tests.t('task_1');
select tests.logout();
select is(tests.n_count(tests.uid('pm_a'), 'task_status_changed', tests.t('task_1')), 1,
  'Người phụ trách đổi trạng thái → người tạo nhận');
select is(tests.n_count(tests.uid('member_a'), 'task_status_changed', tests.t('task_1')), 0,
  'Người đổi trạng thái không tự nhận');
select is(tests.n_payload(tests.uid('pm_a'), 'task_status_changed', tests.t('task_1')),
  jsonb_build_object('title', 'Viết đặc tả', 'actor_id', tests.uid('member_a'),
                     'status_name', 'Đang thực hiện'),
  'payload: tiêu đề, người làm, tên trạng thái mới');

-- PM (người tạo) đổi trạng thái → member_a (người phụ trách) nhận; PM không.
select tests.act_as(tests.uid('pm_a'));
update public.tasks set status_id = tests.st('project_a', 'Đang kiểm thử') where id = tests.t('task_1');
select tests.logout();
select is(tests.n_count(tests.uid('member_a'), 'task_status_changed', tests.t('task_1')), 1,
  'Người tạo đổi trạng thái → người phụ trách nhận');
select is(tests.n_count(tests.uid('pm_a'), 'task_status_changed', tests.t('task_1')), 1,
  'Người tạo không nhận thông báo cho thao tác của chính mình');

-- Người thứ ba (Admin) đổi trạng thái task_4 (member_a tạo và phụ trách) → một thông báo (gộp trùng).
select tests.act_as(tests.uid('admin'));
update public.tasks set status_id = tests.st('project_a', 'Đang thực hiện') where id = tests.t('task_4');
select tests.logout();
select is(tests.n_count(tests.uid('member_a'), 'task_status_changed', tests.t('task_4')), 1,
  'Người tạo trùng người phụ trách: chỉ một thông báo');
select is(tests.n_count(tests.uid('admin')), 0, 'Admin thao tác không tự nhận');

-- Đổi người phụ trách VÀ trạng thái cùng lệnh: người mới chỉ nhận task_assigned; người tạo nhận đổi trạng thái.
select tests.act_as(tests.uid('pm_a'));
insert into public.tasks (id, project_id, title, created_by) values
  (tests.t('task_5'), tests.uid('project_a'), 'Việc gộp', tests.uid('pm_a'));
select tests.logout();
update public.tasks set created_by = tests.t('member2') where id = tests.t('task_5');
select tests.act_as(tests.uid('pm_a'));
update public.tasks
  set assignee_id = tests.uid('member_a'), status_id = tests.st('project_a', 'Đang thực hiện')
  where id = tests.t('task_5');
select tests.logout();
select is(tests.n_count(tests.uid('member_a'), null, tests.t('task_5')), 1,
  'Vừa được giao vừa đổi trạng thái: người mới chỉ nhận một thông báo');
select is(tests.n_count(tests.uid('member_a'), 'task_assigned', tests.t('task_5')), 1,
  '... và đó là task_assigned');
select is(tests.n_count(tests.t('member2'), 'task_status_changed', tests.t('task_5')), 1,
  'Người tạo (khác người làm) nhận task_status_changed');

-- Người tạo đã rời dự án: không nhận (không lưu tiêu đề cho người hết quyền).
update public.tasks set created_by = tests.uid('outsider') where id = tests.t('task_5');
-- Người tạo bị khóa: không nhận.
select tests.act_as(tests.uid('pm_a'));
update public.tasks set status_id = tests.st('project_a', 'Mới') where id = tests.t('task_5');
select tests.logout();
select is(tests.n_count(tests.uid('outsider')), 0, 'Người tạo không còn trong dự án: không nhận');
update public.tasks set created_by = tests.uid('locked') where id = tests.t('task_5');
select tests.act_as(tests.uid('pm_a'));
update public.tasks set status_id = tests.st('project_a', 'Đang thực hiện') where id = tests.t('task_5');
select tests.logout();
select is(tests.n_count(tests.uid('locked')), 0, 'Người tạo bị khóa: không nhận');
select is(tests.n_count(tests.uid('member_a'), 'task_status_changed', tests.t('task_5')), 2,
  'Người phụ trách vẫn nhận mỗi lần đổi trạng thái');

-- Admin không là thành viên nhưng là người tạo: vẫn nhận (Admin đọc được mọi task).
update public.tasks set created_by = tests.uid('admin') where id = tests.t('task_5');
select tests.act_as(tests.uid('member_a'));
update public.tasks set status_id = tests.st('project_a', 'Mới') where id = tests.t('task_5');
select tests.logout();
select is(tests.n_count(tests.uid('admin'), 'task_status_changed', tests.t('task_5')), 1,
  'Admin là người tạo: nhận thông báo đổi trạng thái');

-- Hệ thống (không có auth.uid()) đổi trạng thái: gửi cho cả người tạo và người phụ trách, actor null.
update public.tasks set status_id = tests.st('project_a', 'Mới') where id = tests.t('task_1');
select is(tests.n_count(tests.uid('pm_a'), 'task_status_changed', tests.t('task_1')), 2,
  'Hệ thống đổi trạng thái: người tạo nhận');
select is(tests.n_count(tests.uid('member_a'), 'task_status_changed', tests.t('task_1')), 2,
  'Hệ thống đổi trạng thái: người phụ trách nhận');
select is((select count(*)::int from public.notifications
           where user_id = tests.uid('pm_a') and task_id = tests.t('task_1')
             and payload -> 'actor_id' = 'null'::jsonb and payload ->> 'status_name' = 'Mới'),
  1, 'actor_id null khi do hệ thống');

-- Đổi trạng thái hàng loạt trong một lệnh: mỗi task một thông báo.
select tests.act_as(tests.uid('pm_a'));
select is(tests.affected_rows(format(
  'update public.tasks set status_id = %L where id in (%L, %L)',
  tests.st('project_a', 'Cần phản hồi'), tests.t('task_1'), tests.t('task_4'))), 2,
  'Đổi trạng thái hai task một lệnh');
select tests.logout();
select is(tests.n_count(tests.uid('member_a'), 'task_status_changed'), 7,
  'Mỗi task đổi trạng thái tạo một thông báo cho người phụ trách (lệnh hàng loạt)');

-- Không có dữ liệu nhạy cảm: khóa payload chỉ trong danh sách cho phép.
select is((select count(*)::int from public.notifications
           where payload - array['title', 'actor_id', 'status_name'] <> '{}'::jsonb), 0,
  'payload không có khóa nào khác title, actor_id, status_name');
select throws_ok(format(
  $$insert into public.notifications (user_id, type, task_id, project_id, payload)
    values (%L, 'task_assigned', %L, %L, '{"description":"bí mật"}')$$,
  tests.uid('member_a'), tests.t('task_1'), tests.uid('project_a')),
  '23514', null, 'CHECK chặn payload có khóa lạ (kể cả chủ bảng)');

-- ===========================================================================
-- INSERT: không client nào tự tạo
-- ===========================================================================
create function tests.ins_for(recipient text)
returns text language sql stable as $$
  select format(
    $f$insert into public.notifications (user_id, type, task_id, project_id) values (%L, 'task_assigned', %L, %L)$f$,
    tests.uid(recipient), tests.t('task_1'), tests.uid('project_a'));
$$;
grant execute on function tests.ins_for(text) to anon, authenticated;
grant usage on schema tests to service_role;
grant execute on function tests.ins_for(text), tests.uid(text), tests.t(text) to service_role;
select tests.login_as(tests.uid('member_a'));
select throws_ok(tests.ins_for('member_a'), '42501', null, 'Thành viên không tự tạo thông báo cho mình');
select throws_ok(tests.ins_for('pm_a'), '42501', null, 'Thành viên không tạo thông báo cho người khác');
select tests.login_as(tests.uid('pm_a'));
select throws_ok(tests.ins_for('member_a'), '42501', null, 'PM không tạo thông báo');
select tests.login_as(tests.uid('admin'));
select throws_ok(tests.ins_for('member_a'), '42501', null, 'Admin không tạo thông báo');
select tests.login_anon();
select throws_ok(tests.ins_for('member_a'), '42501', null, 'anon không tạo thông báo');
select tests.logout();
set local role service_role;
select throws_ok(tests.ins_for('member_a'), '42501', null, 'service_role không tạo thông báo');
reset role;

-- Thông báo giả lập cho người bị khóa, Admin bị khóa (chủ bảng chèn, để kiểm RLS).
insert into public.notifications (user_id, type, task_id, project_id, payload) values
  (tests.uid('locked'), 'task_assigned', tests.t('task_1'), tests.uid('project_a'), '{"title":"x"}'),
  (tests.uid('locked_admin'), 'task_assigned', tests.t('task_1'), tests.uid('project_a'), '{"title":"x"}');

-- ===========================================================================
-- SELECT: chỉ của mình
-- ===========================================================================
create function tests.visible()
returns integer language sql stable as $$
  select count(*)::int from public.notifications;
$$;
create function tests.visible_others()
returns integer language sql stable as $$
  select count(*)::int from public.notifications where user_id <> auth.uid();
$$;
grant execute on function tests.visible(), tests.visible_others() to anon, authenticated;

select tests.login_as(tests.uid('member_a'));
select is(tests.visible(), tests.n_count(tests.uid('member_a')), 'Thành viên thấy đủ thông báo của mình');
select is(tests.visible_others(), 0, 'Thành viên không thấy của người khác');
select tests.login_as(tests.uid('pm_a'));
select is(tests.visible(), tests.n_count(tests.uid('pm_a')), 'PM thấy đủ thông báo của mình');
select is(tests.visible_others(), 0, 'PM không thấy thông báo của thành viên dự án mình');
select tests.login_as(tests.uid('viewer_a'));
select is(tests.visible(), 0, 'Người xem không có thông báo, không thấy của ai');
select tests.login_as(tests.uid('admin'));
select is(tests.visible_others(), 0, 'Admin không thấy thông báo của người khác');
select is(tests.visible(), tests.n_count(tests.uid('admin')), 'Admin thấy của mình');
select tests.login_as(tests.uid('outsider'));
select is(tests.visible(), 0, 'Người ngoài không thấy gì');
select tests.login_as(tests.uid('locked'));
select is(tests.visible(), 0, 'Người bị khóa không thấy cả thông báo của mình');
select tests.login_as(tests.uid('locked_admin'));
select is(tests.visible(), 0, 'Admin bị khóa không thấy gì');
select tests.login_anon();
select throws_ok('select count(*) from public.notifications', '42501', null, 'anon bị từ chối');
select tests.login_as(tests.uid('member_a'));
select throws_ok('select payload from public.notifications', '42501', null,
  'Đọc thẳng cột payload bị từ chối');

-- ===========================================================================
-- UPDATE: đánh dấu đã đọc, chỉ của mình
-- ===========================================================================
select tests.login_as(tests.uid('member_a'));
select is(tests.affected_rows(format(
  'update public.notifications set read_at = now() where id = %L', tests.n_id(tests.uid('member_a')))),
  1, 'AC2: người nhận đánh dấu đã đọc');
select is(tests.affected_rows(format(
  'update public.notifications set read_at = now() where id = %L', tests.n_id(tests.uid('pm_a')))),
  0, 'Thành viên không đánh dấu thông báo của PM');
select throws_ok(format(
  'update public.notifications set user_id = %L where id = %L', tests.uid('pm_a'), tests.n_id(tests.uid('member_a'))),
  '42501', null, 'Không chuyển thông báo sang người khác');
select throws_ok(format(
  $$update public.notifications set payload = '{}' where id = %L$$, tests.n_id(tests.uid('member_a'))),
  '42501', null, 'Không sửa payload');
select throws_ok(format(
  'delete from public.notifications where id = %L', tests.n_id(tests.uid('member_a'))),
  '42501', null, 'Không xóa thông báo');
select tests.login_as(tests.uid('pm_a'));
select is(tests.affected_rows(format(
  'update public.notifications set read_at = now() where id = %L', tests.n_id(tests.uid('member_a')))),
  0, 'PM không đánh dấu thông báo của thành viên');
select tests.login_as(tests.uid('admin'));
select is(tests.affected_rows('update public.notifications set read_at = now()'),
  tests.n_count(tests.uid('admin')), 'Admin chỉ đánh dấu được của mình');
select tests.login_as(tests.uid('locked'));
select is(tests.affected_rows('update public.notifications set read_at = now()'), 0,
  'Người bị khóa không đánh dấu được');
select tests.login_as(tests.uid('outsider'));
select is(tests.affected_rows('update public.notifications set read_at = now()'), 0,
  'Người ngoài không đánh dấu được gì');
select tests.login_as(tests.uid('member_a'));
select is(tests.affected_rows('update public.notifications set read_at = now() where read_at is null'),
  tests.n_count(tests.uid('member_a')) - 1, 'Đánh dấu tất cả: đúng số chưa đọc của mình');
select tests.logout();
select is((select count(*)::int from public.notifications
           where user_id = tests.uid('pm_a') and read_at is not null), 0,
  'Thông báo của PM vẫn chưa đọc sau khi thành viên đánh dấu tất cả');

-- ===========================================================================
-- Đọc payload qua hàm: chỉ khi còn đọc được task (không rò rỉ)
-- ===========================================================================
create function tests.payload_titles(recipient text)
returns setof text language sql stable as $$
  select p.payload ->> 'title'
  from public.notification_payloads(
    (select array_agg(id) from public.notifications)) p;
$$;
grant execute on function tests.payload_titles(text) to authenticated;

select tests.login_as(tests.uid('member_a'));
select ok('Viết đặc tả' in (select * from tests.payload_titles('member_a')),
  'Người nhận đọc được tiêu đề khi còn quyền đọc task');
select is((select count(*)::int from public.notification_payloads(array[tests.n_id(tests.uid('pm_a'))])),
  0, 'Không đọc được payload thông báo của người khác dù biết id');

-- Gỡ member_a khỏi dự án A: thông báo vẫn còn (của mình) nhưng payload không còn trả về.
select tests.logout();
delete from public.project_members
  where project_id = tests.uid('project_a') and user_id = tests.uid('member_a');
select tests.login_as(tests.uid('member_a'));
select ok(tests.visible() > 0, 'Mất quyền dự án: vẫn thấy dòng thông báo của mình (hiển thị trung tính)');
select is((select count(*)::int from tests.payload_titles('member_a')), 0,
  'Mất quyền dự án: không còn đọc được tiêu đề task trong payload');
select tests.login_as(tests.uid('locked'));
select is((select count(*)::int from public.notification_payloads(array[tests.n_id(tests.uid('locked'))])),
  0, 'Người bị khóa không đọc được payload');
select tests.login_as(tests.uid('pm_a'));
select ok((select count(*)::int from public.notification_payloads(
  (select array_agg(id) from public.notifications))) > 0, 'PM vẫn đọc được payload của mình');

-- ===========================================================================
-- Xóa task: thông báo về task đó xóa theo
-- ===========================================================================
select tests.logout();
delete from public.tasks where id = tests.t('task_1');
select is((select count(*)::int from public.notifications where task_id = tests.t('task_1')), 0,
  'Xóa task xóa theo thông báo của task');
delete from public.projects where id = tests.uid('project_a');
select is((select count(*)::int from public.notifications where project_id = tests.uid('project_a')), 0,
  'Xóa dự án xóa theo thông báo');

select * from finish();
rollback;
