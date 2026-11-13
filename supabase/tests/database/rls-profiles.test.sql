-- QLDA-32 (Story E1-3): RLS của profiles, profile_contacts, departments; trigger đồng bộ
-- auth.users; cấu hình an toàn của hàm và quyền bảng. Mỗi chính sách có ca được phép và ca bị
-- từ chối (test-strategy.md mục 2, NFR-06).
begin;
\ir _helpers.psql
select tests.seed_fixture();

select plan(57);

-- ===========================================================================
-- Cấu trúc và cấu hình an toàn
-- ===========================================================================
select tables_are('public',
  array['departments', 'profiles', 'profile_contacts', 'projects', 'project_members'],
  'Schema public có đúng 5 bảng của E1-3');

select is(
  (select array_agg(p.proname::text order by p.proname) from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private'
      and (not p.prosecdef or p.proconfig is distinct from array['search_path=""'])),
  null,
  'Mọi hàm trong private là SECURITY DEFINER với search_path rỗng');

select is(
  (select prosecdef from pg_proc where oid = 'public.create_project(text,text,date,date)'::regprocedure),
  false,
  'create_project() là SECURITY INVOKER (RLS vẫn áp dụng)');

select is(
  (select array_agg(t order by t) from unnest(array['departments', 'profiles', 'profile_contacts',
    'projects', 'project_members']) t
    where has_table_privilege('anon', 'public.' || t, 'select, insert, update, delete, truncate, references, trigger')),
  null,
  'anon không có quyền nào trên 5 bảng');

select ok(not has_function_privilege('anon', 'private.is_admin()', 'execute')
  and not has_function_privilege('anon', 'public.create_project(text,text,date,date)', 'execute')
  and not has_schema_privilege('anon', 'private', 'usage'),
  'anon không gọi được hàm hỗ trợ RLS và create_project()');

select ok(not has_function_privilege('authenticated', 'private.handle_new_user()', 'execute')
  and not has_function_privilege('authenticated', 'private.add_project_creator_as_pm()', 'execute'),
  'authenticated không gọi trực tiếp được hàm trigger');

-- ===========================================================================
-- Trigger
-- ===========================================================================
insert into auth.users (id, email, raw_user_meta_data)
  values ('00000000-0000-0000-0000-0000000000aa', 'moi@test.example', '{"full_name":"Người Mới"}');
select results_eq(
  $$select email, full_name, is_admin, is_active, locale from public.profiles
    where id = '00000000-0000-0000-0000-0000000000aa'$$,
  $$values ('moi@test.example'::text, 'Người Mới'::text, false, true, 'vi'::text)$$,
  'Tạo user trong auth.users thì tự có profiles (không Admin, đang hoạt động, tiếng Việt)');

update auth.users set email = 'moi2@test.example' where id = '00000000-0000-0000-0000-0000000000aa';
select is((select email from public.profiles where id = '00000000-0000-0000-0000-0000000000aa'),
  'moi2@test.example', 'Đổi email ở auth.users thì profiles.email cập nhật theo');

update public.profiles set updated_at = '2000-01-01' where id = tests.uid('member_a');
update public.profiles set full_name = 'Member A' where id = tests.uid('member_a');
select is((select updated_at from public.profiles where id = tests.uid('member_a')), now(),
  'Trigger set_updated_at chạy trên profiles');

-- ===========================================================================
-- profiles SELECT (profiles_select)
-- ===========================================================================
select tests.login_as(tests.uid('outsider'));
select results_eq('select id from public.profiles', array[tests.uid('outsider')],
  'Người ngoài dự án chỉ thấy hồ sơ của mình');

select tests.login_as(tests.uid('member_a'));
select results_eq('select id from public.profiles order by id',
  array[tests.uid('pm_a'), tests.uid('member_a'), tests.uid('viewer_a'), tests.uid('locked')],
  'Thành viên thấy hồ sơ người cùng dự án, không thấy người ngoài');

select tests.login_as(tests.uid('viewer_a'));
select is((select count(*)::int from public.profiles), 4, 'Người xem thấy hồ sơ người cùng dự án');
select is_empty($$select 1 from public.profiles where id = tests.uid('pm_b')$$,
  'Người xem A không thấy hồ sơ PM của dự án B');

select tests.login_as(tests.uid('pm_b'));
select is((select count(*)::int from public.profiles), 9,
  'Người đang là PM thấy mọi hồ sơ (để tìm người thêm vào dự án)');

