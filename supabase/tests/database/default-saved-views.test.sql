-- QLDA-54 (Story E13-2): 7 chế độ xem mặc định dùng chung (migration
-- 20261115290000_default_saved_views.sql). Kiểm: seed đủ 7 với id cố định, hình dạng mặc định, query
-- hợp lệ; bộ lọc mới của hàm kiểm (me, created_by, open, overdue) nhận/từ chối đúng; mọi vai trò đang
-- hoạt động đọc được, người bị khóa và anon không; không ai sửa, xóa được (RLS cho authenticated,
-- trigger cho service_role và postgres); chỉ phiên hệ thống đặt GUC mới sửa được; mặc định theo dự
-- án vẫn bị xóa dây chuyền theo dự án; yêu thích chế độ xem mặc định theo từng người.
begin;
\ir _helpers.psql

select plan(52);

select tests.seed_fixture();

create function tests.defaults_seen()
returns integer language sql stable as $$
  select count(*)::int from public.saved_views
  where is_default and project_id is null and id::text like '7e0d0000-0000-4000-8000-00000000000_';
$$;
create function tests.q(filters jsonb)
returns jsonb language sql immutable as $$
  select jsonb_build_object('version', 1, 'filters', filters, 'sort', '[]'::jsonb,
    'group_by', null, 'columns', '["title"]'::jsonb, 'display', 'list');
$$;
grant execute on all functions in schema tests to anon, authenticated;

-- ===========================================================================
-- Seed
-- ===========================================================================
select is(tests.defaults_seen(), 7, 'Đủ 7 chế độ xem mặc định dùng chung');
select results_eq(
  $$select name from public.saved_views
    where id::text like '7e0d0000-0000-4000-8000-00000000000_' order by id$$,
  $$values ('Tất cả đang mở'), ('Hoạt động gần nhất'), ('Mới tạo'), ('Quá hạn'), ('Tóm tắt'),
           ('Tạo bởi tôi'), ('Giao cho tôi')$$,
  'Tên và thứ tự theo OpenProject');
select is(
  (select count(*)::int from public.saved_views
   where id::text like '7e0d0000-0000-4000-8000-00000000000_'
     and is_default and owner_id is null and project_id is null and visibility = 'public'),
  7, 'Mặc định: không chủ sở hữu, không thuộc dự án, công khai');
select ok(
  (select bool_and(private.saved_view_query_is_valid(query)) from public.saved_views
   where id::text like '7e0d0000-0000-4000-8000-00000000000_'),
  'Query của 7 mặc định hợp lệ');
select is(
  (select query -> 'filters' from public.saved_views where id = '7e0d0000-0000-4000-8000-000000000007'),
  '{"open": true, "assignee_id": "me"}'::jsonb, 'Giao cho tôi: chưa hoàn thành, người phụ trách là tôi');
select is(
  (select query -> 'filters' from public.saved_views where id = '7e0d0000-0000-4000-8000-000000000004'),
  '{"overdue": true}'::jsonb, 'Quá hạn: bộ lọc overdue');

-- ===========================================================================
-- Hàm kiểm: bộ lọc mới (tương thích ngược)
-- ===========================================================================
select ok(private.saved_view_query_is_valid(tests.q('{"assignee_id":"me","created_by":"me"}')),
  'assignee_id, created_by nhận me');
select ok(private.saved_view_query_is_valid(
  tests.q('{"created_by":"00000000-0000-0000-0000-0000000000b1"}')), 'created_by nhận uuid');
select ok(private.saved_view_query_is_valid(tests.q('{"open":true,"overdue":true}')),
  'open, overdue nhận true');
select ok(private.saved_view_query_is_valid(
  tests.q('{"assignee_id":"00000000-0000-0000-0000-0000000000b1","label_id":"00000000-0000-0000-0000-0000000000b1"}')),
  'Bộ lọc cũ vẫn hợp lệ');
