-- QLDA-61 (Story E5-2): template báo cáo. RLS bảng report_templates theo từng vai trò, quyền cột,
-- một template đang dùng mỗi định dạng, hàm set_report_template_active, bucket Storage riêng tư và
-- chính sách storage.objects.
begin;
\ir _helpers.psql
select tests.seed_fixture();

select plan(66);

-- Dữ liệu riêng của tệp test (id cố định, không đụng dòng khác trong CSDL dùng chung).
create function tests.rt(n int) returns uuid language sql immutable as $$
  select ('00000000-0000-0000-0000-0000000e5' || lpad(n::text, 3, '0'))::uuid;
$$;
grant execute on function tests.rt(int) to anon, authenticated;

-- 'locked' thành PM dự án B (vẫn bị khóa): PM bị khóa không đọc được.
insert into public.project_members (project_id, user_id, role)
values (tests.uid('project_b'), tests.uid('locked'), 'pm')
on conflict (project_id, user_id) do update set role = 'pm';

insert into public.report_templates (id, kind, name, storage_path, size_bytes, uploaded_by, is_active)
values
  (tests.rt(1), 'xlsx', 'Mẫu tuần', 'xlsx/' || tests.rt(1) || '.xlsx', 1000, tests.uid('admin'), true),
  (tests.rt(2), 'docx', 'Mẫu tháng', 'docx/' || tests.rt(2) || '.docx', 2000, tests.uid('admin'), false);

-- ===========================================================================
-- Cấu trúc
-- ===========================================================================
select has_table('public', 'report_templates', 'Có bảng report_templates');
select ok((select relrowsecurity from pg_class where oid = 'public.report_templates'::regclass),
  'report_templates bật RLS');
select ok(
  (select prosecdef and proconfig = array['search_path=""'] from pg_proc
    where oid = 'private.can_read_report_templates()'::regprocedure),
  'private.can_read_report_templates là SECURITY DEFINER với search_path rỗng');
select ok(not has_function_privilege('anon', 'private.can_read_report_templates()', 'execute'),
  'anon không gọi được private.can_read_report_templates');
select ok(
  (select not prosecdef and proconfig = array['search_path=""'] from pg_proc
    where oid = 'public.set_report_template_active(uuid, boolean)'::regprocedure),
  'set_report_template_active là SECURITY INVOKER với search_path rỗng');
select ok(not has_function_privilege('anon', 'public.set_report_template_active(uuid, boolean)', 'execute'),
  'anon không gọi được set_report_template_active');
select ok(not has_table_privilege('anon', 'public.report_templates', 'select'),
  'anon không có quyền select bảng');
select ok(not has_column_privilege('authenticated', 'public.report_templates', 'storage_path', 'update'),
  'Không ai đổi được storage_path (không cấp quyền cột)');
select ok(not has_column_privilege('authenticated', 'public.report_templates', 'kind', 'update'),
  'Không ai đổi được kind');
select ok(not has_column_privilege('authenticated', 'public.report_templates', 'uploaded_by', 'update'),
  'Không ai đổi được uploaded_by');

-- ===========================================================================
-- Đọc theo vai trò
-- ===========================================================================
select tests.login_as(tests.uid('admin'));
select is((select count(*)::int from public.report_templates where id in (tests.rt(1), tests.rt(2))), 2,
  'Admin đọc được template');
select tests.login_as(tests.uid('pm_a'));
select is((select count(*)::int from public.report_templates where id in (tests.rt(1), tests.rt(2))), 2,
  'PM (ở ít nhất một dự án) đọc được siêu dữ liệu');
select tests.login_as(tests.uid('pm_b'));
select is((select count(*)::int from public.report_templates where id in (tests.rt(1), tests.rt(2))), 2,
  'PM dự án khác cũng đọc được (template dùng chung toàn hệ thống)');
select tests.login_as(tests.uid('member_a'));
select is((select count(*)::int from public.report_templates), 0, 'Thành viên không đọc được');
select tests.login_as(tests.uid('viewer_a'));
select is((select count(*)::int from public.report_templates), 0, 'Người xem không đọc được');
select tests.login_as(tests.uid('outsider'));
select is((select count(*)::int from public.report_templates), 0, 'Người ngoài không đọc được');
select tests.login_as(tests.uid('locked'));
select is((select count(*)::int from public.report_templates), 0, 'PM bị khóa không đọc được');
select tests.login_as(tests.uid('locked_admin'));
select is((select count(*)::int from public.report_templates), 0, 'Admin bị khóa không đọc được');
select tests.login_anon();
select throws_ok($$select count(*) from public.report_templates$$, '42501', null,
  'anon bị từ chối đọc');

-- ===========================================================================
-- Ghi theo vai trò
-- ===========================================================================
select tests.login_as(tests.uid('pm_a'));
select throws_ok(
  $$insert into public.report_templates (id, kind, name, storage_path, size_bytes, uploaded_by)
    values (tests.rt(10), 'xlsx', 'X', 'xlsx/' || tests.rt(10) || '.xlsx', 1, tests.uid('pm_a'))$$,
  '42501', null, 'PM không thêm được');
