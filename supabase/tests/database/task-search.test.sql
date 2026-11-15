-- QLDA-48 (Story E3-3): tìm kiếm task bỏ dấu tiếng Việt (migration 20261115180000_task_search.sql).
-- Kiểm: hàm bỏ dấu, thoát ký tự LIKE, chỉ mục trigram dùng được, quyền thực thi hàm, RLS của
-- tasks không đổi và vẫn quyết định ai thấy gì (người ngoài dự án không thấy dù từ khóa khớp).
begin;
\ir _helpers.psql
select tests.seed_fixture();

create function tests.st(name text)
returns uuid
language sql
immutable
as $$
  select case name
    when 't1' then '00000000-0000-0000-0000-000000008001'
    when 't2' then '00000000-0000-0000-0000-000000008002'
    when 't3' then '00000000-0000-0000-0000-000000008003'
    when 't4' then '00000000-0000-0000-0000-000000008004'
    when 't5' then '00000000-0000-0000-0000-000000008005'
    when 't6' then '00000000-0000-0000-0000-000000008006'
    when 't7' then '00000000-0000-0000-0000-000000008007'
    when 't8' then '00000000-0000-0000-0000-000000008008'
  end::uuid;
$$;

-- Id (đã sắp) các task tìm được bằng public.search_tasks với vai trò hiện tại.
create function tests.search(project text, q text)
returns uuid[]
language sql
as $$
  select coalesce(array_agg(id order by id), '{}')
  from public.search_tasks(tests.uid(project), q);
$$;

-- Mảng id task mẫu theo ký hiệu, đã sắp.
create function tests.sts(variadic names text[])
returns uuid[]
language sql
immutable
as $$
  select coalesce(array_agg(tests.st(n) order by tests.st(n)), '{}') from unnest(names) n;
$$;

-- Kế hoạch truy vấn dạng văn bản (để kiểm chỉ mục được dùng).
create function tests.plan_text(sql text)
returns text
language plpgsql
as $$
declare
  line text;
  result text := '';
begin
  for line in execute 'explain (costs off) ' || sql loop
    result := result || line || E'\n';
  end loop;
  return result;
end;
$$;
grant execute on function tests.st(text), tests.search(text, text), tests.sts(text[])
  to anon, authenticated;

insert into public.tasks (id, project_id, title, description, created_by) values
  (tests.st('t1'), tests.uid('project_a'), 'Báo cáo tiến độ tháng', null, tests.uid('pm_a')),
  (tests.st('t2'), tests.uid('project_a'), 'Đường truyền dự phòng', 'Kiểm tra ƯU TIÊN cao. Ơn giời!', tests.uid('pm_a')),
  (tests.st('t3'), tests.uid('project_a'), 'Thiết kế cơ sở dữ liệu', null, tests.uid('pm_a')),
  (tests.st('t4'), tests.uid('project_a'), 'Hoàn thành 100% kiểm thử', null, tests.uid('pm_a')),
  (tests.st('t5'), tests.uid('project_a'), 'Biến a_b trong mã', null, tests.uid('pm_a')),
  (tests.st('t6'), tests.uid('project_a'), 'Đường dẫn C:\temp', null, tests.uid('pm_a')),
  (tests.st('t7'), tests.uid('project_a'), normalize('Bảo trì Hỗ trợ kỹ thuật', NFD), null, tests.uid('pm_a')),
  (tests.st('t8'), tests.uid('project_b'), 'Báo cáo dự án B', null, tests.uid('pm_b'));

insert into public.labels (id, project_id, name) values
  ('00000000-0000-0000-0000-000000009001', tests.uid('project_a'), 'Nhãn tìm kiếm');
insert into public.task_labels (task_id, label_id) values
  (tests.st('t1'), '00000000-0000-0000-0000-000000009001');

select plan(70);