select ok(not private.saved_view_query_is_valid(tests.q('{"open":false}')), 'open false bị từ chối');
select ok(not private.saved_view_query_is_valid(tests.q('{"overdue":"true"}')), 'overdue dạng chuỗi bị từ chối');
select ok(not private.saved_view_query_is_valid(tests.q('{"assignee_id":"Me"}')), 'Me (hoa) bị từ chối');
select ok(not private.saved_view_query_is_valid(tests.q('{"created_by":"abc"}')), 'created_by sai bị từ chối');
select ok(not private.saved_view_query_is_valid(tests.q('{"label_id":"me"}')), 'label_id không nhận me');
select ok(not private.saved_view_query_is_valid(tests.q('{"closed":true}')), 'Bộ lọc lạ vẫn bị từ chối');

-- ===========================================================================
-- Quyền hàm, trigger
-- ===========================================================================
select ok(
  (select prosecdef and proconfig = array['search_path=""'] from pg_proc
   where oid = 'private.guard_default_saved_views()'::regprocedure),
  'Trigger function SECURITY DEFINER, search_path rỗng');
select ok(not has_function_privilege('authenticated', 'private.guard_default_saved_views()', 'execute'),
  'authenticated không gọi trực tiếp trigger function');
select ok(not has_function_privilege('anon', 'private.saved_view_query_is_valid(jsonb)', 'execute'),
  'anon không gọi hàm kiểm');

-- ===========================================================================
-- Đọc: mọi người đang hoạt động (dùng chung, không phụ thuộc dự án); bị khóa, anon không
-- ===========================================================================
select tests.login_as(tests.uid('pm_a'));
select is(tests.defaults_seen(), 7, 'PM thấy 7 mặc định');
select tests.login_as(tests.uid('member_a'));
select is(tests.defaults_seen(), 7, 'Thành viên thấy 7 mặc định');
select tests.login_as(tests.uid('viewer_a'));
select is(tests.defaults_seen(), 7, 'Người xem thấy 7 mặc định');
select tests.login_as(tests.uid('admin'));
select is(tests.defaults_seen(), 7, 'Admin thấy 7 mặc định');
select tests.login_as(tests.uid('outsider'));
select is(tests.defaults_seen(), 7, 'Người chưa thuộc dự án nào vẫn thấy mẫu dùng chung');
select tests.login_as(tests.uid('locked'));
select is(tests.defaults_seen(), 0, 'Người bị khóa không thấy');
select tests.login_as(tests.uid('locked_admin'));
select is(tests.defaults_seen(), 0, 'Admin bị khóa không thấy');
select tests.login_anon();
select throws_ok('select count(*) from public.saved_views', '42501', null, 'anon không đọc');
select tests.logout();

-- ===========================================================================
-- Sửa, xóa qua API (authenticated): RLS loại dòng mặc định → 0 dòng
-- ===========================================================================
select tests.login_as(tests.uid('pm_a'));
select is(tests.affected_rows(
  $$update public.saved_views set name = 'Đổi' where id = '7e0d0000-0000-4000-8000-000000000001'$$),
  0, 'PM không sửa được mặc định');
select is(tests.affected_rows(
  $$delete from public.saved_views where id = '7e0d0000-0000-4000-8000-000000000001'$$),
  0, 'PM không xóa được mặc định');
select tests.login_as(tests.uid('admin'));
select is(tests.affected_rows(
  $$update public.saved_views set query = query where is_default$$),
  0, 'Admin không sửa được mặc định');
select is(tests.affected_rows($$delete from public.saved_views where is_default$$),
  0, 'Admin không xóa được mặc định');
select tests.login_as(tests.uid('member_a'));
select is(tests.affected_rows(
  $$update public.saved_views set visibility = 'private' where is_default$$),
  0, 'Thành viên không sửa được mặc định');
select tests.login_as(tests.uid('viewer_a'));
select is(tests.affected_rows($$delete from public.saved_views where is_default$$),
  0, 'Người xem không xóa được mặc định');
select tests.login_as(tests.uid('outsider'));
select is(tests.affected_rows($$delete from public.saved_views where is_default$$),
  0, 'Người ngoài không xóa được mặc định');
select tests.login_as(tests.uid('locked'));
select is(tests.affected_rows($$update public.saved_views set name = 'x' where is_default$$),
  0, 'Người bị khóa không sửa được mặc định');
select tests.login_anon();
select throws_ok($$delete from public.saved_views where is_default$$, '42501', null,
  'anon không xóa');
select tests.logout();

