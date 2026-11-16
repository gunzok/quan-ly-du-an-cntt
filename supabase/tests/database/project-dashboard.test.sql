-- QLDA-60 (Story E5-1): hàm public.project_dashboard() (migration
-- 20261115250000_project_dashboard.sql). SECURITY INVOKER nên phạm vi đúng bằng RLS: mỗi vai trò có
-- ca thấy và ca không thấy (BR-10). Số liệu so với tập task biết trước, "hôm nay" = 2030-06-15.
begin;
\ir _helpers.psql
select tests.seed_fixture();

-- Dự án A (task):
--   1 xong sau hạn (member_a)        2 trễ 1 ngày (member_a, urgent)   3 hạn hôm nay (pm_a)
--   4 không hạn (chưa giao)          5 trễ 5 ngày (outsider, sẽ bị gỡ) 6 bị chặn bởi 2 (pm_a)
-- Dự án B: 1 task trễ hạn (không được lẫn vào số liệu A).
-- outsider tạm là thành viên A để được giao task 5, rồi bị gỡ.
insert into public.project_members (project_id, user_id, role)
values (tests.uid('project_a'), tests.uid('outsider'), 'member');

create temp table ids (k text primary key, id uuid);
grant select on ids to authenticated;

with s as (
  select
    (select id from public.task_statuses where project_id = tests.uid('project_a') and category = 'todo' order by position limit 1) as todo,
    (select id from public.task_statuses where project_id = tests.uid('project_a') and category = 'in_progress' order by position limit 1) as doing,
    (select id from public.task_statuses where project_id = tests.uid('project_a') and category = 'done' order by position limit 1) as done
),
ins as (
  insert into public.tasks (project_id, title, created_by, status_id, due_date, assignee_id, priority)
  select tests.uid('project_a'), v.title, tests.uid('pm_a'),
    case v.st when 'todo' then s.todo when 'doing' then s.doing else s.done end,
    v.due::date, v.who, v.prio::public.task_priority
  from s, (values
    ('T1', 'done',  '2030-06-01', tests.uid('member_a'), 'high'),
    ('T2', 'todo',  '2030-06-14', tests.uid('member_a'), 'urgent'),
    ('T3', 'doing', '2030-06-15', tests.uid('pm_a'),     'medium'),
    ('T4', 'todo',  null,         null::uuid,            'low'),
    ('T5', 'todo',  '2030-06-10', tests.uid('outsider'), 'high'),
    ('T6', 'doing', '2030-07-01', tests.uid('pm_a'),     'medium')
  ) as v (title, st, due, who, prio)
  returning title, id
)
insert into ids select title, id from ins;

insert into public.tasks (project_id, title, created_by, due_date)
values (tests.uid('project_b'), 'B trễ', tests.uid('pm_b'), '2030-01-01');

insert into public.task_relations (from_task_id, to_task_id, kind)
select (select id from ids where k = 'T2'), (select id from ids where k = 'T6'), 'blocks';
insert into public.task_relations (from_task_id, to_task_id, kind)
select (select id from ids where k = 'T1'), (select id from ids where k = 'T4'), 'blocks';

-- Gỡ outsider khỏi dự án A (task giữ người phụ trách cũ, quyết định E1-6).
delete from public.project_members where project_id = tests.uid('project_a') and user_id = tests.uid('outsider');

select plan(23);

-- ===========================================================================
-- Cấu trúc và quyền
-- ===========================================================================
select has_function('public', 'project_dashboard', array['uuid', 'date'], 'Có hàm public.project_dashboard(uuid, date)');
select is((select prosecdef from pg_proc where oid = 'public.project_dashboard(uuid, date)'::regprocedure),
  false, 'project_dashboard là SECURITY INVOKER (RLS áp dụng)');
select is((select proconfig from pg_proc where oid = 'public.project_dashboard(uuid, date)'::regprocedure),
  array['search_path=""'], 'project_dashboard đặt search_path rỗng');
select ok(has_function_privilege('authenticated', 'public.project_dashboard(uuid, date)', 'execute'),
  'authenticated gọi được project_dashboard');
select ok(not has_function_privilege('anon', 'public.project_dashboard(uuid, date)', 'execute'),
  'anon không gọi được project_dashboard');
select has_index('public', 'tasks', 'tasks_project_open_due_idx', 'Chỉ mục một phần task chưa xong theo hạn');

-- ===========================================================================
-- Số liệu (Thành viên A)
-- ===========================================================================
select tests.login_as(tests.uid('member_a'));
create temp table d as select public.project_dashboard(tests.uid('project_a'), '2030-06-15') as v;