select is(tests.affected_rows($$update public.report_templates set name = 'Sửa' where id = tests.rt(1)$$), 0,
  'PM không đổi tên được');
select is(tests.affected_rows($$delete from public.report_templates where id = tests.rt(1)$$), 0,
  'PM không xóa được');
select is((select count(*)::int from public.set_report_template_active(tests.rt(2), true)), 0,
  'PM không bật được template (hàm không trả dòng nào)');

select tests.login_as(tests.uid('member_a'));
select throws_ok(
  $$insert into public.report_templates (id, kind, name, storage_path, size_bytes, uploaded_by)
    values (tests.rt(11), 'xlsx', 'X', 'xlsx/' || tests.rt(11) || '.xlsx', 1, tests.uid('member_a'))$$,
  '42501', null, 'Thành viên không thêm được');
select is(tests.affected_rows($$update public.report_templates set name = 'Sửa' where id = tests.rt(1)$$), 0,
  'Thành viên không sửa được');
select is(tests.affected_rows($$delete from public.report_templates where id = tests.rt(1)$$), 0,
  'Thành viên không xóa được');

select tests.login_as(tests.uid('viewer_a'));
select is(tests.affected_rows($$delete from public.report_templates where id = tests.rt(1)$$), 0,
  'Người xem không xóa được');
select tests.login_as(tests.uid('outsider'));
select is(tests.affected_rows($$update public.report_templates set is_active = false where id = tests.rt(1)$$), 0,
  'Người ngoài không sửa được');

select tests.login_as(tests.uid('locked_admin'));
select throws_ok(
  $$insert into public.report_templates (id, kind, name, storage_path, size_bytes, uploaded_by)
    values (tests.rt(12), 'xlsx', 'X', 'xlsx/' || tests.rt(12) || '.xlsx', 1, tests.uid('locked_admin'))$$,
  '42501', null, 'Admin bị khóa không thêm được');
select is(tests.affected_rows($$delete from public.report_templates where id = tests.rt(1)$$), 0,
  'Admin bị khóa không xóa được');

select tests.login_anon();
select throws_ok($$delete from public.report_templates$$, '42501', null, 'anon không xóa được');

-- Admin
select tests.login_as(tests.uid('admin'));
select lives_ok(
  $$insert into public.report_templates (id, kind, name, storage_path, size_bytes)
    values (tests.rt(20), 'docx', 'Mẫu mới', 'docx/' || tests.rt(20) || '.docx', 10)$$,
  'Admin thêm được (uploaded_by mặc định là mình)');
select is((select uploaded_by from public.report_templates where id = tests.rt(20)), tests.uid('admin'),
  'uploaded_by = Admin');
select is((select is_active from public.report_templates where id = tests.rt(20)), false,
  'Template mới mặc định không dùng');
select throws_ok(
  $$insert into public.report_templates (id, kind, name, storage_path, size_bytes, uploaded_by)
    values (tests.rt(21), 'docx', 'Giả danh', 'docx/' || tests.rt(21) || '.docx', 10, tests.uid('pm_a'))$$,
  '42501', null, 'Admin không ghi uploaded_by thành người khác');
select throws_ok(
  $$insert into public.report_templates (id, kind, name, storage_path, size_bytes, is_active)
    values (tests.rt(22), 'docx', 'X', 'docx/' || tests.rt(22) || '.docx', 10, true)$$,
  '42501', null, 'Không chèn thẳng is_active (chỉ qua bật/tắt)');

-- CHECK
select throws_ok(
  $$insert into public.report_templates (id, kind, name, storage_path, size_bytes)
    values (tests.rt(23), 'docx', 'X', '../etc/passwd', 10)$$,
  '23514', null, 'storage_path sai định dạng bị từ chối');
select throws_ok(
  $$insert into public.report_templates (id, kind, name, storage_path, size_bytes)
    values (tests.rt(24), 'docx', 'X', 'xlsx/' || tests.rt(24) || '.xlsx', 10)$$,
  '23514', null, 'storage_path khác kind bị từ chối');
select throws_ok(
  $$insert into public.report_templates (id, kind, name, storage_path, size_bytes)
    values (tests.rt(25), 'xlsm', 'X', 'xlsm/' || tests.rt(25) || '.xlsm', 10)$$,
  '23514', null, 'kind ngoài xlsx/docx bị từ chối');
select throws_ok(
  $$insert into public.report_templates (id, kind, name, storage_path, size_bytes)
    values (tests.rt(26), 'docx', '  ', 'docx/' || tests.rt(26) || '.docx', 10)$$,
  '23514', null, 'Tên rỗng bị từ chối');
select throws_ok(
  $$insert into public.report_templates (id, kind, name, storage_path, size_bytes)
    values (tests.rt(27), 'docx', 'X', 'docx/' || tests.rt(27) || '.docx', 4194305)$$,
  '23514', null, 'Quá 4 MiB bị từ chối');
select throws_ok(
  $$insert into public.report_templates (id, kind, name, storage_path, size_bytes)
    values (tests.rt(28), 'docx', 'X', 'docx/' || tests.rt(2) || '.docx', 10)$$,
  '23505', null, 'Hai dòng không trỏ chung một tệp');

