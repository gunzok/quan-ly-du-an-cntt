-- QLDA-53 (Story E13-1): chế độ xem đã lưu (migration 20261115210000_saved_views.sql). Mỗi chính
-- sách có ca được phép và bị từ chối cho PM, Thành viên, Người xem, Admin, người ngoài, người bị
-- khóa, Admin bị khóa, anon; quyền cột; ràng buộc tên, hình dạng query; trigger không đổi dự án,
-- chủ sở hữu; chế độ xem mặc định chỉ đọc; yêu thích của riêng từng người; xóa dự án xóa theo.
begin;
\ir _helpers.psql

select plan(105);

select tests.seed_fixture();
-- Cô lập: mẫu mặc định dùng chung (project_id null) không bị seed_fixture xóa theo dự án.
delete from public.saved_views;

-- Tra id bỏ qua RLS (SECURITY DEFINER): tên chế độ xem trong test là duy nhất.
create function tests.v(view_name text)
returns uuid language sql stable security definer set search_path = public as $$
  select id from public.saved_views where name = view_name;
$$;
create function tests.q()
returns jsonb language sql immutable as $$
  select '{"version":1,"filters":{},"sort":[],"group_by":null,"columns":["title"],"display":"list"}'::jsonb;
$$;
create function tests.ins(project text, view_name text, vis text, query jsonb default null)
returns text language sql stable as $$
  select format(
    'insert into public.saved_views (project_id, name, query, visibility) values (%L, %L, %L, %L)',
    tests.uid(project), view_name, coalesce(query, tests.q()), vis);
$$;
create function tests.upd(view_name text, setting text)
returns text language sql stable as $$
  select format('update public.saved_views set %s where id = %L', setting, tests.v(view_name));
$$;
create function tests.del(view_name text)
returns text language sql stable as $$
  select format('delete from public.saved_views where id = %L', tests.v(view_name));
$$;
create function tests.fav(view_name text)
returns text language sql stable as $$
  select format('insert into public.saved_view_favorites (view_id) values (%L)', tests.v(view_name));
$$;
create function tests.names()
returns setof text language sql stable as $$
  select name from public.saved_views;
$$;
grant execute on all functions in schema tests to anon, authenticated;

-- ===========================================================================
-- Cấu trúc, quyền bảng và quyền cột
-- ===========================================================================
select has_table('public', 'saved_views', 'Có bảng saved_views');
select has_table('public', 'saved_view_favorites', 'Có bảng saved_view_favorites');
select is(
  (select count(*)::int from pg_class
   where oid in ('public.saved_views'::regclass, 'public.saved_view_favorites'::regclass)
     and relrowsecurity),
  2, 'RLS bật trên cả hai bảng');
select ok(not has_table_privilege('anon', 'public.saved_views', 'select'),
  'anon không có quyền đọc saved_views');
select ok(not has_table_privilege('anon', 'public.saved_view_favorites', 'select'),
  'anon không có quyền đọc saved_view_favorites');
select ok(not has_column_privilege('authenticated', 'public.saved_views', 'owner_id', 'insert'),
  'Trình duyệt không tự đặt owner_id (mặc định auth.uid())');
select ok(not has_column_privilege('authenticated', 'public.saved_views', 'is_default', 'insert'),
  'Trình duyệt không tạo chế độ xem mặc định');
select ok(not has_column_privilege('authenticated', 'public.saved_views', 'project_id', 'update'),
  'Không có quyền cột đổi project_id');
select ok(not has_column_privilege('authenticated', 'public.saved_views', 'owner_id', 'update'),
  'Không có quyền cột đổi owner_id');
select ok(not has_column_privilege('authenticated', 'public.saved_views', 'is_default', 'update'),
  'Không có quyền cột đổi is_default');
select ok(not has_column_privilege('authenticated', 'public.saved_view_favorites', 'user_id', 'insert'),
  'Không đánh dấu yêu thích thay người khác (không có quyền cột user_id)');
select has_index('public', 'saved_views', 'saved_views_project_owner_name_ci_key',
  'Chỉ mục duy nhất (project_id, owner_id, lower(btrim(name)))');
select ok(not has_function_privilege('authenticated', 'private.guard_saved_view_identity()', 'execute'),
  'Trình duyệt không gọi được hàm trigger');
select ok(has_function_privilege('service_role', 'private.saved_view_query_is_valid(jsonb)', 'execute'),
  'service_role chạy được hàm kiểm query (seed chế độ xem mặc định, E13-2)');

