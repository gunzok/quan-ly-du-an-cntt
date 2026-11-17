-- QLDA-52 (Story E3-4): chính sách SELECT viết lại bằng private.my_project_ids() /
-- private.my_pm_project_ids() (20261115310000_rls_project_scope.sql) TƯƠNG ĐƯƠNG điều kiện cũ.
--
-- Cách chứng minh: với từng persona (Admin, PM, Thành viên, Người xem, người ngoài, người bị khóa,
-- Admin bị khóa, PM ở dự án này đồng thời Người xem ở dự án khác), tính tập dòng "được thấy" bằng
-- ĐÚNG biểu thức của chính sách cũ (project_role_of, can_read_task) trên mọi dòng (vai trò postgres,
-- bỏ qua RLS, nhưng auth.uid() là persona), rồi so bằng set_eq với tập dòng persona thật sự đọc được
-- qua RLS mới. Hai chiều: không thấy thừa, không thiếu. Thêm: so hai hàm mới với project_role_of
-- trên mọi dự án, anon không gọi được hàm, hàm SECURITY DEFINER có search_path rỗng.
begin;
\ir _helpers.psql
select tests.seed_fixture();

-- Dữ liệu ở cả hai dự án: task (có cha-con), nhãn, gắn nhãn, quan hệ, nhật ký (trigger tự ghi).
insert into public.tasks (id, project_id, title, created_by, assignee_id) values
  ('00000000-0000-0000-0000-00000000e301', tests.uid('project_a'), 'A1', tests.uid('pm_a'), tests.uid('member_a')),
  ('00000000-0000-0000-0000-00000000e302', tests.uid('project_a'), 'A2', tests.uid('member_a'), null),
  ('00000000-0000-0000-0000-00000000e303', tests.uid('project_a'), 'A3', tests.uid('pm_a'), null),
  ('00000000-0000-0000-0000-00000000e311', tests.uid('project_b'), 'B1', tests.uid('pm_b'), null),
  ('00000000-0000-0000-0000-00000000e312', tests.uid('project_b'), 'B2', tests.uid('pm_b'), null);
update public.tasks set parent_id = '00000000-0000-0000-0000-00000000e301'
  where id = '00000000-0000-0000-0000-00000000e303';

insert into public.labels (id, project_id, name, color) values
  ('00000000-0000-0000-0000-00000000e3a1', tests.uid('project_a'), 'Nhãn A', '#D14343'),
  ('00000000-0000-0000-0000-00000000e3b1', tests.uid('project_b'), 'Nhãn B', '#2054F0');
insert into public.task_labels (task_id, label_id) values
  ('00000000-0000-0000-0000-00000000e301', '00000000-0000-0000-0000-00000000e3a1'),
  ('00000000-0000-0000-0000-00000000e302', '00000000-0000-0000-0000-00000000e3a1'),
  ('00000000-0000-0000-0000-00000000e311', '00000000-0000-0000-0000-00000000e3b1');
insert into public.task_relations (from_task_id, to_task_id, kind, created_by) values
  ('00000000-0000-0000-0000-00000000e301', '00000000-0000-0000-0000-00000000e302', 'blocks', tests.uid('pm_a')),
  ('00000000-0000-0000-0000-00000000e311', '00000000-0000-0000-0000-00000000e312', 'relates', tests.uid('pm_b'));

-- Tập khóa mong đợi theo chính sách CŨ, tính với vai trò postgres (thấy mọi dòng).
create table tests.expected (persona text, tbl text, key text);
create table tests.all_projects as select id from public.projects;
grant select on tests.expected, tests.all_projects to authenticated;

create function tests.old_visible(tbl text)
returns setof text
language plpgsql
as $$
begin
  return query execute case tbl
    when 'tasks' then $q$ select id::text from public.tasks
      where private.is_admin() or private.project_role_of(project_id) is not null $q$
    when 'task_statuses' then $q$ select id::text from public.task_statuses
      where private.is_admin() or private.project_role_of(project_id) is not null $q$
    when 'task_types' then $q$ select id::text from public.task_types
      where private.is_admin() or private.project_role_of(project_id) is not null $q$
    when 'labels' then $q$ select id::text from public.labels
      where private.is_admin() or private.project_role_of(project_id) is not null $q$
    when 'projects' then $q$ select id::text from public.projects
      where private.is_admin() or private.project_role_of(id) is not null $q$
    when 'project_members' then $q$ select project_id || '/' || user_id from public.project_members
      where private.is_admin() or private.project_role_of(project_id) is not null $q$
    when 'activity_logs' then $q$ select id::text from public.activity_logs
      where project_id in (select id from tests.all_projects)
        and (private.is_admin() or private.project_role_of(project_id) = 'pm') $q$
    when 'task_labels' then $q$ select task_id || '/' || label_id from public.task_labels
      where private.can_read_task(task_id) $q$
    when 'task_relations' then $q$ select from_task_id || '/' || to_task_id from public.task_relations
      where private.can_read_task(from_task_id) and private.can_read_task(to_task_id) $q$
  end;
