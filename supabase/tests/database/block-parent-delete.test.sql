-- QLDA-81: chặn xóa task cha còn việc con (khóa ngoại tasks.parent_id ON DELETE NO ACTION) với mọi
-- vai trò và mọi đường ghi; xóa lá, xóa cha khi hết con, xóa cả cây trong một câu lệnh vẫn được;
-- xóa dự án (dây chuyền) và xóa tài khoản (dây chuyền auth.users → profiles) không bị hỏng.
-- Ánh xạ lỗi sang API 422: tests/integration/block-parent-delete.test.ts.
begin;
\ir _helpers.psql
select tests.seed_fixture();

-- Dữ liệu (dự án A trừ khi ghi khác):
--   p  (…a101, pm_a tạo) ─ c (…a102, member_a tạo) ─ g (…a103, pm_a tạo)   cây 3 cấp
--   m  (…a104, member_a tạo) ─ mc (…a105, member_a tạo)
--   l  (…a106, member_a tạo) lá;  r (…a107, pm_a) ─ rc (…a108, pm_a)   (chuyển con đi rồi xóa)
--   q  (…a109) ─ qc (…a10a) ─ qg (…a10b)                                (xóa cả cây một lệnh)
--   b  (…a201, dự án B, pm_b) ─ bc (…a202) ─ bg (…a203)                  (xóa dự án dây chuyền)
create function tests.k(name text)
returns uuid
language sql
immutable
as $$
  select case name
    when 'p' then '00000000-0000-0000-0000-00000000a101'
    when 'c' then '00000000-0000-0000-0000-00000000a102'
    when 'g' then '00000000-0000-0000-0000-00000000a103'
    when 'm' then '00000000-0000-0000-0000-00000000a104'
    when 'mc' then '00000000-0000-0000-0000-00000000a105'
    when 'l' then '00000000-0000-0000-0000-00000000a106'
    when 'r' then '00000000-0000-0000-0000-00000000a107'
    when 'rc' then '00000000-0000-0000-0000-00000000a108'
    when 'q' then '00000000-0000-0000-0000-00000000a109'
    when 'qc' then '00000000-0000-0000-0000-00000000a10a'
    when 'qg' then '00000000-0000-0000-0000-00000000a10b'
    when 'b' then '00000000-0000-0000-0000-00000000a201'
    when 'bc' then '00000000-0000-0000-0000-00000000a202'
    when 'bg' then '00000000-0000-0000-0000-00000000a203'
  end::uuid;
$$;
grant execute on function tests.k(text) to anon, authenticated, service_role;

create function tests.del_sql(name text)
returns text
language sql
immutable
as $$
  select format('delete from public.tasks where id = %L', tests.k(name));
$$;
grant execute on function tests.del_sql(text) to anon, authenticated, service_role;

-- Đếm task còn lại (đọc với quyền postgres, không phụ thuộc RLS của vai trò đang thử).
create function tests.alive(names text[])
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer from public.tasks t
  where t.id in (select tests.k(n) from unnest(names) n);
$$;
grant execute on function tests.alive(text[]) to anon, authenticated, service_role;
grant usage on schema tests to service_role;
grant execute on function tests.affected_rows(text) to service_role;

insert into public.tasks (id, project_id, title, created_by, assignee_id) values
  (tests.k('p'), tests.uid('project_a'), 'P', tests.uid('pm_a'), null),
  (tests.k('m'), tests.uid('project_a'), 'M', tests.uid('member_a'), null),
  (tests.k('l'), tests.uid('project_a'), 'L', tests.uid('member_a'), null),
  (tests.k('r'), tests.uid('project_a'), 'R', tests.uid('pm_a'), null),
  (tests.k('q'), tests.uid('project_a'), 'Q', tests.uid('pm_a'), null),
  (tests.k('b'), tests.uid('project_b'), 'B', tests.uid('pm_b'), null);