select results_eq(
  $$select (v->>'total')::int, (v->>'done')::int, (v->>'open')::int, (v->>'todo')::int,
           (v->>'in_progress')::int, (v->>'overdue')::int, (v->>'open_no_due')::int, (v->>'blocked')::int
    from d$$,
  $$values (6, 1, 5, 3, 2, 2, 1, 1)$$,
  'Tổng 6, xong 1, mở 5, todo 3, đang làm 2, trễ 2 (hạn hôm nay/không hạn/xong sau hạn không trễ), không hạn 1, bị chặn 1');
select is((select v->>'today' from d), '2030-06-15', 'Trả ngày "hôm nay" đã dùng');
select is(
  (select sum((x->>'count')::int)::int from d, jsonb_array_elements(v->'by_status') x),
  6, 'Tổng theo trạng thái bằng tổng task');
select is(
  (select jsonb_array_length(v->'by_status') from d), 7, 'Đủ 7 trạng thái mặc định, kể cả trạng thái 0 task');
select is(
  (select v->'by_priority' from d),
  '[{"priority":"urgent","count":1},{"priority":"high","count":2},{"priority":"medium","count":2},{"priority":"low","count":1}]'::jsonb,
  'Phân bố theo ưu tiên, thứ tự urgent → low');
select is(
  (select (v->'by_type'->0->>'count')::int from d), 6, 'Loại mặc định đầu tiên chứa cả 6 task');
select results_eq(
  $$select x->>'assignee_id', (x->>'is_member')::boolean, (x->>'total')::int, (x->>'open')::int, (x->>'overdue')::int
    from d, jsonb_array_elements(v->'by_assignee') with ordinality as e(x, n) order by n$$,
  $$values
    (tests.uid('pm_a')::text, true, 2, 2, 0),
    (tests.uid('member_a')::text, true, 2, 1, 1),
    (tests.uid('outsider')::text, false, 1, 1, 1),
    (null::text, false, 1, 1, 0)$$,
  'Theo người phụ trách: nhiều việc mở trước, người đã bị gỡ is_member=false, chưa giao cuối');
select results_eq(
  $$select x->>'title', (x->>'days_overdue')::int
    from d, jsonb_array_elements(v->'overdue_tasks') with ordinality as e(x, n) order by n$$,
  $$values ('T5', 5), ('T2', 1)$$,
  'Danh sách trễ hạn: hạn sớm nhất trước, kèm số ngày trễ');
select is(
  (select (public.project_dashboard(tests.uid('project_a'), '2030-06-16')->>'overdue')::int),
  3, 'Sang ngày hôm sau: task hạn hôm qua thành trễ hạn');
select is(
  (select public.project_dashboard(tests.uid('project_a'))->>'today'),
  ((now() at time zone 'Asia/Ho_Chi_Minh')::date)::text,
  'p_today null: dùng ngày hiện tại theo giờ Việt Nam');

-- ===========================================================================
-- Phạm vi theo RLS (BR-10)
-- ===========================================================================
select tests.login_as(tests.uid('viewer_a'));
select is((public.project_dashboard(tests.uid('project_a'), '2030-06-15')->>'total')::int, 6,
  'Người xem A đọc được số liệu A');
select is(public.project_dashboard(tests.uid('project_b'), '2030-06-15'), null,
  'Người xem A không đọc được dự án B: null');

select tests.login_as(tests.uid('admin'));
select is((public.project_dashboard(tests.uid('project_a'), '2030-06-15')->>'total')::int, 6,
  'Admin (không thuộc dự án) đọc được số liệu A');

select tests.login_as(tests.uid('outsider'));
select is(public.project_dashboard(tests.uid('project_a'), '2030-06-15'), null, 'Người ngoài (đã bị gỡ khỏi dự án): null');

select tests.login_as(tests.uid('locked_admin'));
select is(public.project_dashboard(tests.uid('project_a'), '2030-06-15'), null, 'Admin bị khóa: null');

select tests.login_as(tests.uid('pm_b'));
select results_eq(
  $$select (v->>'total')::int, (v->>'overdue')::int, jsonb_array_length(v->'overdue_tasks')
    from (select public.project_dashboard(tests.uid('project_b'), '2030-06-15') v) x$$,
  $$values (1, 1, 1)$$,
  'PM B: chỉ số liệu dự án B');

select tests.login_anon();
select throws_ok(
  $$select public.project_dashboard('00000000-0000-0000-0000-00000000000a'::uuid, '2030-06-15')$$,
  '42501', null, 'anon không gọi được hàm');

select * from finish();
rollback;
