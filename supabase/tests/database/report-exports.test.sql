-- QLDA-67 (Story E5-3): nhật ký xuất báo cáo report_exports. Cấu trúc, quyền cột, RLS theo từng
-- vai trò (PM, Thành viên, Người xem, Admin, người ngoài, người bị khóa, Admin bị khóa, anon), không
-- ai sửa/xóa, khóa ngoại template ON DELETE SET NULL và dự án ON DELETE CASCADE.
begin;
\ir _helpers.psql
select tests.seed_fixture();

select plan(49);

create function tests.rx(n int) returns uuid language sql immutable as $$
  select ('00000000-0000-0000-0000-0000000e53' || lpad(n::text, 2, '0'))::uuid;
$$;
grant execute on function tests.rx(int) to anon, authenticated;

-- 'locked' thành PM dự án A (vẫn bị khóa): PM bị khóa không đọc/ghi được.
update public.project_members set role = 'pm'
  where project_id = tests.uid('project_a') and user_id = tests.uid('locked');

insert into public.report_templates (id, kind, name, storage_path, size_bytes, uploaded_by, is_active)
values (tests.rx(90), 'xlsx', 'Mẫu E5-3', 'xlsx/' || tests.rx(90) || '.xlsx', 1000, tests.uid('admin'), false);

insert into public.report_exports (id, project_id, template_id, format, period_start, period_end, requested_by)
values
  (tests.rx(1), tests.uid('project_a'), tests.rx(90), 'xlsx', '2026-11-01', '2026-11-30', tests.uid('pm_a')),
  (tests.rx(2), tests.uid('project_b'), tests.rx(90), 'xlsx', '2026-11-01', '2026-11-30', tests.uid('pm_b'));

-- ===========================================================================
-- Cấu trúc và quyền
-- ===========================================================================
select has_table('public', 'report_exports', 'Có bảng report_exports');
select ok((select relrowsecurity from pg_class where oid = 'public.report_exports'::regclass),
  'report_exports bật RLS');
select ok(not has_table_privilege('anon', 'public.report_exports', 'select'), 'anon không có quyền select');
select ok(not has_table_privilege('anon', 'public.report_exports', 'insert'), 'anon không có quyền insert');
select ok(not has_table_privilege('authenticated', 'public.report_exports', 'update'),
  'authenticated không có quyền update');
select ok(not has_table_privilege('authenticated', 'public.report_exports', 'delete'),
  'authenticated không có quyền delete');
select ok(not has_column_privilege('authenticated', 'public.report_exports', 'created_at', 'insert'),
  'Không tự đặt created_at');
select is(
  (select confdeltype::text from pg_constraint
    where conrelid = 'public.report_exports'::regclass and contype = 'f'
      and confrelid = 'public.report_templates'::regclass),
  'n', 'template_id ON DELETE SET NULL');
select is(
  (select confdeltype::text from pg_constraint
    where conrelid = 'public.report_exports'::regclass and contype = 'f'
      and confrelid = 'public.projects'::regclass),
  'c', 'project_id ON DELETE CASCADE');
select is(
  (select count(*)::int from pg_policies
    where schemaname = 'public' and tablename = 'report_exports' and cmd in ('UPDATE', 'DELETE', 'ALL')),
  0, 'Không có chính sách UPDATE/DELETE');

-- ===========================================================================
-- Đọc theo vai trò
-- ===========================================================================
select tests.login_as(tests.uid('admin'));
select is((select count(*)::int from public.report_exports where id in (tests.rx(1), tests.rx(2))), 2,
  'Admin đọc mọi dự án');
select tests.login_as(tests.uid('pm_a'));
select is((select count(*)::int from public.report_exports where id in (tests.rx(1), tests.rx(2))), 1,
  'PM dự án A chỉ đọc của dự án A');
select is((select id from public.report_exports where id in (tests.rx(1), tests.rx(2))), tests.rx(1),
  'PM dự án A không đọc dự án B (ở B chỉ là Người xem)');
select tests.login_as(tests.uid('pm_b'));
select is((select count(*)::int from public.report_exports where id in (tests.rx(1), tests.rx(2))), 1,
  'PM dự án B chỉ đọc của dự án B');