select is(tests.affected_rows($$update public.report_templates set name = 'Mẫu tuần (sửa)' where id = tests.rt(1)$$), 1,
  'Admin đổi tên được');
select throws_ok($$update public.report_templates set storage_path = 'xlsx/x.xlsx' where id = tests.rt(1)$$,
  '42501', null, 'Admin cũng không đổi được storage_path');

-- Một template đang dùng mỗi kind
select is(tests.affected_rows($$update public.report_templates set is_active = true where id = tests.rt(2)$$), 1,
  'Bật trực tiếp được khi chưa có docx nào đang dùng');
select throws_ok($$update public.report_templates set is_active = true where id = tests.rt(20)$$,
  '23505', null, 'Bật trực tiếp docx thứ hai khi đã có một đang dùng: 23505');
select is((select count(*)::int from public.set_report_template_active(tests.rt(20), true)), 1,
  'set_report_template_active bật được');
select is((select is_active from public.report_templates where id = tests.rt(2)), false,
  '... và tắt template docx cũ');
select is((select is_active from public.report_templates where id = tests.rt(1)), true,
  '... không đụng template khác định dạng');
select is((select count(*)::int from public.set_report_template_active(tests.rt(20), false)), 1,
  'Tắt được');
select is((select count(*)::int from public.report_templates where kind = 'docx' and is_active and id in (tests.rt(2), tests.rt(20))), 0,
  'Sau khi tắt không còn docx đang dùng');
select is((select count(*)::int from public.set_report_template_active(gen_random_uuid(), true)), 0,
  'id không tồn tại: không trả dòng nào');

select is(tests.affected_rows($$delete from public.report_templates where id = tests.rt(20)$$), 1,
  'Admin xóa được');

-- ===========================================================================
-- Storage
-- ===========================================================================
select tests.logout();
select is((select public from storage.buckets where id = 'report-templates'), false,
  'Bucket report-templates riêng tư');
select ok(not exists (
    select 1 from pg_policy where polrelid = 'storage.objects'::regclass
      and polname like 'report_templates_objects%' and polcmd = 'w'),
  'Không có chính sách UPDATE trên tệp template (không ghi đè)');

insert into storage.objects (bucket_id, name) values ('report-templates', 'xlsx/' || tests.rt(1) || '.xlsx');

select tests.login_as(tests.uid('admin'));
select is((select count(*)::int from storage.objects where bucket_id = 'report-templates' and name = 'xlsx/' || tests.rt(1) || '.xlsx'), 1,
  'Admin đọc được tệp');
select lives_ok(
  $$insert into storage.objects (bucket_id, name) values ('report-templates', 'docx/' || tests.rt(30) || '.docx')$$,
  'Admin thêm được tệp đúng định dạng đường dẫn');
select throws_ok(
  $$insert into storage.objects (bucket_id, name) values ('report-templates', 'docx/bao-cao.docx')$$,
  '42501', null, 'Admin không thêm được tệp với tên tùy ý');
select throws_ok(
  $$insert into storage.objects (bucket_id, name) values ('report-templates', 'docx/' || tests.rt(31) || '.xlsx')$$,
  '42501', null, 'Thư mục và đuôi phải khớp');

select tests.login_as(tests.uid('pm_a'));
select is((select count(*)::int from storage.objects where bucket_id = 'report-templates' and name = 'xlsx/' || tests.rt(1) || '.xlsx'), 1,
  'PM đọc được tệp');
select throws_ok(
  $$insert into storage.objects (bucket_id, name) values ('report-templates', 'docx/' || tests.rt(32) || '.docx')$$,
  '42501', null, 'PM không thêm được tệp');

select tests.login_as(tests.uid('member_a'));
select is((select count(*)::int from storage.objects where bucket_id = 'report-templates'), 0,
  'Thành viên không thấy tệp');
select tests.login_as(tests.uid('viewer_a'));
select is((select count(*)::int from storage.objects where bucket_id = 'report-templates'), 0,
  'Người xem không thấy tệp');
select tests.login_as(tests.uid('locked_admin'));
select is((select count(*)::int from storage.objects where bucket_id = 'report-templates'), 0,
  'Admin bị khóa không thấy tệp');

-- Xóa: storage chặn DELETE trực tiếp bằng trigger trừ khi bật storage.allow_delete_query (dịch vụ
-- Storage bật khi xóa qua API). Bật trong giao dịch test để kiểm riêng chính sách RLS.
select set_config('storage.allow_delete_query', 'true', true);
select tests.login_as(tests.uid('pm_a'));
select is(tests.affected_rows($$delete from storage.objects where bucket_id = 'report-templates'$$), 0,
  'PM không xóa được tệp');
select tests.login_as(tests.uid('admin'));
select is(tests.affected_rows($$delete from storage.objects where bucket_id = 'report-templates' and name = 'docx/' || tests.rt(30) || '.docx'$$), 1,
  'Admin xóa được tệp');

select * from finish();
rollback;
