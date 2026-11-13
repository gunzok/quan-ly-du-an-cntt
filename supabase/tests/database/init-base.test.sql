-- Kiểm tra tiêu chí chấp nhận 1 của Story E0-1 (QLDA-27): sau migration, CSDL có
-- extension, kiểu enum dùng chung và hàm tiện ích. Chạy: `make db-test` (supabase test db).
begin;
create extension if not exists pgtap with schema extensions;

select plan(8);

select has_extension('extensions', 'unaccent', 'Có extension unaccent trong schema extensions');
select is(extensions.unaccent('Tiến độ dự án'), 'Tien do du an', 'unaccent bỏ được dấu tiếng Việt');

select enum_has_labels('public', 'project_role', array['pm', 'member', 'viewer'],
  'Enum project_role đúng thứ tự giá trị');
select enum_has_labels('public', 'task_priority', array['low', 'medium', 'high', 'urgent'],
  'Enum task_priority đúng thứ tự giá trị');

select function_returns('public', 'set_updated_at', array[]::text[], 'trigger',
  'set_updated_at() trả về trigger');
select is(
  (select proconfig from pg_proc where oid = 'public.set_updated_at()'::regprocedure),
  array['search_path=""'],
  'set_updated_at() cố định search_path rỗng');

-- Hàm hoạt động thật: bảng tạm có trigger, cập nhật thì updated_at đổi sang now().
create temp table t_updated_at_probe (
  id int primary key,
  note text,
  updated_at timestamptz not null default '2000-01-01'
);
create trigger set_updated_at before update on t_updated_at_probe
  for each row execute function public.set_updated_at();
insert into t_updated_at_probe (id, note) values (1, 'a');
update t_updated_at_probe set note = 'b' where id = 1;
select is((select updated_at from t_updated_at_probe where id = 1), now(),
  'Trigger gán updated_at = now() khi UPDATE');

-- Từ QLDA-32 schema public đã có bảng nghiệp vụ, nên thay kiểm tra "chưa có bảng" bằng
-- bất biến áp cho mọi bảng về sau: không bảng nào trong public được thiếu RLS.
select is(
  (select array_agg(tablename::text order by tablename) from pg_tables
    where schemaname = 'public' and not rowsecurity),
  null,
  'Mọi bảng trong schema public đều bật RLS');

select * from finish();
rollback;