-- ===========================================================================
-- INSERT
-- ===========================================================================
select tests.login_as(tests.uid('member_a'));
select lives_ok(tests.ins('project_a', 'm-private', 'private'), 'Thành viên tạo chế độ xem riêng (AC1)');
select throws_ok(tests.ins('project_a', 'm-public', 'public'), '42501', null,
  'Thành viên không tạo chế độ xem công khai');
select tests.login_as(tests.uid('viewer_a'));
select lives_ok(tests.ins('project_a', 'v-private', 'private'), 'Người xem tạo chế độ xem riêng');
select throws_ok(tests.ins('project_a', 'v-public', 'public'), '42501', null,
  'Người xem không tạo chế độ xem công khai');
select tests.login_as(tests.uid('pm_a'));
select lives_ok(tests.ins('project_a', 'pm-public', 'public'), 'PM tạo chế độ xem công khai');
select lives_ok(tests.ins('project_a', 'pm-private', 'private'), 'PM tạo chế độ xem riêng');
select throws_ok(tests.ins('project_b', 'pm-b-public', 'public'), '42501', null,
  'Vai trò theo dự án: PM A là Người xem ở B, không tạo công khai ở B');
select lives_ok(tests.ins('project_b', 'pm-b-private', 'private'), 'PM A tạo chế độ xem riêng ở B (Người xem)');
select tests.login_as(tests.uid('admin'));
select lives_ok(tests.ins('project_a', 'admin-public', 'public'), 'Admin (không là thành viên) tạo công khai');
select lives_ok(tests.ins('project_a', 'admin-private', 'private'), 'Admin tạo chế độ xem riêng');
select tests.login_as(tests.uid('outsider'));
select throws_ok(tests.ins('project_a', 'o-private', 'private'), '42501', null,
  'Người ngoài dự án không tạo');
select tests.login_as(tests.uid('locked'));
select throws_ok(tests.ins('project_a', 'l-private', 'private'), '42501', null,
  'Người bị khóa không tạo');
select tests.login_as(tests.uid('locked_admin'));
select throws_ok(tests.ins('project_a', 'la-public', 'public'), '42501', null,
  'Admin bị khóa không tạo');
select tests.login_as(tests.uid('member_a'));
select throws_ok(format(
  'insert into public.saved_views (project_id, name, query, visibility, is_default) values (%L, ''x'', %L, ''public'', true)',
  tests.uid('project_a'), tests.q()), '42501', null, 'Không tự đặt is_default');
select throws_ok(format(
  'insert into public.saved_views (project_id, owner_id, name, query) values (%L, %L, ''x'', %L)',
  tests.uid('project_a'), tests.uid('viewer_a'), tests.q()), '42501', null, 'Không tạo thay người khác');
select tests.login_anon();
select throws_ok(tests.ins('project_a', 'anon', 'private'), '42501', null, 'anon không tạo');
select tests.logout();
select is((select owner_id from public.saved_views where name = 'm-private'), tests.uid('member_a'),
  'owner_id mặc định là người tạo');

-- Chế độ xem mặc định do hệ thống tạo (seed E13-2).
select lives_ok(format(
  $$insert into public.saved_views (project_id, owner_id, name, query, visibility, is_default) values
    (%L, null, 'Mặc định A', %L, 'public', true), (null, null, 'Mặc định chung', %L, 'public', true)$$,
  tests.uid('project_a'), tests.q(), tests.q()), 'Hệ thống tạo chế độ xem mặc định (theo dự án, dùng chung)');
select throws_ok(format(
  $$insert into public.saved_views (project_id, owner_id, name, query, visibility, is_default)
    values (%L, %L, 'x', %L, 'public', true)$$, tests.uid('project_a'), tests.uid('pm_a'), tests.q()),
  '23514', null, 'Mặc định không có chủ sở hữu');
select throws_ok(format(
  $$insert into public.saved_views (project_id, owner_id, name, query) values (null, %L, 'x', %L)$$,
  tests.uid('pm_a'), tests.q()),
  '23514', null, 'Chế độ xem của người dùng phải thuộc một dự án');

-- ===========================================================================
-- SELECT
-- ===========================================================================
select tests.login_as(tests.uid('member_a'));
select set_eq('select * from tests.names()',
  array['m-private', 'pm-public', 'admin-public', 'Mặc định A', 'Mặc định chung'],
  'Thành viên: riêng của mình, công khai, mặc định; không thấy riêng của người khác');
select tests.login_as(tests.uid('viewer_a'));
select set_eq('select * from tests.names()',
  array['v-private', 'pm-public', 'admin-public', 'Mặc định A', 'Mặc định chung'],
  'Người xem: riêng của mình, công khai, mặc định');
