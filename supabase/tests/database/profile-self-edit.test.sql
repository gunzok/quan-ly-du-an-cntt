-- QLDA-77 (Story E1-7): hồ sơ cá nhân. Không có migration mới: màn /profile và PATCH /api/v1/me
-- dựa trên RLS, quyền cột sẵn có của profiles, profile_contacts, project_members, projects.
-- Tệp này khóa lại hành vi đó theo từng vai trò (PM, Thành viên, Người xem, Admin, người ngoài,
-- người bị khóa, anon): mỗi người chỉ sửa tên, ngôn ngữ, số điện thoại của CHÍNH MÌNH; không ai
-- tự nâng quyền; mỗi người đọc được danh sách vai trò của mình theo từng dự án (kể cả dự án đã
-- lưu trữ) và không thấy dòng của dự án khác.
begin;
\ir _helpers.psql
select tests.seed_fixture();
update public.projects set status = 'archived' where id = tests.uid('project_b');

select plan(38);

-- ===========================================================================
-- Sửa hồ sơ của mình: được với mọi vai trò đang hoạt động
-- ===========================================================================
select tests.login_as(tests.uid('pm_a'));
select is(tests.affected_rows($$update public.profiles set full_name = 'PM A mới', locale = 'en' where id = tests.uid('pm_a')$$), 1,
  'PM tự sửa tên, ngôn ngữ của mình');
select tests.login_as(tests.uid('member_a'));
select is(tests.affected_rows($$update public.profiles set full_name = 'Member A mới' where id = tests.uid('member_a')$$), 1,
  'Thành viên tự sửa tên của mình');
select tests.login_as(tests.uid('viewer_a'));
select is(tests.affected_rows($$update public.profiles set full_name = 'Viewer A mới' where id = tests.uid('viewer_a')$$), 1,
  'Người xem tự sửa tên của mình');
select tests.login_as(tests.uid('admin'));
select is(tests.affected_rows($$update public.profiles set full_name = 'Admin mới' where id = tests.uid('admin')$$), 1,
  'Admin tự sửa tên của mình');
select tests.login_as(tests.uid('outsider'));
select is(tests.affected_rows($$update public.profiles set full_name = 'Outsider mới' where id = tests.uid('outsider')$$), 1,
  'Người ngoài (không thuộc dự án nào) tự sửa tên của mình');

-- ===========================================================================
-- Không sửa được hồ sơ người khác (kể cả PM của dự án chung, Admin từ trình duyệt)
-- ===========================================================================
select tests.login_as(tests.uid('pm_a'));
select is(tests.affected_rows($$update public.profiles set full_name = 'x' where id = tests.uid('member_a')$$), 0,
  'PM không sửa được tên của thành viên dự án mình');
select tests.login_as(tests.uid('member_a'));
select is(tests.affected_rows($$update public.profiles set full_name = 'x', locale = 'en' where id = tests.uid('viewer_a')$$), 0,
  'Thành viên không sửa được hồ sơ người cùng dự án');
select tests.login_as(tests.uid('outsider'));
select is(tests.affected_rows($$update public.profiles set full_name = 'x' where id = tests.uid('pm_a')$$), 0,
  'Người ngoài không sửa được hồ sơ người khác');
select tests.login_as(tests.uid('admin'));
select is(tests.affected_rows($$update public.profiles set locale = 'en' where id = tests.uid('viewer_a')$$), 0,
  'Admin không sửa được ngôn ngữ của người khác qua client phiên');

-- ===========================================================================
-- Không tự nâng quyền: is_admin, is_active, email, department_id
-- ===========================================================================
select tests.login_as(tests.uid('viewer_a'));
select throws_ok($$update public.profiles set full_name = 'y', is_admin = true where id = tests.uid('viewer_a')$$,
  '42501', null, 'Người xem không tự nâng is_admin (kể cả gộp với cột được phép)');
select tests.login_as(tests.uid('pm_a'));
select throws_ok($$update public.profiles set is_admin = true where id = tests.uid('pm_a')$$,
  '42501', null, 'PM không tự nâng is_admin');
select tests.login_as(tests.uid('outsider'));
select throws_ok($$update public.profiles set department_id = tests.uid('dept_1') where id = tests.uid('outsider')$$,
  '42501', null, 'Không tự đổi phòng ban');
select throws_ok($$update public.profiles set email = 'moi@test.example' where id = tests.uid('outsider')$$,
  '42501', null, 'Không tự đổi email');

-- Người bị khóa: không sửa được gì, kể cả tự mở khóa.
select tests.login_as(tests.uid('locked'));
select is(tests.affected_rows($$update public.profiles set full_name = 'x', locale = 'en' where id = tests.uid('locked')$$), 0,
  'Người bị khóa không sửa được tên, ngôn ngữ');
select throws_ok($$update public.profiles set is_active = true where id = tests.uid('locked')$$,
  '42501', null, 'Người bị khóa không tự mở khóa');

-- anon
select tests.login_anon();
select throws_ok($$update public.profiles set full_name = 'x' where id = tests.uid('member_a')$$,
  '42501', null, 'anon không sửa được hồ sơ');
select throws_ok($$insert into public.profile_contacts (user_id, phone) values (tests.uid('member_a'), '0900000000')$$,
  '42501', null, 'anon không thêm được số điện thoại');

