-- QLDA-37 (Story E2-1): hàm public.project_stats(), ràng buộc độ dài mô tả và chỉ mục danh sách
-- dự án (migration 20261115090000_project_list.sql). Hàm là SECURITY INVOKER nên phạm vi đúng
-- bằng RLS: mỗi vai trò có ca thấy và ca không thấy (test-strategy.md mục 2, NFR-06).
begin;
\ir _helpers.psql
select tests.seed_fixture();

-- Dự án A: 4 thành viên (pm_a PM, member_a, viewer_a, locked). Task của A, "hôm nay" = 2030-06-15:
--   đã xong (hạn đã qua) | trễ hạn | hạn đúng hôm nay | không có hạn  → tiến độ 1/4, trễ hạn 1.
-- Dự án B: 2 thành viên (pm_b PM, pm_a Người xem), 1 task trễ hạn.
insert into public.tasks (project_id, title, created_by, due_date, completed_at) values
  (tests.uid('project_a'), 'Đã xong', tests.uid('pm_a'), '2030-06-01', '2030-06-02T00:00:00Z'),
  (tests.uid('project_a'), 'Trễ hạn', tests.uid('pm_a'), '2030-06-14', null),
  (tests.uid('project_a'), 'Hạn hôm nay', tests.uid('pm_a'), '2030-06-15', null),
  (tests.uid('project_a'), 'Không hạn', tests.uid('pm_a'), null, null),
  (tests.uid('project_b'), 'Trễ hạn B', tests.uid('pm_b'), '2030-01-01', null);

select plan(27);

-- ===========================================================================
-- Cấu trúc và quyền
-- ===========================================================================
select has_function('public', 'project_stats', array['uuid[]', 'date'], 'Có hàm public.project_stats(uuid[], date)');
select is((select prosecdef from pg_proc where oid = 'public.project_stats(uuid[], date)'::regprocedure),
  false, 'project_stats là SECURITY INVOKER (RLS áp dụng)');
select has_index('public', 'projects', 'projects_status_created_idx', 'Chỉ mục danh sách dự án theo trạng thái');
select ok(has_function_privilege('authenticated', 'public.project_stats(uuid[], date)', 'execute'),
  'authenticated gọi được project_stats');
select ok(not has_function_privilege('anon', 'public.project_stats(uuid[], date)', 'execute'),
  'anon không gọi được project_stats');

select throws_ok(
  $$insert into public.projects (name, description) values ('Mô tả dài', repeat('x', 5001))$$,
  '23514', null, 'Mô tả dự án quá 5000 ký tự bị từ chối (projects_description_length)');
select lives_ok(
  $$insert into public.projects (name, description) values ('Mô tả vừa', repeat('x', 5000))$$,
  'Mô tả dự án đúng 5000 ký tự được chấp nhận');
delete from public.projects where name in ('Mô tả dài', 'Mô tả vừa');

-- ===========================================================================
-- Số liệu
-- ===========================================================================
select tests.login_as(tests.uid('member_a'));
select results_eq(
  $$select member_count, task_count, done_task_count, overdue_task_count, my_role::text
    from public.project_stats(array[tests.uid('project_a')], '2030-06-15')$$,
  $$values (4, 4, 1, 1, 'member')$$,
  'Thành viên A: 4 thành viên, 4 task, 1 xong, 1 trễ hạn (hạn hôm nay chưa tính là trễ)');
select results_eq(
  $$select overdue_task_count from public.project_stats(array[tests.uid('project_a')], '2030-06-16')$$,
  $$values (2)$$,
  'Sang ngày hôm sau: task hạn hôm qua thành trễ hạn');
select is_empty(
  $$select * from public.project_stats(array[tests.uid('project_b')], '2030-06-15')$$,
  'Thành viên A không nhận số liệu của dự án B (BR-10)');
select is(
  (select jsonb_array_length(members_preview) from public.project_stats(array[tests.uid('project_a')])),
  3, 'members_preview tối đa 3 người');
select is(
  (select members_preview -> 0 ->> 'id' from public.project_stats(array[tests.uid('project_a')])),
  tests.uid('pm_a')::text, 'members_preview: PM đứng đầu');