end;
$$;

-- Cùng truy vấn nhưng KHÔNG có điều kiện quyền: chạy với vai trò persona, RLS mới quyết định.
create function tests.new_visible(tbl text)
returns setof text
language plpgsql
as $$
begin
  return query execute case tbl
    when 'tasks' then 'select id::text from public.tasks'
    when 'task_statuses' then 'select id::text from public.task_statuses'
    when 'task_types' then 'select id::text from public.task_types'
    when 'labels' then 'select id::text from public.labels'
    when 'projects' then 'select id::text from public.projects'
    when 'project_members' then $q$ select project_id || '/' || user_id from public.project_members $q$
    when 'activity_logs' then $q$ select id::text from public.activity_logs
      where project_id in (select id from tests.all_projects) $q$
    when 'task_labels' then $q$ select task_id || '/' || label_id from public.task_labels $q$
    when 'task_relations' then $q$ select from_task_id || '/' || to_task_id from public.task_relations $q$
  end;
end;
$$;

create table tests.tables (tbl text primary key);
insert into tests.tables values ('tasks'), ('task_statuses'), ('task_types'), ('labels'),
  ('projects'), ('project_members'), ('activity_logs'), ('task_labels'), ('task_relations');

create table tests.personas (persona text primary key);
insert into tests.personas values ('admin'), ('pm_a'), ('pm_b'), ('member_a'), ('viewer_a'),
  ('outsider'), ('locked'), ('locked_admin');

-- Ghi tập mong đợi: vai trò postgres + request.jwt.claims của persona (auth.uid() = persona).
do $$
declare
  p text;
  t text;
begin
  for p in select persona from tests.personas loop
    perform set_config('request.jwt.claims',
      json_build_object('sub', tests.uid(p), 'role', 'authenticated')::text, true);
    for t in select tbl from tests.tables loop
      insert into tests.expected select p, t, k from tests.old_visible(t) k;
    end loop;
  end loop;
  perform set_config('request.jwt.claims', '', true);
end;
$$;

-- Một persona: so tập thấy được (RLS mới) với tập mong đợi (điều kiện cũ) cho mọi bảng, và hai
-- hàm mới với project_role_of trên mọi dự án.
create function tests.check_persona(p text)
returns setof text
language plpgsql
as $$
declare
  t text;
begin
  for t in select tbl from tests.tables order by tbl loop
    return next set_eq(
      format('select tests.new_visible(%L)', t),
      format('select key from tests.expected where persona = %L and tbl = %L', p, t),
      format('%s: %s thấy đúng tập dòng như chính sách cũ', p, t)
    );
  end loop;
  return next set_eq(
    'select id from tests.all_projects where id in (select private.my_project_ids())',
    'select id from tests.all_projects where private.project_role_of(id) is not null',
    format('%s: my_project_ids() ⇔ project_role_of(x) is not null', p)
  );
  return next set_eq(
    'select id from tests.all_projects where id in (select private.my_pm_project_ids())',
    $q$ select id from tests.all_projects where private.project_role_of(id) = 'pm' $q$,
    format('%s: my_pm_project_ids() ⇔ project_role_of(x) = pm', p)
  );
end;
$$;
create function tests.plan_of(sql text)
returns text
language plpgsql
as $$
declare
  line text;
  result text := '';
begin
  for line in execute 'explain (costs off) ' || sql loop
    result := result || line || E'\n';
  end loop;
  return result;
end;
$$;
grant execute on function tests.plan_of(text) to authenticated;
grant execute on all functions in schema tests to authenticated;
grant select on tests.tables, tests.personas to authenticated;

select plan(110);

-- ===========================================================================
-- Hàm mới: định nghĩa an toàn
-- ===========================================================================
select is(
  (select prosecdef and proconfig = array['search_path=""'] and provolatile = 's'
     from pg_proc where oid = 'private.my_project_ids()'::regprocedure),
  true, 'my_project_ids: SECURITY DEFINER, STABLE, search_path rỗng');
select is(
  (select prosecdef and proconfig = array['search_path=""'] and provolatile = 's'
     from pg_proc where oid = 'private.my_pm_project_ids()'::regprocedure),
  true, 'my_pm_project_ids: SECURITY DEFINER, STABLE, search_path rỗng');
select ok(not has_function_privilege('anon', 'private.my_project_ids()', 'execute'),
  'anon không gọi được my_project_ids');
select ok(not has_function_privilege('anon', 'private.my_pm_project_ids()', 'execute'),
  'anon không gọi được my_pm_project_ids');