select tests.logout();
select results_eq(
  $$select full_name, locale, is_admin, is_active from public.profiles
    where id in (tests.uid('pm_a'), tests.uid('viewer_a'), tests.uid('locked')) order by email$$,
  $$values ('Locked'::text, 'vi'::text, false, false), ('PM A mới', 'en', false, true), ('Viewer A mới', 'vi', false, true)$$,
  'Chỉ đổi đúng tên/ngôn ngữ của chính chủ; is_admin, is_active giữ nguyên');

-- ===========================================================================
-- Số điện thoại: chính chủ thêm, sửa, xóa; sai định dạng bị từ chối
-- ===========================================================================
select tests.login_as(tests.uid('viewer_a'));
select is(tests.affected_rows($$update public.profile_contacts set phone = '+84 911 000 003' where user_id = tests.uid('viewer_a')$$), 1,
  'Người xem sửa được số của mình');
select throws_ok($$update public.profile_contacts set phone = '12345' where user_id = tests.uid('viewer_a')$$,
  '23514', null, 'Số quá ngắn bị từ chối');
select is(tests.affected_rows($$delete from public.profile_contacts where user_id = tests.uid('viewer_a')$$), 1,
  'Người xem xóa được số của mình');
select is(tests.affected_rows($$delete from public.profile_contacts where user_id = tests.uid('member_a')$$), 0,
  'Người xem không xóa được số của người cùng dự án');

select tests.login_as(tests.uid('admin'));
select throws_ok($$insert into public.profile_contacts (user_id, phone) values (tests.uid('admin'), '(028) 3822 1234')$$,
  '23514', null, 'Số bắt đầu bằng ngoặc bị từ chối (định dạng ^\+?[0-9]...)');
select lives_ok($$insert into public.profile_contacts (user_id, phone) values (tests.uid('admin'), '028 (3822) 1234')$$,
  'Admin thêm được số của mình');
select throws_ok($$insert into public.profile_contacts (user_id, phone) values (tests.uid('outsider'), '0900000000')$$,
  '42501', null, 'Admin không thêm số cho người khác từ trình duyệt');
select is(tests.affected_rows($$update public.profile_contacts set phone = '0900000099' where user_id = tests.uid('outsider')$$), 0,
  'Admin không sửa số của người khác');

select tests.login_as(tests.uid('pm_b'));
select lives_ok($$insert into public.profile_contacts (user_id, phone) values (tests.uid('pm_b'), '0900000005')$$,
  'PM thêm được số của mình');
select is(tests.affected_rows($$delete from public.profile_contacts where user_id = tests.uid('pm_a')$$), 0,
  'PM không xóa số của người cùng dự án');

select tests.login_as(tests.uid('locked'));
select is(tests.affected_rows($$delete from public.profile_contacts where user_id = tests.uid('locked')$$), 0,
  'Người bị khóa không xóa được');

select tests.logout();
select results_eq(
  $$select user_id, phone from public.profile_contacts order by user_id$$,
  $$values (tests.uid('admin'), '028 (3822) 1234'::text), (tests.uid('pm_a'), '0900000001'),
    (tests.uid('pm_b'), '0900000005'), (tests.uid('member_a'), '0900000002'),
    (tests.uid('outsider'), '0900000004')$$,
  'Chỉ số của chính chủ thay đổi');

-- ===========================================================================
-- Vai trò của tôi theo từng dự án (đọc project_members của mình kèm tên dự án)
-- ===========================================================================
create function tests.my_roles()
returns table (project text, role text, status text)
language sql
as $$
  select p.name, m.role::text, p.status
  from public.project_members m
  join public.projects p on p.id = m.project_id
  where m.user_id = (select auth.uid())
  order by p.name
$$;
grant execute on function tests.my_roles() to authenticated, anon;

select tests.login_as(tests.uid('pm_a'));
select results_eq('select * from tests.my_roles()',
  $$values ('Dự án A'::text, 'pm'::text, 'active'::text), ('Dự án B', 'viewer', 'archived')$$,
  'PM thấy vai trò của mình ở cả hai dự án, kể cả dự án đã lưu trữ');
select tests.login_as(tests.uid('member_a'));
select results_eq('select * from tests.my_roles()',
  $$values ('Dự án A'::text, 'member'::text, 'active'::text)$$, 'Thành viên thấy vai trò của mình');
select tests.login_as(tests.uid('viewer_a'));
select results_eq('select * from tests.my_roles()',
  $$values ('Dự án A'::text, 'viewer'::text, 'active'::text)$$, 'Người xem thấy vai trò của mình');
select tests.login_as(tests.uid('outsider'));
select is_empty('select * from tests.my_roles()', 'Người ngoài không có vai trò nào');
select tests.login_as(tests.uid('admin'));
select is_empty('select * from tests.my_roles()',
  'Admin không là thành viên thì danh sách vai trò theo dự án rỗng (vai trò hệ thống hiện riêng)');
select tests.login_as(tests.uid('locked'));
select is_empty('select * from tests.my_roles()', 'Người bị khóa không đọc được vai trò của mình');
select tests.login_as(tests.uid('member_a'));
select is_empty($$select 1 from public.project_members where project_id = tests.uid('project_b')$$,
  'Thành viên không thấy dòng thành viên của dự án mình không tham gia');
select tests.login_anon();
select throws_ok('select * from tests.my_roles()', '42501', null, 'anon không đọc được project_members');

select * from finish();
rollback;