-- ===========================================================================
-- Cấu trúc, quyền thực thi
-- ===========================================================================
select has_extension('extensions', 'pg_trgm', 'pg_trgm nằm trong schema extensions');
select has_extension('extensions', 'unaccent', 'unaccent nằm trong schema extensions');
select has_index('public', 'tasks', 'tasks_search_trgm_idx', 'Có chỉ mục trigram tìm kiếm');
select volatility_is('private', 'search_normalize', array['text'], 'immutable',
  'search_normalize là IMMUTABLE (dùng được trong chỉ mục)');
select volatility_is('private', 'task_search_text', array['text', 'text'], 'immutable',
  'task_search_text là IMMUTABLE');
select is_definer('private', 'search_task_ids', array['uuid', 'text'],
  'search_task_ids là SECURITY DEFINER (để dùng chỉ mục dưới RLS)');
select isnt_definer('public', 'search_tasks', array['uuid', 'text', 'uuid'],
  'search_tasks là SECURITY INVOKER: RLS của tasks áp dụng');
select is(
  (select count(*)::int from pg_proc
   where oid in ('private.search_normalize(text)'::regprocedure,
                 'private.task_search_text(text,text)'::regprocedure,
                 'private.search_patterns(text)'::regprocedure,
                 'private.search_task_ids(uuid,text)'::regprocedure,
                 'public.search_tasks(uuid,text,uuid)'::regprocedure)
     and proconfig @> array['search_path=""']),
  5, 'Mọi hàm mới đặt search_path rỗng');
select function_privs_are('public', 'search_tasks', array['uuid', 'text', 'uuid'], 'anon', array[]::text[],
  'anon không gọi được search_tasks');
select function_privs_are('public', 'search_tasks', array['uuid', 'text', 'uuid'], 'authenticated',
  array['EXECUTE'], 'authenticated gọi được search_tasks');
select function_privs_are('private', 'search_task_ids', array['uuid', 'text'], 'anon', array[]::text[],
  'anon không gọi được search_task_ids');
select function_privs_are('private', 'search_patterns', array['text'], 'authenticated', array[]::text[],
  'authenticated không gọi trực tiếp search_patterns');

-- RLS của tasks không đổi.
select policies_are('public', 'tasks',
  array['tasks_select', 'tasks_insert', 'tasks_update', 'tasks_delete'],
  'tasks vẫn đúng bốn chính sách');
select is((select relrowsecurity from pg_class where oid = 'public.tasks'::regclass), true,
  'RLS vẫn bật trên tasks');

-- ===========================================================================
-- Bỏ dấu, không phân biệt hoa thường
-- ===========================================================================
select is(private.search_normalize('Báo Cáo'), 'bao cao', 'Bỏ dấu sắc, chữ hoa');
select is(private.search_normalize('ĐƯỜNG đi Đ đ'), 'duong di d d', 'Đ/đ thành d');
select is(private.search_normalize('Ơn Ưu ơ ư Ă â Ê ô'), 'on uu o u a a e o', 'ơ ư ă â ê ô');
select is(private.search_normalize('à á ả ã ạ ằ ắ ẳ ẵ ặ ầ ấ ẩ ẫ ậ'), 'a a a a a a a a a a a a a a a',
  'Đủ năm dấu thanh trên a, ă, â');
select is(private.search_normalize('Hỗ trợ KỸ THUẬT, Ỵ ỹ'), 'ho tro ky thuat, y y', 'Dấu trên y, ô, ơ, â');
select is(private.search_normalize(normalize('Bảo trì', NFD)), 'bao tri',
  'Văn bản dạng tổ hợp (NFD) cũng bỏ được dấu');
select is(private.task_search_text('Tiêu đề', null), 'tieu de ', 'Mô tả null không làm mất tiêu đề');

-- ===========================================================================
-- Mẫu LIKE: tách từ, thoát \ % _
-- ===========================================================================
select is(private.search_patterns('  50%   a_b  c\d '), array['%50\%%', '%a\_b%', '%c\\d%'],
  'Thoát % _ \ trong từng từ khóa');
select is(private.search_patterns('Báo  CÁO tháng'), array['%thang%', '%bao%', '%cao%'],
  'Bỏ dấu, tách theo khoảng trắng, từ dài trước');
