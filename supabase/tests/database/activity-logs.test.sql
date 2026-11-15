-- QLDA-49 (Story E6-1): nhật ký activity_logs (FR-16, BR-09).
--   AC1: sửa task thì có bản ghi gồm người, thời gian, trước và sau (chỉ cột đã đổi).
--   AC2: mọi vai trò (PM, Thành viên, Người xem, Admin, người ngoài, người bị khóa, anon,
--        service_role, cả chủ bảng postgres) thử INSERT/UPDATE/DELETE/TRUNCATE trực tiếp đều bị từ chối.
--   Ai đọc được nhật ký dự án nào (database.md mục 5); xóa task, xóa dự án, xóa người dùng vẫn còn
--   bản ghi.
-- Stack cục bộ dùng chung nên activity_logs có thể còn dòng của dữ liệu khác (không xóa được):
-- mọi phép đếm đều lọc theo dự án / thực thể của fixture.
begin;
\ir _helpers.psql
select tests.seed_fixture();

create function tests.t(name text)
returns uuid
language sql
immutable
as $$
  select case name
    when 'task_1' then '00000000-0000-0000-0000-000000006001'
    when 'task_2' then '00000000-0000-0000-0000-000000006002'
    when 'task_b' then '00000000-0000-0000-0000-000000006003'
  end::uuid;
$$;
grant execute on function tests.t(text) to anon, authenticated;

-- Đếm nhật ký của fixture với vai trò hiện tại (RLS áp dụng).
create function tests.log_count(p_project uuid)
returns integer
language sql
as $$
  select count(*)::int from public.activity_logs where project_id = p_project;
$$;
grant execute on function tests.log_count(uuid) to anon, authenticated, service_role;
grant usage on schema tests to service_role;

select plan(91);

-- ===========================================================================
-- Cấu trúc, quyền bảng, chính sách
-- ===========================================================================
select has_table('public', 'activity_logs', 'Có bảng public.activity_logs');
select columns_are('public', 'activity_logs',
  array['id', 'project_id', 'actor_id', 'entity_type', 'entity_id', 'action', 'changes', 'created_at'],
  'activity_logs đủ cột theo thiết kế');
select col_is_null('public', 'activity_logs', 'actor_id', 'actor_id cho phép null (hệ thống)');
select col_type_is('public', 'activity_logs', 'changes', 'jsonb', 'changes là jsonb');
select has_index('public', 'activity_logs', 'activity_logs_project_created_idx', 'Chỉ mục nhật ký dự án');
select has_index('public', 'activity_logs', 'activity_logs_entity_created_idx', 'Chỉ mục lịch sử thực thể');
select is((select relrowsecurity from pg_class where oid = 'public.activity_logs'::regclass), true,
  'RLS bật trên activity_logs');
select is(
  (select array_agg(cmd::text order by cmd) from pg_policies
    where schemaname = 'public' and tablename = 'activity_logs'),
  array['SELECT'],
  'Chỉ có chính sách SELECT, không có chính sách INSERT/UPDATE/DELETE');
select is(
  (select count(*)::int from pg_constraint
    where conrelid = 'public.activity_logs'::regclass and contype = 'f'),
  0, 'Không có khóa ngoại (xóa dự án, người dùng không xóa dây chuyền nhật ký)');
select table_privs_are('public', 'activity_logs', 'anon', array[]::text[], 'anon không có quyền nào');
select table_privs_are('public', 'activity_logs', 'authenticated', array['SELECT'],
  'authenticated chỉ có SELECT');
select table_privs_are('public', 'activity_logs', 'service_role', array['SELECT'],
  'service_role chỉ có SELECT');

-- ===========================================================================
-- Ghi nhật ký
-- ===========================================================================
-- Tạo dự án ở fixture (vai trò postgres): người làm null (hệ thống); người tạo thành PM cũng có bản ghi.
select is(
  (select row(action, actor_id, entity_id, changes -> 'before', changes -> 'after' ->> 'name')::text
    from public.activity_logs
    where entity_type = 'project' and entity_id = tests.uid('project_a') and action = 'create'),
  row('create', null::uuid, tests.uid('project_a'), 'null'::jsonb, 'Dự án A')::text,
  'Tạo dự án: bản ghi create, before null, after có tên, người làm null khi do hệ thống');