insert into public.tasks (id, project_id, title, created_by, assignee_id, parent_id) values
  (tests.k('c'), tests.uid('project_a'), 'C', tests.uid('member_a'), tests.uid('member_a'), tests.k('p')),
  (tests.k('mc'), tests.uid('project_a'), 'MC', tests.uid('member_a'), null, tests.k('m')),
  (tests.k('rc'), tests.uid('project_a'), 'RC', tests.uid('pm_a'), null, tests.k('r')),
  (tests.k('qc'), tests.uid('project_a'), 'QC', tests.uid('pm_a'), null, tests.k('q')),
  (tests.k('bc'), tests.uid('project_b'), 'BC', tests.uid('pm_b'), null, tests.k('b'));
insert into public.tasks (id, project_id, title, created_by, parent_id) values
  (tests.k('g'), tests.uid('project_a'), 'G', tests.uid('pm_a'), tests.k('c')),
  (tests.k('qg'), tests.uid('project_a'), 'QG', tests.uid('pm_a'), tests.k('qc')),
  (tests.k('bg'), tests.uid('project_b'), 'BG', tests.uid('pm_b'), tests.k('bc'));

select plan(33);

-- ===========================================================================
-- Cấu trúc
-- ===========================================================================
select is(
  (select confdeltype::text from pg_constraint
   where conrelid = 'public.tasks'::regclass and conname = 'tasks_parent_id_fkey'),
  'a',
  'Khóa ngoại tasks.parent_id là ON DELETE NO ACTION (không còn CASCADE)');
select is(
  (select condeferrable from pg_constraint
   where conrelid = 'public.tasks'::regclass and conname = 'tasks_parent_id_fkey'),
  false,
  'Khóa ngoại không hoãn được tới cuối giao dịch (chỉ kiểm cuối câu lệnh)');

-- ===========================================================================
-- Xóa task còn việc con: từ chối với mọi vai trò
-- ===========================================================================
select tests.login_as(tests.uid('pm_a'));
select throws_ok(tests.del_sql('p'), '23503', null, 'PM: xóa task cha còn con, cháu bị từ chối');
select throws_ok(tests.del_sql('c'), '23503', null,
  'PM: xóa task cấp giữa còn việc con (người khác tạo) bị từ chối');

select tests.login_as(tests.uid('admin'));
select throws_ok(tests.del_sql('p'), '23503', null, 'Admin: xóa task cha còn con bị từ chối');

select tests.login_as(tests.uid('member_a'));
select throws_ok(tests.del_sql('m'), '23503', null,
  'Thành viên: xóa task mình tạo còn việc con bị từ chối');
select throws_ok(tests.del_sql('c'), '23503', null,
  'Thành viên: xóa task mình tạo còn việc con do người khác tạo bị từ chối');

-- Vai trò không có quyền xóa: RLS lọc mất dòng (0 dòng), cây còn nguyên.
select tests.login_as(tests.uid('viewer_a'));
select is(tests.affected_rows(tests.del_sql('p')), 0, 'Người xem: không xóa được (RLS)');
select tests.login_as(tests.uid('outsider'));
select is(tests.affected_rows(tests.del_sql('p')), 0, 'Người ngoài: không xóa được (RLS)');
select tests.login_as(tests.uid('locked'));
select is(tests.affected_rows(tests.del_sql('m')), 0, 'Người bị khóa: không xóa được (RLS)');
select tests.login_as(tests.uid('locked_admin'));
select is(tests.affected_rows(tests.del_sql('p')), 0, 'Admin bị khóa: không xóa được (RLS)');
select tests.login_anon();
select throws_ok(tests.del_sql('p'), '42501', null, 'anon: không có quyền xóa task');

-- service_role và postgres bỏ qua RLS nhưng vẫn chịu khóa ngoại.
select tests.logout();
set local role service_role;
select throws_ok(tests.del_sql('p'), '23503', null, 'service_role: xóa task cha còn con bị từ chối');
select throws_ok(tests.del_sql('c'), '23503', null,
  'service_role: xóa task cấp giữa còn con bị từ chối');
reset role;
select tests.logout();
select throws_ok(tests.del_sql('p'), '23503', null, 'postgres: xóa task cha còn con bị từ chối');

select is(tests.alive(array['p', 'c', 'g', 'm', 'mc']), 5, 'Sau mọi lần bị từ chối, các cây còn nguyên');