select tests.login_as(tests.uid('admin'));
select is((select count(*)::int from public.profiles), 9, 'Admin thấy mọi hồ sơ');

select tests.login_as(tests.uid('locked'));
select is_empty('select * from public.profiles', 'Người bị khóa không thấy hồ sơ nào, kể cả của mình');

select tests.login_anon();
select throws_ok('select * from public.profiles', '42501', null, 'anon không đọc được profiles');

-- ===========================================================================
-- profiles UPDATE (profiles_update_self + quyền cột full_name, locale)
-- ===========================================================================
select tests.login_as(tests.uid('member_a'));
select is(tests.affected_rows($$update public.profiles set full_name = 'Tên mới', locale = 'en' where id = tests.uid('member_a')$$), 1,
  'Người dùng sửa được tên hiển thị và ngôn ngữ của mình');
select throws_ok($$update public.profiles set is_admin = true where id = tests.uid('member_a')$$,
  '42501', null, 'Không tự nâng is_admin');
select throws_ok($$update public.profiles set is_active = true where id = tests.uid('member_a')$$,
  '42501', null, 'Không tự đổi is_active');
select throws_ok($$update public.profiles set department_id = tests.uid('dept_1') where id = tests.uid('member_a')$$,
  '42501', null, 'Không tự đổi phòng ban (Admin làm qua API máy chủ)');
select throws_ok($$update public.profiles set email = 'x@test.example' where id = tests.uid('member_a')$$,
  '42501', null, 'Không sửa email ở profiles (đồng bộ từ auth.users)');
select throws_ok($$update public.profiles set locale = 'fr' where id = tests.uid('member_a')$$,
  '23514', null, 'locale chỉ nhận vi hoặc en');
select is(tests.affected_rows($$update public.profiles set full_name = 'x' where id = tests.uid('viewer_a')$$), 0,
  'Không sửa được hồ sơ người khác');
select throws_ok($$insert into public.profiles (id, full_name) values (gen_random_uuid(), 'x')$$,
  '42501', null, 'Không tạo profiles từ trình duyệt');
select throws_ok($$delete from public.profiles where id = tests.uid('member_a')$$,
  '42501', null, 'Không xóa profiles từ trình duyệt');

select tests.login_as(tests.uid('admin'));
select is(tests.affected_rows($$update public.profiles set full_name = 'x' where id = tests.uid('member_a')$$), 0,
  'Admin không sửa hồ sơ người khác từ trình duyệt (dùng API máy chủ, E1-4)');
select throws_ok($$update public.profiles set is_admin = true where id = tests.uid('member_a')$$,
  '42501', null, 'Admin cũng không đổi is_admin từ trình duyệt');

select tests.login_as(tests.uid('locked'));
select is(tests.affected_rows($$update public.profiles set full_name = 'x' where id = tests.uid('locked')$$), 0,
  'Người bị khóa không sửa được hồ sơ của mình');

select tests.logout();
select results_eq(
  $$select full_name, locale, is_admin, is_active from public.profiles where id = tests.uid('member_a')$$,
  $$values ('Tên mới'::text, 'en'::text, false, true)$$,
  'Hồ sơ member_a chỉ đổi tên và ngôn ngữ, is_admin vẫn false');

-- ===========================================================================
-- profile_contacts SELECT (số điện thoại: chính chủ, PM dự án chung, Admin)
-- ===========================================================================
select tests.login_as(tests.uid('member_a'));
select results_eq('select user_id from public.profile_contacts', array[tests.uid('member_a')],
  'Thành viên chỉ thấy số điện thoại của mình');

select tests.login_as(tests.uid('viewer_a'));
select results_eq('select user_id from public.profile_contacts', array[tests.uid('viewer_a')],
  'Người xem chỉ thấy số điện thoại của mình, không thấy của người cùng dự án');

select tests.login_as(tests.uid('pm_a'));
select results_eq('select user_id from public.profile_contacts order by user_id',
  array[tests.uid('pm_a'), tests.uid('member_a'), tests.uid('viewer_a')],
  'PM thấy số điện thoại của thành viên dự án mình làm PM, không thấy của người ngoài');

select tests.login_as(tests.uid('pm_b'));
select results_eq('select user_id from public.profile_contacts', array[tests.uid('pm_a')],
  'pm_b thấy số của pm_a (cùng dự án B) nhưng không thấy thành viên dự án A');