select ok(
  exists (select 1 from public.activity_logs
    where entity_type = 'project_member' and project_id = tests.uid('project_a')
      and entity_id = tests.uid('pm_a') and action = 'create'
      and changes -> 'after' ->> 'role' = 'pm'),
  'Người tạo dự án thành PM: có bản ghi project_member create');

-- Tạo task với id cố định: trình duyệt không có quyền cột id, nên chèn bằng postgres nhưng đặt
-- request.jwt.claims để auth.uid() là người tạo (trigger lấy người làm từ auth.uid()).
create function tests.as_actor(user_id uuid)
returns void
language sql
as $$
  select set_config('request.jwt.claims', json_build_object('sub', user_id)::text, true);
$$;
select tests.as_actor(tests.uid('pm_a'));
insert into public.tasks (id, project_id, title, assignee_id, created_by) values
  (tests.t('task_1'), tests.uid('project_a'), 'Task một', tests.uid('member_a'), tests.uid('pm_a')),
  (tests.t('task_2'), tests.uid('project_a'), 'Task hai', null, tests.uid('pm_a'));
select tests.as_actor(tests.uid('pm_b'));
insert into public.tasks (id, project_id, title, created_by) values
  (tests.t('task_b'), tests.uid('project_b'), 'Task B', tests.uid('pm_b'));

select tests.logout();
select is(
  (select row(actor_id, action, changes -> 'before', changes -> 'after' ->> 'title')::text
    from public.activity_logs where entity_type = 'task' and entity_id = tests.t('task_1')),
  row(tests.uid('pm_a'), 'create', 'null'::jsonb, 'Task một')::text,
  'Tạo task: người làm là người đăng nhập, after có tiêu đề');
select ok(
  (select not (changes -> 'after' ?| array['created_at', 'updated_at', 'position'])
    from public.activity_logs where entity_type = 'task' and entity_id = tests.t('task_1')),
  'Bản ghi không chứa created_at, updated_at, position');

-- AC1: sửa task.
select tests.login_as(tests.uid('member_a'));
update public.tasks
  set title = 'Task một (sửa)', priority = 'high', due_date = '2026-12-31'
  where id = tests.t('task_1');
select tests.logout();
select is(
  (select count(*)::int from public.activity_logs
    where entity_type = 'task' and entity_id = tests.t('task_1') and action = 'update'),
  1, 'AC1: sửa task tạo đúng một bản ghi update');
select is(
  (select actor_id from public.activity_logs
    where entity_type = 'task' and entity_id = tests.t('task_1') and action = 'update'),
  tests.uid('member_a'), 'AC1: bản ghi có người sửa');
select ok(
  (select created_at is not null and created_at <= now() and project_id = tests.uid('project_a')
    from public.activity_logs
    where entity_type = 'task' and entity_id = tests.t('task_1') and action = 'update'),
  'AC1: bản ghi có thời gian và dự án');
select is(
  (select changes from public.activity_logs
    where entity_type = 'task' and entity_id = tests.t('task_1') and action = 'update'),
  jsonb_build_object(
    'before', jsonb_build_object('title', 'Task một', 'priority', 'medium', 'due_date', null),
    'after', jsonb_build_object('title', 'Task một (sửa)', 'priority', 'high', 'due_date', '2026-12-31')),
  'AC1: trước và sau chỉ gồm các trường đã đổi (không updated_at)');

-- Không ghi nhiễu: chỉ kéo thả (position) hoặc gửi lại giá trị cũ.
select tests.login_as(tests.uid('pm_a'));
update public.tasks set position = 42 where id = tests.t('task_1');
update public.tasks set title = 'Task một (sửa)' where id = tests.t('task_1');
select tests.logout();
select is(
  (select count(*)::int from public.activity_logs
    where entity_type = 'task' and entity_id = tests.t('task_1') and action = 'update'),
  1, 'Chỉ đổi position hoặc không đổi giá trị nào thì không ghi bản ghi mới');