-- ===========================================================================
-- Đường hợp lệ: xóa lá, xóa dần từ dưới lên, chuyển con đi rồi xóa, xóa cả cây một lệnh
-- ===========================================================================
select tests.login_as(tests.uid('member_a'));
select is(tests.affected_rows(tests.del_sql('l')), 1, 'Thành viên: xóa task lá mình tạo');
select is(tests.affected_rows(tests.del_sql('mc')), 1, 'Thành viên: xóa việc con lá mình tạo');
select is(tests.affected_rows(tests.del_sql('m')), 1, 'Thành viên: xóa task cha khi đã hết con');

select tests.login_as(tests.uid('pm_a'));
select is(tests.affected_rows(tests.del_sql('g')), 1, 'PM: xóa cháu (lá)');
select throws_ok(tests.del_sql('p'), '23503', null, 'PM: cha còn một con (đã hết cháu) vẫn bị từ chối');
select is(tests.affected_rows(tests.del_sql('c')), 1, 'PM: xóa con khi đã hết cháu');
select is(tests.affected_rows(tests.del_sql('p')), 1, 'PM: xóa cha khi đã hết con');

select lives_ok(format('update public.tasks set parent_id = null where id = %L', tests.k('rc')),
  'PM: chuyển việc con ra làm task gốc (E2-4)');
select is(tests.affected_rows(tests.del_sql('r')), 1, 'PM: xóa cha sau khi chuyển hết con đi');
select is(tests.alive(array['rc']), 1, 'Việc con đã chuyển đi không bị xóa');

select is(tests.affected_rows(format('delete from public.tasks where id in (%L, %L, %L)',
  tests.k('q'), tests.k('qc'), tests.k('qg'))), 3,
  'PM: xóa cha cùng toàn bộ hậu duệ trong MỘT câu lệnh được (kiểm cuối câu lệnh)');

-- ===========================================================================
-- Ngoại lệ bắt buộc: xóa dự án và xóa tài khoản
-- ===========================================================================
-- Dữ liệu mới cho phần xóa tài khoản: cây trong dự án A có người tạo/phụ trách là member_a.
select tests.logout();
insert into public.tasks (id, project_id, title, created_by, assignee_id) values
  (tests.k('p'), tests.uid('project_a'), 'P2', tests.uid('member_a'), tests.uid('member_a'));
insert into public.tasks (id, project_id, title, created_by, assignee_id, parent_id) values
  (tests.k('c'), tests.uid('project_a'), 'C2', tests.uid('member_a'), tests.uid('member_a'), tests.k('p'));
insert into public.tasks (id, project_id, title, created_by, parent_id) values
  (tests.k('g'), tests.uid('project_a'), 'G2', tests.uid('member_a'), tests.k('c'));

select lives_ok(format('delete from auth.users where id = %L', tests.uid('member_a')),
  'Xóa tài khoản (auth.users → profiles dây chuyền) vẫn chạy khi người đó tạo/phụ trách cây task');
select is(
  (select count(*)::integer from public.tasks
   where id in (tests.k('p'), tests.k('c'), tests.k('g'))
     and created_by is null and assignee_id is null),
  3,
  'Cây task còn nguyên, người tạo/phụ trách về null (ON DELETE SET NULL)');

select tests.login_as(tests.uid('admin'));
select is(tests.affected_rows(format('delete from public.projects where id = %L', tests.uid('project_b'))), 1,
  'Admin xóa dự án B có cây 3 cấp: dây chuyền vẫn chạy');
select tests.logout();
select is(tests.alive(array['b', 'bc', 'bg']), 0, 'Mọi task của dự án đã xóa đều bị xóa theo');

select lives_ok(format('delete from public.projects where id = %L', tests.uid('project_a')),
  'Xóa dự án A (quyền hệ thống) có cây 3 cấp: dây chuyền vẫn chạy');
select is((select count(*)::integer from public.tasks where project_id = tests.uid('project_a')), 0,
  'Mọi task của dự án A đã bị xóa theo');

select * from finish();
rollback;