-- ===========================================================================
-- service_role và postgres: trigger chặn (kể cả khi bỏ qua RLS)
-- ===========================================================================
set local role service_role;
select throws_ok(
  $$update public.saved_views set name = 'Đổi tên' where id = '7e0d0000-0000-4000-8000-000000000002'$$,
  'P0001', 'saved_view_default_immutable', 'service_role không đổi tên mặc định');
select throws_ok(
  $$update public.saved_views set query = '{"version":1,"filters":{},"sort":[],"group_by":null,"columns":["title"],"display":"list"}'
    where id = '7e0d0000-0000-4000-8000-000000000002'$$,
  'P0001', 'saved_view_default_immutable', 'service_role không đổi query mặc định');
select throws_ok(
  $$delete from public.saved_views where id = '7e0d0000-0000-4000-8000-000000000003'$$,
  'P0001', 'saved_view_default_immutable', 'service_role không xóa mặc định');
reset role;
select throws_ok(
  $$delete from public.saved_views where is_default and project_id is null$$,
  'P0001', 'saved_view_default_immutable', 'postgres không có GUC cũng không xóa được');
select is(tests.defaults_seen(), 7, 'Vẫn đủ 7 sau các lần thử');

-- Phiên hệ thống (migration sau này) đặt GUC thì sửa được; trả GUC về off.
set local app.saved_views_system_write = 'on';
select lives_ok(
  $$update public.saved_views set name = 'Tất cả đang mở' where id = '7e0d0000-0000-4000-8000-000000000001'$$,
  'Phiên hệ thống (GUC on) sửa được');
set local app.saved_views_system_write = 'off';
select throws_ok(
  $$update public.saved_views set name = 'x' where id = '7e0d0000-0000-4000-8000-000000000001'$$,
  'P0001', 'saved_view_default_immutable', 'GUC off thì chặn lại');

-- Mặc định THEO DỰ ÁN không bị trigger chặn: xóa dự án vẫn xóa dây chuyền.
insert into public.saved_views (project_id, owner_id, name, query, visibility, is_default)
values (tests.uid('project_b'), null, 'Mặc định B', tests.q('{}'), 'public', true);
select lives_ok(format('delete from public.projects where id = %L', tests.uid('project_b')),
  'Xóa dự án xóa theo mặc định của dự án');
select is((select count(*)::int from public.saved_views where name = 'Mặc định B'), 0,
  'Mặc định của dự án đã bị xóa theo');

-- ===========================================================================
-- Yêu thích chế độ xem mặc định: của từng người
-- ===========================================================================
select tests.login_as(tests.uid('viewer_a'));
select lives_ok(
  $$insert into public.saved_view_favorites (view_id) values ('7e0d0000-0000-4000-8000-000000000007')$$,
  'Người xem đánh dấu yêu thích mặc định');
select is((select count(*)::int from public.saved_view_favorites), 1, 'Người xem thấy dấu của mình');
select tests.login_as(tests.uid('outsider'));
select lives_ok(
  $$insert into public.saved_view_favorites (view_id) values ('7e0d0000-0000-4000-8000-000000000007')$$,
  'Người khác đánh dấu cùng chế độ xem');
select is((select count(*)::int from public.saved_view_favorites), 1, 'Mỗi người chỉ thấy dấu của mình');
select tests.login_as(tests.uid('locked'));
select throws_ok(
  $$insert into public.saved_view_favorites (view_id) values ('7e0d0000-0000-4000-8000-000000000001')$$,
  '42501', null, 'Người bị khóa không đánh dấu');

-- ===========================================================================
-- Chế độ xem của người dùng dùng được bộ lọc mới (qua chính sách sẵn có)
-- ===========================================================================
select tests.login_as(tests.uid('member_a'));
select lives_ok(format(
  'insert into public.saved_views (project_id, name, query) values (%L, %L, %L)',
  tests.uid('project_a'), 'Việc của tôi quá hạn', tests.q('{"assignee_id":"me","overdue":true}')),
  'Thành viên lưu chế độ xem riêng có me, overdue');
select throws_ok(format(
  'insert into public.saved_views (project_id, name, query) values (%L, %L, %L)',
  tests.uid('project_a'), 'Sai', tests.q('{"open":false}')),
  '23514', null, 'CHECK chặn open false');
select tests.logout();

select * from finish();
rollback;