select is(private.search_patterns(''), null, 'Chuỗi rỗng: không có mẫu');
select is(private.search_patterns(E' \t '), null, 'Chỉ khoảng trắng: không có mẫu');
select is(private.search_patterns(repeat('a', 201)), null, 'Quá 200 ký tự: không có mẫu');
select isnt(private.search_patterns(repeat('a', 200)), null, 'Đúng 200 ký tự: có mẫu');

-- ===========================================================================
-- Chỉ mục dùng được với đúng biểu thức
-- ===========================================================================
set local enable_seqscan = off;
select matches(
  tests.plan_text($$select id from public.tasks
    where private.task_search_text(title, description) like '%bao cao%'$$),
  'tasks_search_trgm_idx',
  'Truy vấn LIKE trên task_search_text dùng chỉ mục trigram');
reset enable_seqscan;

-- ===========================================================================
-- AC1: có dấu, không dấu, hoa thường đều ra kết quả (Thành viên dự án A)
-- ===========================================================================
select tests.login_as(tests.uid('member_a'));
select is(tests.search('project_a', 'bao cao'), tests.sts('t1'), 'Không dấu tìm ra "Báo cáo"');
select is(tests.search('project_a', 'Báo cáo'), tests.sts('t1'), 'Có dấu tìm ra "Báo cáo"');
select is(tests.search('project_a', 'BÁO CÁO'), tests.sts('t1'), 'Chữ hoa có dấu');
select is(tests.search('project_a', 'BAO CAO'), tests.sts('t1'), 'Chữ hoa không dấu');
select is(tests.search('project_a', 'bào cạo'), tests.sts('t1'), 'Gõ sai dấu vẫn khớp (bỏ dấu cả hai phía)');
select is(tests.search('project_a', 'duong'), tests.sts('t2', 't6'), '"duong" khớp "Đường"');
select is(tests.search('project_a', 'ĐƯỜNG'), tests.sts('t2', 't6'), '"ĐƯỜNG" khớp "Đường"');
select is(tests.search('project_a', 'uu tien'), tests.sts('t2'), 'Tìm trong mô tả, ư thành u');
select is(tests.search('project_a', 'ơn GIỜI'), tests.sts('t2'), 'ơ, dấu huyền trong mô tả');
select is(tests.search('project_a', 'co so du lieu'), tests.sts('t3'), '"co so du lieu" khớp "cơ sở dữ liệu"');
select is(tests.search('project_a', 'bảo trì'), tests.sts('t7'), 'Từ khóa NFC khớp tiêu đề NFD');
select is(tests.search('project_a', 'ky thuat'), tests.sts('t7'), 'ỹ, ậ trong tiêu đề NFD');
select is(tests.search('project_a', 'tien do'), tests.sts('t1'), 'Khớp giữa tiêu đề (chứa chuỗi)');
select is(tests.search('project_a', 'thán'), tests.sts('t1', 't4'), 'Khớp một phần từ ("tháng", "thành")');

-- Mọi từ khóa phải có (AND), không phụ thuộc thứ tự.
select is(tests.search('project_a', 'bao cao thang'), tests.sts('t1'), 'Ba từ cùng có');
select is(tests.search('project_a', 'thang bao'), tests.sts('t1'), 'Đảo thứ tự từ');
select is(tests.search('project_a', 'bao cao quy'), '{}'::uuid[], 'Một từ không có: không khớp');
select is(tests.search('project_a', 'duong truyen'), tests.sts('t2'), 'Hai từ thu hẹp kết quả');

-- Lọc nhãn trong hàm (p_label_id) kết hợp AND với từ khóa.
select is(
  array(select id from public.search_tasks(tests.uid('project_a'), 'bao cao',
    '00000000-0000-0000-0000-000000009001')),
  tests.sts('t1'), 'Từ khóa và nhãn cùng khớp');