select tests.login_as(tests.uid('pm_a'));
select set_eq('select * from tests.names()',
  array['pm-public', 'pm-private', 'pm-b-private', 'admin-public', 'Mặc định A', 'Mặc định chung'],
  'PM: không đọc chế độ xem riêng của thành viên');
select tests.login_as(tests.uid('admin'));
select set_eq('select * from tests.names()',
  array['pm-public', 'admin-public', 'admin-private', 'Mặc định A', 'Mặc định chung'],
  'Admin: không đọc chế độ xem riêng của người khác');
select tests.login_as(tests.uid('pm_b'));
select set_eq('select * from tests.names()', array['Mặc định chung'],
  'PM dự án khác: không thấy gì của dự án A (kể cả riêng của PM A ở B)');
select tests.login_as(tests.uid('outsider'));
select set_eq('select * from tests.names()', array['Mặc định chung'],
  'Người ngoài: chỉ mẫu mặc định dùng chung');
select tests.login_as(tests.uid('locked'));
select is_empty('select * from tests.names()', 'Người bị khóa không thấy gì');
select tests.login_as(tests.uid('locked_admin'));
select is_empty('select * from tests.names()', 'Admin bị khóa không thấy gì');
select tests.login_anon();
select throws_ok('select * from public.saved_views', '42501', null, 'anon không đọc');

-- ===========================================================================
-- UPDATE
-- ===========================================================================
select tests.login_as(tests.uid('member_a'));
select is(tests.affected_rows(tests.upd('m-private', $$query = query$$)), 1,
  'Thành viên sửa chế độ xem riêng của mình');
select is(tests.affected_rows(tests.upd('pm-public', $$query = query$$)), 0,
  'Thành viên không sửa chế độ xem công khai');
select throws_ok(tests.upd('m-private', $$visibility = 'public'$$), '42501', null,
  'Thành viên không tự công khai chế độ xem của mình');
select throws_ok(tests.upd('m-private', format('project_id = %L', tests.uid('project_b'))), '42501', null,
  'Không đổi project_id (quyền cột)');
select throws_ok(tests.upd('m-private', format('owner_id = %L', tests.uid('viewer_a'))), '42501', null,
  'Không đổi owner_id (quyền cột)');
select tests.login_as(tests.uid('viewer_a'));
select is(tests.affected_rows(tests.upd('m-private', $$query = query$$)), 0,
  'Người xem không sửa chế độ xem riêng của người khác');
select tests.login_as(tests.uid('pm_a'));
select is(tests.affected_rows(tests.upd('admin-public', $$query = query$$)), 1,
  'PM sửa chế độ xem công khai của người khác trong dự án');
select is(tests.affected_rows(tests.upd('m-private', $$query = query$$)), 0,
  'PM không sửa chế độ xem riêng của thành viên');
select throws_ok(tests.upd('admin-public', $$visibility = 'private'$$), '42501', null,
  'PM không biến chế độ xem công khai của người khác thành riêng tư');
select is(tests.affected_rows(tests.upd('pm-public', $$visibility = 'private'$$)), 1,
  'PM chuyển chế độ xem công khai của mình về riêng tư');
select is(tests.affected_rows(tests.upd('pm-public', $$visibility = 'public'$$)), 1,
  'PM công khai lại chế độ xem của mình');
select is(tests.affected_rows(tests.upd('Mặc định A', $$name = 'đổi'$$)), 0,
  'PM không sửa chế độ xem mặc định');
select tests.login_as(tests.uid('admin'));
select is(tests.affected_rows(tests.upd('pm-public', $$query = query$$)), 1,
  'Admin sửa chế độ xem công khai');
select is(tests.affected_rows(tests.upd('m-private', $$query = query$$)), 0,
  'Admin không sửa chế độ xem riêng của người khác');
select is(tests.affected_rows(tests.upd('Mặc định A', $$name = 'đổi'$$)), 0,
  'Admin không sửa chế độ xem mặc định');
select is(tests.affected_rows(tests.upd('Mặc định chung', $$name = 'đổi'$$)), 0,
  'Admin không sửa chế độ xem mặc định dùng chung');
select tests.login_as(tests.uid('outsider'));
select is(tests.affected_rows(tests.upd('pm-public', $$query = query$$)), 0, 'Người ngoài không sửa');
select tests.login_as(tests.uid('locked_admin'));
select is(tests.affected_rows(tests.upd('pm-public', $$query = query$$)), 0, 'Admin bị khóa không sửa');
select tests.logout();
select throws_ok(tests.upd('m-private', format('owner_id = %L', tests.uid('viewer_a'))),
  'P0001', 'saved_view_identity_immutable', 'Trigger: owner_id không đổi kể cả với quyền hệ thống');