-- Đổi position cùng trường khác: chỉ ghi trường khác.
select tests.login_as(tests.uid('pm_a'));
update public.tasks set position = 7, assignee_id = null where id = tests.t('task_1');
select tests.logout();
select is(
  (select changes from public.activity_logs
    where entity_type = 'task' and entity_id = tests.t('task_1') and action = 'update'
    order by id desc limit 1),
  jsonb_build_object('before', jsonb_build_object('assignee_id', tests.uid('member_a')),
    'after', jsonb_build_object('assignee_id', null)),
  'Bỏ giao việc: ghi assignee_id trước/sau, không ghi position');

-- Sửa dự án và vai trò thành viên.
select tests.login_as(tests.uid('pm_a'));
update public.projects set name = 'Dự án A mới', status = 'archived' where id = tests.uid('project_a');
update public.project_members set role = 'member'
  where project_id = tests.uid('project_a') and user_id = tests.uid('viewer_a');
select tests.logout();
select is(
  (select row(actor_id, changes)::text from public.activity_logs
    where entity_type = 'project' and entity_id = tests.uid('project_a') and action = 'update'),
  row(tests.uid('pm_a'), jsonb_build_object(
    'before', jsonb_build_object('name', 'Dự án A', 'status', 'active'),
    'after', jsonb_build_object('name', 'Dự án A mới', 'status', 'archived')))::text,
  'Sửa dự án (kể cả lưu trữ): ghi tên và trạng thái trước/sau');
select is(
  (select row(entity_id, changes)::text from public.activity_logs
    where entity_type = 'project_member' and project_id = tests.uid('project_a') and action = 'update'
      and actor_id = tests.uid('pm_a')),
  row(tests.uid('viewer_a'), jsonb_build_object(
    'before', jsonb_build_object('role', 'viewer'), 'after', jsonb_build_object('role', 'member')))::text,
  'Đổi vai trò thành viên: entity_id là người được đổi, ghi role trước/sau');
-- Trả lại vai trò để test quyền đọc phía dưới đúng persona.
update public.project_members set role = 'viewer'
  where project_id = tests.uid('project_a') and user_id = tests.uid('viewer_a');

-- Thay đổi bị từ chối (RLS) không để lại bản ghi.
select tests.login_as(tests.uid('viewer_a'));
update public.tasks set title = 'Người xem sửa' where id = tests.t('task_2');
select tests.logout();
select is(
  (select count(*)::int from public.activity_logs
    where entity_type = 'task' and entity_id = tests.t('task_2') and action = 'update'),
  0, 'Sửa bị RLS lọc (0 dòng) thì không có bản ghi');

-- ===========================================================================
-- Đọc nhật ký: PM của dự án và Admin; Thành viên, Người xem, người ngoài, bị khóa, anon không
-- ===========================================================================
select tests.login_as(tests.uid('pm_a'));
select ok(tests.log_count(tests.uid('project_a')) > 0, 'PM dự án A đọc nhật ký dự án A');
select is(tests.log_count(tests.uid('project_b')), 0,
  'pm_a là Người xem ở B nên không đọc nhật ký dự án B');

select tests.login_as(tests.uid('pm_b'));
select ok(tests.log_count(tests.uid('project_b')) > 0, 'PM dự án B đọc nhật ký dự án B');
select is(tests.log_count(tests.uid('project_a')), 0, 'PM dự án B không đọc nhật ký dự án A');

select tests.login_as(tests.uid('admin'));
select ok(tests.log_count(tests.uid('project_a')) > 0 and tests.log_count(tests.uid('project_b')) > 0,
  'Admin đọc nhật ký mọi dự án (kể cả không là thành viên)');

select tests.login_as(tests.uid('member_a'));
select is_empty('select 1 from public.activity_logs', 'Thành viên không đọc nhật ký nào');
select tests.login_as(tests.uid('viewer_a'));
select is_empty('select 1 from public.activity_logs', 'Người xem không đọc nhật ký nào');
select tests.login_as(tests.uid('outsider'));
select is_empty('select 1 from public.activity_logs', 'Người ngoài không đọc nhật ký nào');
select tests.login_as(tests.uid('locked'));
select is_empty('select 1 from public.activity_logs', 'Người bị khóa không đọc nhật ký nào');
select tests.login_as(tests.uid('locked_admin'));
select is_empty('select 1 from public.activity_logs', 'Admin bị khóa không đọc nhật ký nào');
select tests.login_anon();
select throws_ok('select * from public.activity_logs', '42501', null, 'anon không có quyền đọc');
select tests.logout();