select tests.login_as(tests.uid('admin'));
select is((select count(*)::int from public.profile_contacts), 4, 'Admin thấy mọi số điện thoại');

select tests.login_as(tests.uid('outsider'));
select results_eq('select user_id from public.profile_contacts', array[tests.uid('outsider')],
  'Người ngoài chỉ thấy số của mình');

select tests.login_as(tests.uid('locked'));
select is_empty('select * from public.profile_contacts', 'Người bị khóa không thấy số điện thoại nào');

select tests.login_anon();
select throws_ok('select * from public.profile_contacts', '42501', null, 'anon không đọc được profile_contacts');

-- ===========================================================================
-- profile_contacts INSERT/UPDATE/DELETE: chỉ chính chủ
-- ===========================================================================
select tests.login_as(tests.uid('outsider'));
select throws_ok($$insert into public.profile_contacts (user_id, phone) values (tests.uid('pm_b'), '0911111111')$$,
  '42501', null, 'Không thêm số điện thoại cho người khác');

select tests.login_as(tests.uid('pm_b'));
select lives_ok($$insert into public.profile_contacts (user_id, phone) values (tests.uid('pm_b'), '+84 911 111 111')$$,
  'Chính chủ thêm được số điện thoại của mình');
select throws_ok($$update public.profile_contacts set phone = 'abc' where user_id = tests.uid('pm_b')$$,
  '23514', null, 'Số điện thoại sai định dạng bị từ chối');
select throws_ok($$update public.profile_contacts set user_id = tests.uid('pm_a') where user_id = tests.uid('pm_b')$$,
  '42501', null, 'Không đổi user_id của số điện thoại');

select tests.login_as(tests.uid('member_a'));
select is(tests.affected_rows($$update public.profile_contacts set phone = '0922222222' where user_id = tests.uid('member_a')$$), 1,
  'Chính chủ sửa được số của mình');

select tests.login_as(tests.uid('pm_a'));
select is(tests.affected_rows($$update public.profile_contacts set phone = '0933333333' where user_id = tests.uid('member_a')$$), 0,
  'PM xem được nhưng không sửa được số của thành viên');
select is(tests.affected_rows($$delete from public.profile_contacts where user_id = tests.uid('member_a')$$), 0,
  'PM không xóa được số của thành viên');

select tests.login_as(tests.uid('locked'));
select throws_ok($$insert into public.profile_contacts (user_id, phone) values (tests.uid('locked'), '0944444444')$$,
  '42501', null, 'Người bị khóa không thêm được số của mình');

select tests.login_as(tests.uid('member_a'));
select is(tests.affected_rows($$delete from public.profile_contacts where user_id = tests.uid('member_a')$$), 1,
  'Chính chủ xóa được số của mình');

-- ===========================================================================
-- departments: người đang hoạt động đọc, Admin ghi
-- ===========================================================================
select tests.login_as(tests.uid('member_a'));
select is((select count(*)::int from public.departments), 1, 'Người dùng đang hoạt động đọc được phòng ban');
select is(tests.affected_rows($$update public.departments set name = 'x' where id = tests.uid('dept_1')$$), 0,
  'Người dùng thường không sửa được phòng ban');
select is(tests.affected_rows($$delete from public.departments where id = tests.uid('dept_1')$$), 0,
  'Người dùng thường không xóa được phòng ban');

select tests.login_as(tests.uid('pm_a'));
select throws_ok($$insert into public.departments (name) values ('Phòng của PM')$$, '42501', null,
  'PM không tạo được phòng ban');

select tests.login_as(tests.uid('locked'));
select is_empty('select * from public.departments', 'Người bị khóa không đọc được phòng ban');

select tests.login_as(tests.uid('locked_admin'));
select throws_ok($$insert into public.departments (name) values ('x')$$, '42501', null,
  'Admin bị khóa không tạo được phòng ban');

select tests.login_anon();
select throws_ok('select * from public.departments', '42501', null, 'anon không đọc được departments');

select tests.login_as(tests.uid('admin'));
select lives_ok($$insert into public.departments (name, position) values ('Phòng Thử 2', 2)$$, 'Admin tạo được phòng ban');
select is(tests.affected_rows($$update public.departments set position = 5 where id = tests.uid('dept_1')$$), 1,
  'Admin sửa được phòng ban');
select is(tests.affected_rows($$delete from public.departments where name = 'Phòng Thử 2'$$), 1,
  'Admin xóa được phòng ban');

select * from finish();
rollback;