select throws_ok(tests.upd('m-private', format('project_id = %L', tests.uid('project_b'))),
  'P0001', 'saved_view_identity_immutable', 'Trigger: project_id không đổi kể cả với quyền hệ thống');
select throws_ok(tests.upd('Mặc định A', 'is_default = false'),
  'P0001', 'saved_view_identity_immutable', 'Trigger: is_default không đổi');

-- ===========================================================================
-- DELETE
-- ===========================================================================
select tests.login_as(tests.uid('member_a'));
select is(tests.affected_rows(tests.del('pm-public')), 0, 'Thành viên không xóa chế độ xem công khai');
select lives_ok(tests.ins('project_a', 'm-temp', 'private'), 'Thành viên tạo chế độ xem tạm');
select is(tests.affected_rows(tests.del('m-temp')), 1, 'Thành viên xóa chế độ xem riêng của mình');
select tests.login_as(tests.uid('viewer_a'));
select is(tests.affected_rows(tests.del('m-private')), 0, 'Người xem không xóa chế độ xem của người khác');
select tests.login_as(tests.uid('outsider'));
select is(tests.affected_rows(tests.del('pm-public')), 0, 'Người ngoài không xóa');
select tests.login_as(tests.uid('admin'));
select is(tests.affected_rows(tests.del('Mặc định A')), 0, 'Admin không xóa chế độ xem mặc định');
select is(tests.affected_rows(tests.del('pm-private')), 0, 'Admin không xóa chế độ xem riêng của người khác');
select tests.login_as(tests.uid('pm_a'));
select is(tests.affected_rows(tests.del('admin-public')), 1, 'PM xóa chế độ xem công khai của dự án');
select is(tests.affected_rows(tests.del('Mặc định A')), 0, 'PM không xóa chế độ xem mặc định');

-- ===========================================================================
-- Ràng buộc tên và query
-- ===========================================================================
select tests.login_as(tests.uid('member_a'));
select throws_ok(tests.ins('project_a', '   ', 'private'), '23514', null, 'Tên rỗng bị từ chối');
select throws_ok(tests.ins('project_a', repeat('a', 101), 'private'), '23514', null, 'Tên 101 ký tự bị từ chối');
select lives_ok(tests.ins('project_a', repeat('ă', 100), 'private'), 'Tên 100 ký tự (có dấu) được nhận');
select throws_ok(tests.ins('project_a', ' M-PRIVATE ', 'private'), '23505', null,
  'Trùng tên không phân biệt hoa thường với chế độ xem của chính mình');
select lives_ok(tests.ins('project_a', 'PM-PUBLIC', 'private'),
  'Trùng tên với chế độ xem của người khác: được (duy nhất theo chủ sở hữu)');
select tests.login_as(tests.uid('pm_a'));
select lives_ok(tests.ins('project_b', 'PM-PRIVATE', 'private'),
  'Trùng tên với chế độ xem của mình ở dự án khác: được');
select tests.login_as(tests.uid('member_a'));
select throws_ok(tests.ins('project_a', 'q1', 'private', tests.q() || '{"extra":1}'), '23514', null,
  'query có khóa lạ bị từ chối');
select throws_ok(tests.ins('project_a', 'q2', 'private', tests.q() - 'display'), '23514', null,
  'query thiếu khóa bị từ chối');
select throws_ok(tests.ins('project_a', 'q3', 'private', jsonb_set(tests.q(), '{filters}', '{"limit":"5"}')),
  '23514', null, 'Bộ lọc lạ (limit) bị từ chối');
select throws_ok(tests.ins('project_a', 'q4', 'private',
  jsonb_set(tests.q(), '{filters}', '{"status_id":["AAAAAAAA-0000-4000-8000-000000000000"]}')),
  '23514', null, 'uuid chưa chuẩn hóa (chữ hoa) bị từ chối');
select throws_ok(tests.ins('project_a', 'q5', 'private', jsonb_set(tests.q(), '{display}', '"calendar"')),
  '23514', null, 'Kiểu hiển thị lạ bị từ chối');
select throws_ok(tests.ins('project_a', 'q6', 'private', jsonb_set(tests.q(), '{version}', '2')),
  '23514', null, 'version khác 1 bị từ chối');
select throws_ok(tests.ins('project_a', 'q7', 'private',
  jsonb_set(tests.q(), '{filters}', '{"due_after":"2026-03-01","due_before":"2026-02-01"}')),
  '23514', null, 'due_after sau due_before bị từ chối');
