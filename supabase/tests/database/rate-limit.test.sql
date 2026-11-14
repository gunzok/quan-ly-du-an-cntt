-- QLDA-44 (Story E0-5): bộ đếm giới hạn tần suất (private.rate_limit_counters,
-- private.rate_limit_hit, wrapper public.rate_limit_hit). Kiểm: quyền gọi, cấu hình an toàn,
-- đếm và chặn theo cửa sổ, cô lập theo khóa, kiểm tham số, tự dọn dòng hết hạn.
begin;
\ir _helpers.psql

select plan(24);

-- ===========================================================================
-- Cấu trúc và cấu hình an toàn
-- ===========================================================================
select has_table('private', 'rate_limit_counters', 'Bảng bộ đếm nằm trong schema private');
select is(
  (select relrowsecurity from pg_class where oid = 'private.rate_limit_counters'::regclass),
  true,
  'RLS bật trên bảng bộ đếm (không có chính sách nào)');
select is(
  (select count(*)::int from pg_policies where schemaname = 'private' and tablename = 'rate_limit_counters'),
  0,
  'Không có chính sách RLS: chỉ chủ sở hữu (qua hàm SECURITY DEFINER) truy cập');

select is(
  (select prosecdef from pg_proc where oid = 'private.rate_limit_hit(text,integer,integer)'::regprocedure),
  true,
  'private.rate_limit_hit là SECURITY DEFINER');
select is(
  (select proconfig from pg_proc where oid = 'private.rate_limit_hit(text,integer,integer)'::regprocedure),
  array['search_path=""'],
  'private.rate_limit_hit có search_path rỗng');
select is(
  (select prosecdef from pg_proc where oid = 'public.rate_limit_hit(text,integer,integer)'::regprocedure),
  false,
  'Wrapper public.rate_limit_hit là SECURITY INVOKER');

-- ===========================================================================
-- Quyền gọi: chỉ service_role
-- ===========================================================================
select ok(
  has_function_privilege('service_role', 'public.rate_limit_hit(text,integer,integer)', 'execute'),
  'service_role gọi được public.rate_limit_hit');
select ok(
  not has_function_privilege('anon', 'public.rate_limit_hit(text,integer,integer)', 'execute'),
  'anon KHÔNG gọi được public.rate_limit_hit');
select ok(
  not has_function_privilege('authenticated', 'public.rate_limit_hit(text,integer,integer)', 'execute'),
  'authenticated KHÔNG gọi được public.rate_limit_hit');
select ok(
  not has_function_privilege('authenticated', 'private.rate_limit_hit(text,integer,integer)', 'execute'),
  'authenticated KHÔNG gọi được private.rate_limit_hit');
select ok(
  not has_table_privilege('service_role', 'private.rate_limit_counters', 'select')
    and not has_table_privilege('authenticated', 'private.rate_limit_counters', 'select')
    and not has_table_privilege('anon', 'private.rate_limit_counters', 'select'),
  'Không vai trò API nào đọc thẳng được bảng bộ đếm');

select tests.login_as('00000000-0000-0000-0000-0000000000a1');
select throws_ok(
  $$ select * from public.rate_limit_hit('t:auth', 5, 60) $$,
  '42501', null,
  'Người dùng đã đăng nhập gọi hàm: bị từ chối (42501)');
select tests.login_anon();
select throws_ok(
  $$ select * from public.rate_limit_hit('t:anon', 5, 60) $$,
  '42501', null,
  'Khách gọi hàm: bị từ chối (42501)');
select tests.logout();

-- ===========================================================================
-- Đếm và chặn (chạy với vai trò service_role như API máy chủ)
-- ===========================================================================
set local role service_role;

select is(
  (select row(allowed, remaining)::text from public.rate_limit_hit('t:a', 2, 60)),
  '(t,1)', 'Lượt 1/2: cho qua, còn 1');
select is(
  (select row(allowed, remaining)::text from public.rate_limit_hit('t:a', 2, 60)),
  '(t,0)', 'Lượt 2/2: cho qua, còn 0');
select is(
  (select row(allowed, remaining)::text from public.rate_limit_hit('t:a', 2, 60)),
  '(f,0)', 'Lượt 3/2: bị chặn');
select ok(
  (select retry_after_seconds between 1 and 60 from public.rate_limit_hit('t:a', 2, 60)),
  'Thời gian chờ nằm trong độ dài cửa sổ');
select is(
  (select row(allowed, remaining)::text from public.rate_limit_hit('t:b', 2, 60)),
  '(t,1)', 'Khóa khác không bị ảnh hưởng');

select throws_ok(
  $$ select * from public.rate_limit_hit('', 2, 60) $$,
  '22023', 'rate_limit_hit: invalid key', 'Khóa rỗng bị từ chối');
select throws_ok(
  $$ select * from public.rate_limit_hit(repeat('x', 201), 2, 60) $$,
  '22023', 'rate_limit_hit: invalid key', 'Khóa quá dài bị từ chối');
select throws_ok(
  $$ select * from public.rate_limit_hit('t:c', 0, 60) $$,
  '22023', 'rate_limit_hit: invalid limit', 'Ngưỡng 0 bị từ chối');
select throws_ok(
  $$ select * from public.rate_limit_hit('t:c', 1, 0) $$,
  '22023', 'rate_limit_hit: invalid window', 'Cửa sổ 0 giây bị từ chối');

reset role;

-- ===========================================================================
-- Tự dọn dòng hết hạn
-- ===========================================================================
insert into private.rate_limit_counters (key, window_start, hits, expires_at) values
  ('t:old', now() - interval '2 hours', 3, now() - interval '1 hour'),
  ('t:old2', now() - interval '10 minutes', 1, now() - interval '1 second');

set local role service_role;
select * from public.rate_limit_hit('t:trigger-cleanup', 5, 60);
reset role;

select is(
  (select count(*)::int from private.rate_limit_counters where key in ('t:old', 't:old2')),
  0,
  'Gọi hàm dọn các dòng đã hết hạn');
select is(
  (select count(*)::int from private.rate_limit_counters where key in ('t:a', 't:b', 't:trigger-cleanup')),
  3,
  'Dòng của cửa sổ đang chạy được giữ lại');

select * from finish();
rollback;