select tests.login_as(tests.uid('member_a'));
select is((select count(*)::int from public.report_exports), 0, 'Thành viên không đọc được');
select tests.login_as(tests.uid('viewer_a'));
select is((select count(*)::int from public.report_exports), 0, 'Người xem không đọc được');
select tests.login_as(tests.uid('outsider'));
select is((select count(*)::int from public.report_exports), 0, 'Người ngoài không đọc được');
select tests.login_as(tests.uid('locked'));
select is((select count(*)::int from public.report_exports), 0, 'PM bị khóa không đọc được');
select tests.login_as(tests.uid('locked_admin'));
select is((select count(*)::int from public.report_exports), 0, 'Admin bị khóa không đọc được');
select tests.login_anon();
select throws_ok($$select count(*) from public.report_exports$$, '42501', null, 'anon bị từ chối đọc');

-- ===========================================================================
-- Thêm theo vai trò
-- ===========================================================================
select tests.login_as(tests.uid('pm_a'));
select lives_ok(
  $$insert into public.report_exports (id, project_id, template_id, format, period_start, period_end, requested_by)
    values (tests.rx(10), tests.uid('project_a'), tests.rx(90), 'xlsx', '2026-11-01', '2026-11-30', tests.uid('pm_a'))$$,
  'PM thêm được cho dự án của mình');
select lives_ok(
  $$insert into public.report_exports (id, project_id, format, period_start, period_end)
    values (tests.rx(11), tests.uid('project_a'), 'xlsx', '2026-11-01', '2026-11-01')$$,
  'requested_by mặc định là chính mình');
select is((select requested_by from public.report_exports where id = tests.rx(11)), tests.uid('pm_a'),
  'requested_by = auth.uid()');
select throws_ok(
  $$insert into public.report_exports (id, project_id, format, period_start, period_end, requested_by)
    values (tests.rx(12), tests.uid('project_a'), 'xlsx', '2026-11-01', '2026-11-30', tests.uid('pm_b'))$$,
  '42501', null, 'PM không ghi thay người khác');
select throws_ok(
  $$insert into public.report_exports (id, project_id, format, period_start, period_end, requested_by)
    values (tests.rx(13), tests.uid('project_b'), 'xlsx', '2026-11-01', '2026-11-30', tests.uid('pm_a'))$$,
  '42501', null, 'PM dự án A (Người xem ở B) không thêm cho dự án B');
select throws_ok(
  $$insert into public.report_exports (id, project_id, format, period_start, period_end, requested_by, created_at)
    values (tests.rx(14), tests.uid('project_a'), 'xlsx', '2026-11-01', '2026-11-30', tests.uid('pm_a'), now())$$,
  '42501', null, 'Không tự đặt created_at (quyền cột)');

select tests.login_as(tests.uid('admin'));
select lives_ok(
  $$insert into public.report_exports (id, project_id, format, period_start, period_end, requested_by)
    values (tests.rx(15), tests.uid('project_b'), 'xlsx', '2026-11-01', '2026-11-30', tests.uid('admin'))$$,
  'Admin thêm được cho dự án bất kỳ');

select tests.login_as(tests.uid('member_a'));
select throws_ok(
  $$insert into public.report_exports (id, project_id, format, period_start, period_end, requested_by)
    values (tests.rx(16), tests.uid('project_a'), 'xlsx', '2026-11-01', '2026-11-30', tests.uid('member_a'))$$,
  '42501', null, 'Thành viên không thêm được');
select tests.login_as(tests.uid('viewer_a'));
select throws_ok(
  $$insert into public.report_exports (id, project_id, format, period_start, period_end, requested_by)
    values (tests.rx(17), tests.uid('project_a'), 'xlsx', '2026-11-01', '2026-11-30', tests.uid('viewer_a'))$$,
  '42501', null, 'Người xem không thêm được');
select tests.login_as(tests.uid('outsider'));
select throws_ok(
  $$insert into public.report_exports (id, project_id, format, period_start, period_end, requested_by)
    values (tests.rx(18), tests.uid('project_a'), 'xlsx', '2026-11-01', '2026-11-30', tests.uid('outsider'))$$,
  '42501', null, 'Người ngoài không thêm được');
select tests.login_as(tests.uid('locked'));
select throws_ok(
  $$insert into public.report_exports (id, project_id, format, period_start, period_end, requested_by)
    values (tests.rx(19), tests.uid('project_a'), 'xlsx', '2026-11-01', '2026-11-30', tests.uid('locked'))$$,
  '42501', null, 'PM bị khóa không thêm được');
