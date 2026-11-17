-- QLDA-58 (Story E8-3): hàm public.task_open_blockers (cờ blocked/blocked_by, BR-06).
-- Ca biên: chặn bởi task đã xong thì không tính; nhiều task chặn (thứ tự, cắt theo p_limit, tổng
-- số); precedes/relates không chặn; xóa quan hệ; task chặn vừa xong; task đích đã xong (hàm vẫn
-- trả, API quyết định). Phân quyền: PM, Thành viên, Người xem, Admin (không thuộc dự án) thấy;
-- PM dự án khác, người ngoài, người bị khóa, Admin bị khóa không thấy gì (RLS, SECURITY INVOKER);
-- anon không gọi được.
begin;
\ir _helpers.psql
select tests.seed_fixture();

create function tests.b(name text)
returns uuid
language sql
immutable
as $$
  select case name
    when 't1' then '00000000-0000-0000-0000-000000009001'
    when 't2' then '00000000-0000-0000-0000-000000009002'
    when 't3' then '00000000-0000-0000-0000-000000009003'
    when 't4' then '00000000-0000-0000-0000-000000009004'
    when 't5' then '00000000-0000-0000-0000-000000009005'
    when 't6' then '00000000-0000-0000-0000-000000009006'
    when 'b1' then '00000000-0000-0000-0000-000000009101'
    when 'b2' then '00000000-0000-0000-0000-000000009102'
    when 'b3' then '00000000-0000-0000-0000-000000009103'
    when 'b4' then '00000000-0000-0000-0000-000000009104'
    when 'p1' then '00000000-0000-0000-0000-000000009201'
    when 'tb' then '00000000-0000-0000-0000-000000009301'
    when 'bb' then '00000000-0000-0000-0000-000000009302'
  end::uuid;
$$;
grant execute on function tests.b(text) to anon, authenticated;

-- Số task chặn mở, mảng id (theo task đích) với vai trò hiện tại.
create function tests.blockers(target text, lim integer default 5)
returns table (ids uuid[], n integer)
language sql
as $$
  select blocker_ids, blocker_count
  from public.task_open_blockers(array[tests.b(target)], lim);
$$;
grant execute on function tests.blockers(text, integer) to anon, authenticated;

-- Số task (trong t1..t6, tb) có ít nhất một task chặn mở, nhìn từ vai trò hiện tại.
create function tests.blocked_count()
returns integer
language sql
as $$
  select count(*)::integer from public.task_open_blockers(array[
    tests.b('t1'), tests.b('t2'), tests.b('t3'), tests.b('t4'), tests.b('t5'), tests.b('t6'),
    tests.b('tb')], 5);
$$;
grant execute on function tests.blocked_count() to anon, authenticated;

insert into public.tasks (id, project_id, title, created_by) values
  (tests.b('t1'), tests.uid('project_a'), 'T1', tests.uid('pm_a')),
  (tests.b('t2'), tests.uid('project_a'), 'T2', tests.uid('pm_a')),
  (tests.b('t3'), tests.uid('project_a'), 'T3', tests.uid('pm_a')),
  (tests.b('t4'), tests.uid('project_a'), 'T4', tests.uid('pm_a')),
  (tests.b('t5'), tests.uid('project_a'), 'T5', tests.uid('pm_a')),
  (tests.b('t6'), tests.uid('project_a'), 'T6', tests.uid('pm_a')),
  (tests.b('b1'), tests.uid('project_a'), 'B1', tests.uid('pm_a')),
  (tests.b('b2'), tests.uid('project_a'), 'B2', tests.uid('pm_a')),
  (tests.b('b3'), tests.uid('project_a'), 'B3', tests.uid('pm_a')),
  (tests.b('b4'), tests.uid('project_a'), 'B4', tests.uid('pm_a')),
  (tests.b('p1'), tests.uid('project_a'), 'P1', tests.uid('pm_a')),
  (tests.b('tb'), tests.uid('project_b'), 'TB', tests.uid('pm_b')),
  (tests.b('bb'), tests.uid('project_b'), 'BB', tests.uid('pm_b'));

-- Quan hệ (ghi bằng postgres: trigger bỏ qua kiểm quyền người dùng cuối, vẫn kiểm vòng).
insert into public.task_relations (from_task_id, to_task_id, kind) values
  (tests.b('b2'), tests.b('t1'), 'blocks'),
  (tests.b('b1'), tests.b('t1'), 'blocks'),
  (tests.b('b3'), tests.b('t2'), 'blocks'),     -- b3 sẽ xong
  (tests.b('b1'), tests.b('t3'), 'blocks'),     -- sẽ bị xóa
  (tests.b('p1'), tests.b('t4'), 'precedes'),   -- không chặn
  (tests.b('b1'), tests.b('t4'), 'relates'),    -- không chặn
  (tests.b('t4'), tests.b('b4'), 'duplicates'), -- không chặn
  (tests.b('b1'), tests.b('t5'), 'blocks'),
  (tests.b('b2'), tests.b('t5'), 'blocks'),
  (tests.b('b4'), tests.b('t5'), 'blocks'),
  (tests.b('b1'), tests.b('t6'), 'blocks'),     -- t6 sẽ xong
  (tests.b('bb'), tests.b('tb'), 'blocks');

-- Thứ tự tạo task chặn: b1 < b2 < b4 (created_at của cùng giao dịch bằng nhau, đặt tay).
update public.tasks set created_at = '2026-01-01T00:00:00Z' where id = tests.b('b1');
update public.tasks set created_at = '2026-01-02T00:00:00Z' where id = tests.b('b2');
update public.tasks set created_at = '2026-01-03T00:00:00Z' where id = tests.b('b4');