select is(
  (select members_preview -> 0 ? 'email' from public.project_stats(array[tests.uid('project_a')])),
  false, 'members_preview không có email');
select isnt_empty(
  $$select * from public.project_stats(array[tests.uid('project_a')])$$,
  'p_today null: dùng ngày hiện tại theo giờ Việt Nam, vẫn trả số liệu');

select tests.login_as(tests.uid('viewer_a'));
select results_eq(
  $$select my_role::text from public.project_stats(array[tests.uid('project_a')])$$,
  $$values ('viewer')$$, 'Người xem A nhận số liệu A với vai trò viewer');

select tests.login_as(tests.uid('pm_a'));
select results_eq(
  $$select project_id, my_role::text, member_count, overdue_task_count
    from public.project_stats(array[tests.uid('project_a'), tests.uid('project_b')], '2030-06-15')
    order by project_id$$,
  $$values (tests.uid('project_a'), 'pm', 4, 1), (tests.uid('project_b'), 'viewer', 2, 1)$$,
  'pm_a: PM ở A, Người xem ở B, số liệu cả hai dự án');

select tests.login_as(tests.uid('admin'));
select results_eq(
  $$select project_id, my_role is null, task_count
    from public.project_stats(array[tests.uid('project_a'), tests.uid('project_b')], '2030-06-15')
    order by project_id$$,
  $$values (tests.uid('project_a'), true, 4), (tests.uid('project_b'), true, 1)$$,
  'Admin không thuộc dự án nhận số liệu mọi dự án, my_role null');

select tests.login_as(tests.uid('outsider'));
select is_empty(
  $$select * from public.project_stats(array[tests.uid('project_a'), tests.uid('project_b')])$$,
  'Người ngoài dự án không nhận dòng nào');

select tests.login_as(tests.uid('locked'));
select is_empty(
  $$select * from public.project_stats(array[tests.uid('project_a')])$$,
  'Người bị khóa (thành viên A) không nhận dòng nào');

select tests.login_as(tests.uid('locked_admin'));
select is_empty(
  $$select * from public.project_stats(array[tests.uid('project_a'), tests.uid('project_b')])$$,
  'Admin bị khóa không nhận dòng nào');

select tests.login_as(tests.uid('member_a'));
select is_empty($$select * from public.project_stats(array[]::uuid[])$$, 'Mảng rỗng: không dòng nào');
select is_empty($$select * from public.project_stats(null)$$, 'null: không dòng nào');
select throws_ok(
  $$select * from public.project_stats(array(select gen_random_uuid() from generate_series(1, 101)))$$,
  '22023', 'too_many_projects', 'Quá 100 dự án một lần bị từ chối');
select lives_ok(
  $$select * from public.project_stats(array(select gen_random_uuid() from generate_series(1, 100)))$$,
  'Đúng 100 dự án được chấp nhận');

select tests.login_anon();
select throws_ok(
  $$select * from public.project_stats(array[tests.uid('project_a')])$$,
  '42501', null, 'anon không gọi được project_stats');

-- ===========================================================================
-- create_project (đã có từ QLDA-32): kiểm lại quyết định "Admin và PM của ít nhất một dự án"
-- ===========================================================================
select tests.login_as(tests.uid('member_a'));
select throws_ok(
  $$select public.create_project('Thành viên tạo')$$,
  '42501', null, 'Thành viên (không là PM ở đâu) không tạo được dự án');

select tests.login_as(tests.uid('pm_b'));
-- Hai câu lệnh riêng: cùng một câu lệnh thì không thấy dòng trigger vừa thêm (cùng snapshot).
select set_config('tests.new_project', (public.create_project('PM B tạo')).id::text, true);
select is(
  (select m.role::text from public.project_members m
   where m.project_id = current_setting('tests.new_project')::uuid
     and m.user_id = tests.uid('pm_b')),
  'pm', 'PM của một dự án tạo được dự án mới và thành PM của dự án đó (AC1)');

select * from finish();
rollback;