select ok(has_function_privilege('authenticated', 'private.my_project_ids()', 'execute'),
  'authenticated gọi được my_project_ids (chính sách cần)');
select ok(not has_function_privilege('public', 'private.my_pm_project_ids()', 'execute'),
  'PUBLIC không có quyền gọi my_pm_project_ids');

-- ===========================================================================
-- Dữ liệu mong đợi có phân biệt thật giữa các persona (test không rỗng một cách vô nghĩa)
-- ===========================================================================
select is((select count(*)::int from tests.expected where persona = 'admin' and tbl = 'tasks'), 5,
  'Mong đợi: Admin thấy 5 task');
select is((select count(*)::int from tests.expected where persona = 'member_a' and tbl = 'tasks'), 3,
  'Mong đợi: Thành viên A thấy 3 task');
select is((select count(*)::int from tests.expected where persona = 'outsider'), 0,
  'Mong đợi: người ngoài không thấy gì');
select is((select count(*)::int from tests.expected where persona in ('locked', 'locked_admin')), 0,
  'Mong đợi: người bị khóa, Admin bị khóa không thấy gì');
select ok((select count(*) from tests.expected where persona = 'pm_a' and tbl = 'activity_logs')
    < (select count(*) from tests.expected where persona = 'admin' and tbl = 'activity_logs'),
  'Mong đợi: pm_a (Người xem ở B) không thấy nhật ký dự án B');
select is((select count(*)::int from tests.expected where persona = 'viewer_a' and tbl = 'activity_logs'), 0,
  'Mong đợi: Người xem không thấy nhật ký');

-- ===========================================================================
-- Tương đương theo persona: 9 bảng + 2 hàm = 11 kiểm mỗi persona
-- ===========================================================================
select tests.login_as(tests.uid('admin'));
select * from tests.check_persona('admin');
select tests.login_as(tests.uid('pm_a'));
select * from tests.check_persona('pm_a');
select tests.login_as(tests.uid('pm_b'));
select * from tests.check_persona('pm_b');
select tests.login_as(tests.uid('member_a'));
select * from tests.check_persona('member_a');
select tests.login_as(tests.uid('viewer_a'));
select * from tests.check_persona('viewer_a');
select tests.login_as(tests.uid('outsider'));
select * from tests.check_persona('outsider');
select tests.login_as(tests.uid('locked'));
select * from tests.check_persona('locked');
select tests.login_as(tests.uid('locked_admin'));
select * from tests.check_persona('locked_admin');

-- Thay đổi quyền có hiệu lực ngay (hàm STABLE tính lại mỗi truy vấn, không đệm giữa truy vấn).
select tests.logout();
update public.project_members set role = 'viewer'
  where project_id = tests.uid('project_a') and user_id = tests.uid('member_a');
select tests.login_as(tests.uid('member_a'));
select is((select count(*)::int from public.tasks), 3, 'Hạ xuống Người xem: vẫn đọc task A');
select tests.logout();
delete from public.project_members
  where project_id = tests.uid('project_a') and user_id = tests.uid('member_a');
select tests.login_as(tests.uid('member_a'));
select is((select count(*)::int from public.tasks), 0, 'Bị gỡ khỏi dự án: không đọc được task nữa');
select is((select count(*)::int from public.task_labels), 0, 'Bị gỡ: không đọc được task_labels');
select tests.logout();
update public.profiles set is_active = false where id = tests.uid('pm_b');
select tests.login_as(tests.uid('pm_b'));
select is((select count(*)::int from public.projects), 0, 'PM bị khóa: không thấy dự án');
select is((select count(*)::int from public.activity_logs), 0, 'PM bị khóa: không thấy nhật ký');

-- anon: không có quyền bảng (lớp GRANT) nên không đọc được gì.
select tests.login_anon();
select throws_ok('select count(*) from public.tasks', '42501', null, 'anon: không có quyền đọc tasks');
select throws_ok('select count(*) from public.task_labels', '42501', null, 'anon: không có quyền đọc task_labels');
select throws_ok('select private.my_project_ids()', '42501', null, 'anon: không gọi được my_project_ids');
select tests.logout();

-- Kế hoạch truy vấn: điều kiện quyền tính một lần (hashed SubPlan/InitPlan), không gọi
-- project_role_of trên từng dòng.
select tests.login_as(tests.uid('pm_a'));
select unalike(tests.plan_of('select count(*) from public.tasks'), '%project_role_of%',
  'tasks: kế hoạch không gọi project_role_of từng dòng');
select unalike(tests.plan_of('select count(*) from public.task_labels'), '%can_read_task%',
  'task_labels: kế hoạch không gọi can_read_task từng dòng');

select * from finish();
rollback;