select throws_ok(tests.ins('project_a', 'q8', 'private', jsonb_set(tests.q(), '{sort}',
  '[{"field":"title","direction":"asc"},{"field":"priority","direction":"asc"},{"field":"due_date","direction":"asc"},{"field":"created_at","direction":"asc"}]')),
  '23514', null, 'Quá 3 tiêu chí sắp xếp bị từ chối');
select throws_ok(tests.ins('project_a', 'q9', 'private', jsonb_set(tests.q(), '{filters}', '{"due_after":"2026-02-30"}')),
  '23514', null, 'Ngày không có thật bị từ chối');
select throws_ok(tests.ins('project_a', 'q10', 'private', jsonb_set(tests.q(), '{columns}', '["title","title"]')),
  '23514', null, 'Cột trùng bị từ chối');
select tests.logout();
select ok(not private.saved_view_query_is_valid(tests.q() || jsonb_build_object('pad', repeat('x', 9000))),
  'query quá 8 KB bị từ chối');
select ok(private.saved_view_query_is_valid(jsonb_build_object(
  'version', 1,
  'filters', jsonb_build_object(
    'q', repeat('𝔸', 200),
    'status_id', (select jsonb_agg(format('00000000-0000-4000-8000-%s', lpad(i::text, 12, '0')))
                  from generate_series(1, 20) i),
    'assignee_id', '00000000-0000-4000-8000-000000000001',
    'priority', 'urgent',
    'label_id', '00000000-0000-4000-8000-000000000002',
    'due_after', '2026-01-01', 'due_before', '2026-12-31'),
  'sort', '[{"field":"title","direction":"asc"},{"field":"priority","direction":"desc"},{"field":"due_date","direction":"asc"}]'::jsonb,
  'group_by', 'assignee_id',
  'columns', '["title","status_id","type_id","priority","assignee_id","created_by","start_date","due_date","label_ids","parent_id","created_at","updated_at","completed_at"]'::jsonb,
  'display', 'gantt')),
  'query lớn nhất hợp lệ (mọi bộ lọc tối đa, 13 cột, 3 sắp xếp) vẫn dưới giới hạn kích thước');

-- ===========================================================================
-- Yêu thích (của riêng từng người)
-- ===========================================================================
select tests.login_as(tests.uid('viewer_a'));
select lives_ok(tests.fav('pm-public'), 'Người xem yêu thích chế độ xem công khai của PM');
select lives_ok(tests.fav('Mặc định chung'), 'Người xem yêu thích chế độ xem mặc định');
select throws_ok(tests.fav('m-private'), '42501', null,
  'Không yêu thích chế độ xem riêng của người khác (không đọc được)');
select throws_ok(tests.fav('pm-public'), '23505', null, 'Yêu thích hai lần: trùng khóa');
select throws_ok(format('insert into public.saved_view_favorites (view_id, user_id) values (%L, %L)',
  tests.v('m-private'), tests.uid('member_a')), '42501', null, 'Không đánh dấu thay người khác');
select tests.login_as(tests.uid('member_a'));
select is((select count(*)::int from public.saved_view_favorites), 0,
  'Thành viên không thấy dấu yêu thích của người khác');
select lives_ok(tests.fav('pm-public'), 'Thành viên yêu thích cùng chế độ xem công khai');
select is((select count(*)::int from public.saved_view_favorites), 1, 'Mỗi người chỉ thấy dấu của mình');
select is(tests.affected_rows(format('delete from public.saved_view_favorites where user_id = %L',
  tests.uid('viewer_a'))), 0, 'Không gỡ dấu yêu thích của người khác');
select tests.login_as(tests.uid('outsider'));
select throws_ok(tests.fav('pm-public'), '42501', null, 'Người ngoài không yêu thích chế độ xem của dự án');
select tests.login_anon();
select throws_ok('select * from public.saved_view_favorites', '42501', null, 'anon không đọc dấu yêu thích');

-- ===========================================================================
-- Xóa dự án xóa theo
-- ===========================================================================
select tests.logout();
delete from public.projects where id = tests.uid('project_a');
select is((select count(*)::int from public.saved_views where project_id = tests.uid('project_a')), 0,
  'Xóa dự án xóa theo chế độ xem của dự án');
select is((select count(*)::int from public.saved_view_favorites), 1,
  'Dấu yêu thích của chế độ xem bị xóa mất theo; chỉ còn dấu trên mẫu dùng chung');
select is((select count(*)::int from public.saved_views where project_id is null), 1,
  'Chế độ xem mặc định dùng chung còn nguyên');

select * from finish();
rollback;