select is(
  array(select id from public.search_tasks(tests.uid('project_a'), 'duong',
    '00000000-0000-0000-0000-000000009001')),
  '{}'::uuid[], 'Từ khóa khớp nhưng task không có nhãn: không khớp');

-- Ký tự đặc biệt của LIKE được hiểu theo nghĩa đen.
select is(tests.search('project_a', '%'), tests.sts('t4'), '"%" chỉ khớp task có dấu %');
select is(tests.search('project_a', '100%'), tests.sts('t4'), '"100%" khớp');
select is(tests.search('project_a', '_'), tests.sts('t5'), '"_" chỉ khớp task có dấu gạch dưới');
select is(tests.search('project_a', 'a_b'), tests.sts('t5'), '"a_b" khớp đúng');
select is(tests.search('project_a', 'a%b'), '{}'::uuid[], '"a%b" không khớp như ký tự đại diện');
select is(tests.search('project_a', '\'), tests.sts('t6'), '"\" khớp task có dấu gạch chéo ngược');
select is(tests.search('project_a', 'c:\temp'), tests.sts('t6'), '"c:\temp" khớp');

-- Ca biên.
select is(tests.search('project_a', ''), '{}'::uuid[], 'Chuỗi rỗng: tập rỗng');
select is(tests.search('project_a', '   '), '{}'::uuid[], 'Chỉ khoảng trắng: tập rỗng');
select is(tests.search('project_a', repeat('a', 201)), '{}'::uuid[], 'Quá 200 ký tự: tập rỗng');

-- ===========================================================================
-- RLS vẫn quyết định: người không thấy dự án không nhận gì dù từ khóa khớp
-- ===========================================================================
select is(tests.search('project_b', 'bao cao'), '{}'::uuid[], 'Thành viên A không tìm được task dự án B');
select is(
  (select count(*)::int from private.search_task_ids(tests.uid('project_b'), 'bao cao')),
  0, 'Gọi thẳng search_task_ids cho dự án không thuộc: rỗng');

select tests.login_as(tests.uid('viewer_a'));
select is(tests.search('project_a', 'bao cao'), tests.sts('t1'), 'Người xem A tìm được');

select tests.login_as(tests.uid('pm_a'));
select is(tests.search('project_b', 'bao cao'), tests.sts('t8'), 'pm_a (Người xem ở B) tìm được ở B');

select tests.login_as(tests.uid('admin'));
select is(tests.search('project_b', 'bao cao'), tests.sts('t8'), 'Admin tìm được ở mọi dự án');

select tests.login_as(tests.uid('outsider'));
select is(tests.search('project_a', 'bao cao'), '{}'::uuid[], 'Người ngoài: rỗng dù khớp');
select is(
  (select count(*)::int from private.search_task_ids(tests.uid('project_a'), 'bao cao')),
  0, 'Người ngoài gọi thẳng search_task_ids: rỗng');

select tests.login_as(tests.uid('locked'));
select is(tests.search('project_a', 'bao cao'), '{}'::uuid[], 'Người bị khóa: rỗng');

select tests.login_as(tests.uid('locked_admin'));
select is(tests.search('project_b', 'bao cao'), '{}'::uuid[], 'Admin bị khóa: rỗng');

select tests.login_anon();
select throws_ok(
  $$select * from public.search_tasks('00000000-0000-0000-0000-00000000000a', 'bao cao')$$,
  '42501', null, 'anon không gọi được search_tasks');

-- ===========================================================================
-- Ghi task vẫn chạy (biểu thức chỉ mục cần quyền EXECUTE) và kết quả tìm cập nhật theo
-- ===========================================================================
select tests.login_as(tests.uid('member_a'));
select lives_ok(
  $$insert into public.tasks (project_id, title) values
    ('00000000-0000-0000-0000-00000000000a', 'Nghiệm thu đợt một')$$,
  'Thành viên tạo task được');
select is(
  (select count(*)::int from public.search_tasks(tests.uid('project_a'), 'nghiem thu')),
  1, 'Task mới tìm được ngay');

select tests.logout();
select * from finish();
rollback;