-- b3, t6 xong (trạng thái nhóm done; trigger đặt completed_at).
update public.tasks
set status_id = (select id from public.task_statuses
                 where project_id = tests.uid('project_a') and category = 'done'
                 order by position limit 1)
where id in (tests.b('b3'), tests.b('t6'));

select plan(27);

-- ===========================================================================
-- Cấu trúc và quyền thực thi
-- ===========================================================================
select has_function('public', 'task_open_blockers', array['uuid[]', 'integer'],
  'Có hàm public.task_open_blockers(uuid[], integer)');
select is((select prosecdef from pg_proc where oid = 'public.task_open_blockers(uuid[], integer)'::regprocedure),
  false, 'SECURITY INVOKER: RLS của người gọi áp dụng');
select is((select proconfig from pg_proc where oid = 'public.task_open_blockers(uuid[], integer)'::regprocedure),
  array['search_path=""'], 'search_path rỗng');
select ok(not has_function_privilege('anon', 'public.task_open_blockers(uuid[], integer)', 'execute'),
  'anon không có quyền thực thi');
select ok(has_function_privilege('authenticated', 'public.task_open_blockers(uuid[], integer)', 'execute'),
  'authenticated có quyền thực thi');
select is((select completed_at is not null from public.tasks where id = tests.b('b3')), true,
  'Chuẩn bị: b3 đã xong');

-- ===========================================================================
-- Ngữ nghĩa (PM dự án A)
-- ===========================================================================
select tests.login_as(tests.uid('pm_a'));
select results_eq($$select ids, n from tests.blockers('t1')$$,
  $$values (array[tests.b('b1'), tests.b('b2')], 2)$$,
  'Nhiều task chặn: đủ id theo thứ tự tạo task chặn, kèm tổng số');
select is_empty($$select * from tests.blockers('t2')$$,
  'Chỉ bị chặn bởi task đã xong: không bị chặn');
select is_empty($$select * from tests.blockers('t4')$$,
  'precedes, relates, duplicates không chặn');
select results_eq($$select ids, n from tests.blockers('t5', 2)$$,
  $$values (array[tests.b('b1'), tests.b('b2')], 3)$$,
  'p_limit cắt danh sách id, tổng số vẫn đủ');
select results_eq($$select ids, n from tests.blockers('t6')$$,
  $$values (array[tests.b('b1')], 1)$$,
  'Task đích đã xong vẫn trả task chặn mở (API quyết định cờ blocked, cảnh báo PATCH)');
select is_empty($$select * from public.task_open_blockers(array[]::uuid[], 5)$$,
  'Mảng rỗng: không dòng nào');
select throws_ok($$select * from public.task_open_blockers(
    array(select gen_random_uuid() from generate_series(1, 1001)), 5)$$,
  '22023', null, 'Quá 1000 id: từ chối');
select throws_ok($$select * from public.task_open_blockers(array[tests.b('t1')], 0)$$,
  '22023', null, 'p_limit ngoài 1-20: từ chối');

-- Xóa quan hệ: hết bị chặn.
select results_eq($$select n from tests.blockers('t3')$$, $$values (1)$$, 'Trước khi xóa: t3 bị chặn');
select tests.logout();
delete from public.task_relations where from_task_id = tests.b('b1') and to_task_id = tests.b('t3');
select tests.login_as(tests.uid('pm_a'));
select is_empty($$select * from tests.blockers('t3')$$, 'Xóa quan hệ blocks: hết bị chặn');

-- ===========================================================================
-- Phân quyền theo vai trò: t1, t5, t6 (dự án A) bị chặn; tb (dự án B) bị chặn
-- ===========================================================================
select is(tests.blocked_count(), 4, 'PM dự án A (Người xem dự án B): thấy 3 của A + 1 của B');
select tests.login_as(tests.uid('member_a'));
select is(tests.blocked_count(), 3, 'Thành viên dự án A: thấy 3');
select tests.login_as(tests.uid('viewer_a'));
select is(tests.blocked_count(), 3, 'Người xem dự án A: thấy 3 (chỉ đọc)');
select tests.login_as(tests.uid('admin'));
select is(tests.blocked_count(), 4, 'Admin: thấy mọi dự án (3 + 1)');
select tests.login_as(tests.uid('pm_b'));
select is(tests.blocked_count(), 1, 'PM dự án B: chỉ thấy task của dự án B');
select tests.login_as(tests.uid('outsider'));
select is(tests.blocked_count(), 0, 'Người ngoài: không thấy gì (không lộ sự tồn tại)');
select tests.login_as(tests.uid('locked'));
select is(tests.blocked_count(), 0, 'Người bị khóa: không thấy gì');
select tests.login_as(tests.uid('locked_admin'));
select is(tests.blocked_count(), 0, 'Admin bị khóa: không thấy gì');
select tests.login_anon();
select throws_ok($$select * from public.task_open_blockers(array[tests.b('t1')], 5)$$,
  '42501', null, 'anon: không gọi được');

-- ===========================================================================
-- Task chặn vừa xong: không còn tính
-- ===========================================================================
select tests.logout();
update public.tasks
set status_id = (select id from public.task_statuses
                 where project_id = tests.uid('project_a') and category = 'done'
                 order by position limit 1)
where id = tests.b('b1');
select tests.login_as(tests.uid('pm_a'));
select results_eq($$select ids, n from tests.blockers('t1')$$,
  $$values (array[tests.b('b2')], 1)$$,
  'Task chặn b1 vừa xong: chỉ còn b2');
select is_empty($$select * from tests.blockers('t6')$$,
  'Task chỉ bị b1 chặn: hết bị chặn khi b1 xong');

select * from finish();
rollback;