select tests.login_as(tests.uid('locked_admin'));
select throws_ok(
  $$insert into public.report_exports (id, project_id, format, period_start, period_end, requested_by)
    values (tests.rx(20), tests.uid('project_a'), 'xlsx', '2026-11-01', '2026-11-30', tests.uid('locked_admin'))$$,
  '42501', null, 'Admin bị khóa không thêm được');
select tests.login_anon();
select throws_ok(
  $$insert into public.report_exports (id, project_id, format, period_start, period_end)
    values (tests.rx(21), tests.uid('project_a'), 'xlsx', '2026-11-01', '2026-11-30')$$,
  '42501', null, 'anon không thêm được');

-- ===========================================================================
-- Không ai sửa/xóa
-- ===========================================================================
select tests.login_as(tests.uid('admin'));
select throws_ok($$update public.report_exports set format = 'docx' where id = tests.rx(1)$$,
  '42501', null, 'Admin không sửa được');
select throws_ok($$delete from public.report_exports where id = tests.rx(1)$$,
  '42501', null, 'Admin không xóa được');
select tests.login_as(tests.uid('pm_a'));
select throws_ok($$update public.report_exports set period_end = '2026-12-31' where id = tests.rx(1)$$,
  '42501', null, 'PM không sửa được');
select throws_ok($$delete from public.report_exports where id = tests.rx(1)$$,
  '42501', null, 'PM không xóa được');
select tests.login_as(tests.uid('member_a'));
select throws_ok($$delete from public.report_exports where id = tests.rx(1)$$,
  '42501', null, 'Thành viên không xóa được');
select tests.login_as(tests.uid('viewer_a'));
select throws_ok($$update public.report_exports set format = 'docx'$$,
  '42501', null, 'Người xem không sửa được');
select tests.login_as(tests.uid('outsider'));
select throws_ok($$delete from public.report_exports$$, '42501', null, 'Người ngoài không xóa được');
select tests.login_as(tests.uid('locked'));
select throws_ok($$delete from public.report_exports$$, '42501', null, 'Người bị khóa không xóa được');
select tests.login_anon();
select throws_ok($$delete from public.report_exports$$, '42501', null, 'anon không xóa được');

-- ===========================================================================
-- Ràng buộc dữ liệu
-- ===========================================================================
select tests.login_as(tests.uid('pm_a'));
select throws_ok(
  $$insert into public.report_exports (project_id, format, period_start, period_end)
    values (tests.uid('project_a'), 'xlsx', '2026-11-30', '2026-11-01')$$,
  '23514', null, 'period_start > period_end bị từ chối');
select throws_ok(
  $$insert into public.report_exports (project_id, format, period_start, period_end)
    values (tests.uid('project_a'), 'xlsx', '2026-01-01', '2027-01-02')$$,
  '23514', null, 'Kỳ dài hơn 366 ngày bị từ chối');
select throws_ok(
  $$insert into public.report_exports (project_id, format, period_start, period_end)
    values (tests.uid('project_a'), 'pdf', '2026-11-01', '2026-11-30')$$,
  '23514', null, 'Định dạng lạ bị từ chối');
select lives_ok(
  $$insert into public.report_exports (project_id, format, period_start, period_end)
    values (tests.uid('project_a'), 'xlsx', '2026-01-01', '2027-01-01')$$,
  'Kỳ đúng 366 ngày (năm có ngày cuối) được nhận');

-- ===========================================================================
-- Khóa ngoại
-- ===========================================================================
select tests.logout();
delete from public.report_templates where id = tests.rx(90);
select is((select count(*)::int from public.report_exports where template_id is null and id in (tests.rx(1), tests.rx(2), tests.rx(10))),
  3, 'Xóa template: giữ lịch sử, template_id thành null');
delete from public.projects where id = tests.uid('project_b');
select is((select count(*)::int from public.report_exports where id in (tests.rx(2), tests.rx(15))), 0,
  'Xóa dự án: xóa nhật ký xuất của dự án');
select is((select count(*)::int from public.report_exports where id = tests.rx(1)), 1,
  'Nhật ký của dự án khác còn nguyên');

select * from finish();
rollback;
