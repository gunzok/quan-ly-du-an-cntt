-- QLDA-39 (Story E1-5): danh mục phòng ban (lưu trữ, tên duy nhất không phân biệt hoa thường,
-- không xóa phòng ban đang có người) và lọc người dùng theo phòng ban trong admin_list_users.
begin;
\ir _helpers.psql
select tests.seed_fixture();

select plan(20);

-- ===========================================================================
-- Cấu trúc
-- ===========================================================================
select has_column('public', 'departments', 'archived_at', 'departments có cột archived_at');
select col_is_null('public', 'departments', 'archived_at', 'archived_at cho phép null (đang dùng)');
select ok(
  (select indisunique from pg_index where indexrelid = 'public.departments_name_ci_key'::regclass),
  'Có chỉ mục duy nhất departments_name_ci_key');

select ok(
  (select prosecdef and proconfig = array['search_path=""'] from pg_proc
    where oid = 'private.department_has_members(uuid)'::regprocedure),
  'private.department_has_members là SECURITY DEFINER với search_path rỗng');
select ok(
  not has_function_privilege('anon', 'private.department_has_members(uuid)', 'execute'),
  'anon không gọi được private.department_has_members');

-- ===========================================================================
-- Tên duy nhất không phân biệt hoa thường, khoảng trắng hai đầu
-- ===========================================================================
select tests.login_as(tests.uid('admin'));
select throws_ok($$insert into public.departments (name) values ('phòng thử 1')$$, '23505', null,
  'Trùng tên khác hoa thường bị từ chối');
select throws_ok($$insert into public.departments (name) values ('  PHÒNG THỬ 1 ')$$, '23505', null,
  'Trùng tên sau khi cắt khoảng trắng bị từ chối');
select lives_ok($$insert into public.departments (id, name, position)
  values ('00000000-0000-0000-0000-00000000de02', 'Phòng Thử 2', 2)$$,
  'Tên khác thì thêm được');
select throws_ok($$update public.departments set name = 'PHÒNG THỬ 2' where id = tests.uid('dept_1')$$,
  '23505', null, 'Đổi tên trùng (khác hoa thường) với phòng khác bị từ chối');
select is(tests.affected_rows($$update public.departments set name = 'PHÒNG THỬ 1' where id = tests.uid('dept_1')$$), 1,
  'Đổi hoa thường tên của chính mình được');

-- ===========================================================================
-- Lưu trữ và xóa
-- ===========================================================================
select tests.logout();
update public.profiles set department_id = tests.uid('dept_1') where id = tests.uid('member_a');

select tests.login_as(tests.uid('admin'));
select is(tests.affected_rows($$update public.departments set archived_at = now() where id = tests.uid('dept_1')$$), 1,
  'Admin lưu trữ được phòng ban');
select is(tests.affected_rows($$delete from public.departments where id = tests.uid('dept_1')$$), 0,
  'Admin không xóa được phòng ban còn người (RLS)');
select is(tests.affected_rows($$delete from public.departments where id = '00000000-0000-0000-0000-00000000de02'$$), 1,
  'Admin xóa được phòng ban không còn ai');

select tests.login_as(tests.uid('member_a'));
select is(tests.affected_rows($$update public.departments set archived_at = null where id = tests.uid('dept_1')$$), 0,
  'Người dùng thường không dùng lại được phòng ban đã lưu trữ');
select is((select count(*)::int from public.departments where archived_at is not null), 1,
  'Người dùng đang hoạt động vẫn đọc được phòng ban đã lưu trữ (để hiển thị tên)');
select tests.logout();

-- ===========================================================================
-- admin_update_user và phòng ban đã lưu trữ
-- ===========================================================================
select throws_ok(
  $$ select public.admin_update_user(tests.uid('admin'), tests.uid('pm_a'),
       p_set_department => true, p_department_id => tests.uid('dept_1')) $$,
  'P0001', 'department_archived',
  'Không gán mới được phòng ban đã lưu trữ');
select is(
  (select department_id from public.admin_update_user(tests.uid('admin'), tests.uid('member_a'),
     p_set_department => true, p_department_id => tests.uid('dept_1'))),
  tests.uid('dept_1'),
  'Người đang thuộc phòng ban đã lưu trữ thì giữ nguyên được');

-- ===========================================================================
-- admin_list_users: lọc theo phòng ban
-- ===========================================================================
select is(
  (select array_agg(email order by email) from public.admin_list_users(p_department_id => tests.uid('dept_1')))::text[],
  array['member_a@test.example'],
  'Lọc theo phòng ban chỉ trả người thuộc phòng ban đó');
select is(
  (select count(*)::int from public.admin_list_users(p_without_department => true)),
  7,
  'Lọc người chưa có phòng ban (7 trên 8 người fixture)');
select is(
  (select count(*)::int from public.admin_list_users(p_without_department => true,
     p_department_id => tests.uid('dept_1'))),
  7,
  'p_without_department được ưu tiên hơn p_department_id');

select * from finish();
rollback;