-- ===========================================================================
-- AC2 / BR-09: không ai INSERT, UPDATE, DELETE, TRUNCATE trực tiếp được
-- ===========================================================================
create function tests.try_tamper(who text)
returns setof text
language plpgsql
as $$
declare
  v_id bigint;
begin
  perform tests.logout();
  select id into v_id from public.activity_logs
    where entity_type = 'task' and entity_id = tests.t('task_1') and action = 'update'
    order by id limit 1;
  if who = 'anon' then
    perform tests.login_anon();
  else
    perform tests.login_as(tests.uid(who));
  end if;
  return next throws_ok(format(
    'update public.activity_logs set changes = ''{"before":null,"after":null}'' where id = %s', v_id),
    '42501', null, who || ' không sửa được nhật ký');
  return next throws_ok(format('delete from public.activity_logs where id = %s', v_id),
    '42501', null, who || ' không xóa được nhật ký');
  return next throws_ok(format(
    'insert into public.activity_logs (project_id, actor_id, entity_type, entity_id, action, changes) '
    'values (%L, %L, ''task'', %L, ''update'', ''{"before":null,"after":null}'')',
    tests.uid('project_a'), tests.uid('pm_a'), tests.t('task_1')),
    '42501', null, who || ' không chèn (giả mạo) được nhật ký');
  return next throws_ok('truncate public.activity_logs', '42501', null,
    who || ' không TRUNCATE được nhật ký');
  perform tests.logout();
end;
$$;

select * from tests.try_tamper('pm_a');
select * from tests.try_tamper('member_a');
select * from tests.try_tamper('viewer_a');
select * from tests.try_tamper('admin');
select * from tests.try_tamper('outsider');
select * from tests.try_tamper('locked');
select * from tests.try_tamper('locked_admin');
select * from tests.try_tamper('anon');

-- service_role (khóa máy chủ, bỏ qua RLS) cũng chỉ đọc.
select set_config('role', 'service_role', true);
select ok(tests.log_count(tests.uid('project_a')) > 0, 'service_role đọc được nhật ký');
select throws_ok(
  'update public.activity_logs set actor_id = null where project_id = ''00000000-0000-0000-0000-00000000000a''',
  '42501', null, 'service_role không sửa được nhật ký');
select throws_ok(
  'delete from public.activity_logs where project_id = ''00000000-0000-0000-0000-00000000000a''',
  '42501', null, 'service_role không xóa được nhật ký');
select throws_ok(
  'insert into public.activity_logs (project_id, entity_type, entity_id, action, changes) '
  'values (''00000000-0000-0000-0000-00000000000a'', ''task'', gen_random_uuid(), ''create'', '
  '''{"before":null,"after":null}'')',
  '42501', null, 'service_role không chèn được nhật ký');
select throws_ok('truncate public.activity_logs', '42501', null, 'service_role không TRUNCATE được');
select tests.logout();

-- Chủ bảng (postgres, bỏ qua RLS và GRANT): trigger vẫn chặn.
select throws_ok(
  'update public.activity_logs set actor_id = null where project_id = ''00000000-0000-0000-0000-00000000000a''',
  '42501', 'activity_logs_immutable', 'Chủ bảng không sửa được nhật ký (trigger)');
select throws_ok(
  'delete from public.activity_logs where project_id = ''00000000-0000-0000-0000-00000000000a''',
  '42501', 'activity_logs_immutable', 'Chủ bảng không xóa được nhật ký (trigger)');
select throws_ok('truncate public.activity_logs', '42501', 'activity_logs_immutable',
  'Chủ bảng không TRUNCATE được nhật ký (trigger)');
select throws_ok(
  'insert into public.activity_logs (project_id, entity_type, entity_id, action, changes) '
  'values (''00000000-0000-0000-0000-00000000000a'', ''task'', gen_random_uuid(), ''create'', '
  '''{"before":null,"after":null}'')',
  '42501', 'activity_logs_insert_forbidden', 'Chủ bảng không chèn tay được nhật ký (trigger)');
select is(
  (select changes ->> 'after' is not null from public.activity_logs
    where entity_type = 'task' and entity_id = tests.t('task_1') and action = 'update'
    order by id limit 1),
  true, 'Bản ghi nhật ký vẫn nguyên sau mọi lần thử');

-- ===========================================================================
-- Xóa vĩnh viễn vẫn để lại bản ghi
-- ===========================================================================
select tests.login_as(tests.uid('pm_a'));
delete from public.tasks where id = tests.t('task_2');
select tests.logout();
select is(
  (select row(actor_id, changes -> 'before' ->> 'title', changes -> 'after')::text
    from public.activity_logs where entity_type = 'task' and entity_id = tests.t('task_2') and action = 'delete'),
  row(tests.uid('pm_a'), 'Task hai', 'null'::jsonb)::text,
  'Xóa task: bản ghi delete có người xóa, before là dòng cũ, after null');
select is(
  (select count(*)::int from public.activity_logs where entity_type = 'task' and entity_id = tests.t('task_2')),
  2, 'Task đã xóa vẫn còn cả bản ghi tạo và bản ghi xóa');

-- Xóa dự án (chỉ Admin): task, thành viên xóa dây chuyền đều có bản ghi; nhật ký cũ còn nguyên.
select tests.login_as(tests.uid('admin'));
select lives_ok(format('delete from public.projects where id = %L', tests.uid('project_a')),
  'Admin xóa dự án A không bị nhật ký chặn');
select tests.logout();
select is((select count(*)::int from public.projects where id = tests.uid('project_a')), 0,
  'Dự án A đã bị xóa vĩnh viễn');
select ok(
  exists (select 1 from public.activity_logs
    where entity_type = 'project' and entity_id = tests.uid('project_a') and action = 'delete'
      and actor_id = tests.uid('admin') and changes -> 'before' ->> 'name' = 'Dự án A mới'),
  'Xóa dự án: có bản ghi delete của dự án, người xóa là Admin');
select ok(
  exists (select 1 from public.activity_logs
    where entity_type = 'task' and entity_id = tests.t('task_1') and action = 'delete'
      and actor_id = tests.uid('admin')),
  'Task xóa dây chuyền theo dự án cũng có bản ghi delete');
select is(
  (select count(*)::int from public.activity_logs
    where entity_type = 'project_member' and project_id = tests.uid('project_a') and action = 'delete'),
  4, 'Bốn thành viên dự án A xóa dây chuyền đều có bản ghi delete');
select ok(
  exists (select 1 from public.activity_logs
    where entity_type = 'task' and entity_id = tests.t('task_1') and action = 'update'
      and actor_id = tests.uid('member_a')),
  'Bản ghi sửa task trước khi xóa dự án vẫn còn (không xóa dây chuyền)');

select tests.login_as(tests.uid('admin'));
select ok(tests.log_count(tests.uid('project_a')) > 0, 'Admin vẫn đọc nhật ký của dự án đã xóa');
select tests.login_as(tests.uid('pm_a'));
select is(tests.log_count(tests.uid('project_a')), 0,
  'Dự án đã xóa thì không còn PM nên PM cũ không đọc được nữa');
select tests.logout();

-- Xóa người dùng: nhật ký giữ nguyên id người làm.
select lives_ok(format('delete from auth.users where id = %L', tests.uid('pm_b')),
  'Xóa tài khoản người dùng không bị nhật ký chặn');
select is(
  (select actor_id from public.activity_logs where entity_type = 'task' and entity_id = tests.t('task_b')
    and action = 'create'),
  tests.uid('pm_b'), 'Bản ghi của người đã xóa vẫn giữ actor_id');
select ok(
  exists (select 1 from public.activity_logs where entity_type = 'task' and entity_id = tests.t('task_b')
    and action = 'update' and actor_id is null
    and changes = jsonb_build_object('before', jsonb_build_object('created_by', tests.uid('pm_b')),
      'after', jsonb_build_object('created_by', null))),
  'Khóa ngoại tasks.created_by đặt null khi xóa người dùng được ghi là thay đổi của hệ thống');

select * from finish();
rollback;
