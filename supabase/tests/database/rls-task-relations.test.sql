-- QLDA-55 (Story E8-1): RLS, quyền cột, ràng buộc và trigger của bảng task_relations.
-- Chính sách: PM, Thành viên sửa được cả hai task, Thành viên chỉ sửa được một, Thành viên không
-- sửa được task nào, Người xem, Admin (không thuộc dự án), người ngoài, người bị khóa, Admin bị
-- khóa, anon. Quy tắc: tự quan hệ, trùng, relates đối xứng, khác dự án, lag_days, vòng trực tiếp và
-- gián tiếp (blocks + precedes chung một đồ thị, BR-05), xóa task thì quan hệ mất.
begin;
\ir _helpers.psql
select tests.seed_fixture();

-- Dữ liệu:
--   member2  (…c2) Thành viên A, không tạo, không phụ trách task nào
--   t_m1     (…8001) A, member_a tạo
--   t_m2     (…8002) A, pm_a tạo, giao member_a
--   t_p1..3  (…8003-8005) A, pm_a tạo
--   t_l1, t_l2 (…8006-8007) A, locked tạo (trước khi bị khóa)
--   t_b      (…8008) B, pm_b tạo
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000c2', 'member2_a@test.example', '{"full_name":"Member 2 A"}');
insert into public.project_members (project_id, user_id, role) values
  (tests.uid('project_a'), '00000000-0000-0000-0000-0000000000c2', 'member');

create function tests.r(name text)
returns uuid
language sql
immutable
as $$
  select case name
    when 'member2' then '00000000-0000-0000-0000-0000000000c2'
    when 't_m1' then '00000000-0000-0000-0000-000000008001'
    when 't_m2' then '00000000-0000-0000-0000-000000008002'
    when 't_p1' then '00000000-0000-0000-0000-000000008003'
    when 't_p2' then '00000000-0000-0000-0000-000000008004'
    when 't_p3' then '00000000-0000-0000-0000-000000008005'
    when 't_l1' then '00000000-0000-0000-0000-000000008006'
    when 't_l2' then '00000000-0000-0000-0000-000000008007'
    when 't_b' then '00000000-0000-0000-0000-000000008008'
  end::uuid;
$$;
grant execute on function tests.r(text) to anon, authenticated;

-- Thêm quan hệ với vai trò hiện tại (câu lệnh SQL để dùng trong lives_ok/throws_ok).
create function tests.rel_sql(from_name text, to_name text, kind text, lag integer default 0)
returns text
language sql
immutable
as $$
  select format(
    'insert into public.task_relations (from_task_id, to_task_id, kind, lag_days) values (%L, %L, %L, %s)',
    tests.r(from_name), tests.r(to_name), kind, lag);
$$;
grant execute on function tests.rel_sql(text, text, text, integer) to anon, authenticated;

insert into public.tasks (id, project_id, title, created_by, assignee_id) values
  (tests.r('t_m1'), tests.uid('project_a'), 'M1', tests.uid('member_a'), null),
  (tests.r('t_m2'), tests.uid('project_a'), 'M2', tests.uid('pm_a'), tests.uid('member_a')),
  (tests.r('t_p1'), tests.uid('project_a'), 'P1', tests.uid('pm_a'), null),
  (tests.r('t_p2'), tests.uid('project_a'), 'P2', tests.uid('pm_a'), null),
  (tests.r('t_p3'), tests.uid('project_a'), 'P3', tests.uid('pm_a'), null),
  (tests.r('t_l1'), tests.uid('project_a'), 'L1', tests.uid('locked'), null),
  (tests.r('t_l2'), tests.uid('project_a'), 'L2', tests.uid('locked'), null),
  (tests.r('t_b'), tests.uid('project_b'), 'B', tests.uid('pm_b'), null);

select plan(71);

-- ===========================================================================
-- Cấu trúc
-- ===========================================================================
select has_table('public', 'task_relations', 'Có bảng public.task_relations');
select col_type_is('public', 'task_relations', 'kind', 'task_relation_kind', 'kind dùng enum');
select is(enum_range(null::public.task_relation_kind)::text, '{relates,blocks,precedes,duplicates}',
  'Đủ 4 kiểu theo hợp đồng');
select col_default_is('public', 'task_relations', 'lag_days', '0', 'lag_days mặc định 0');
select has_index('public', 'task_relations', 'task_relations_to_task_id_idx', 'Chỉ mục theo to_task_id');
select has_index('public', 'task_relations', 'task_relations_unique', 'Duy nhất (from, to, kind)');
select has_index('public', 'task_relations', 'task_relations_relates_pair_key',
  'relates duy nhất theo cặp không thứ tự');
select is((select relrowsecurity from pg_class where oid = 'public.task_relations'::regclass), true,
  'RLS bật trên task_relations');
select ok(not has_table_privilege('authenticated', 'public.task_relations', 'update'),
  'authenticated không có quyền UPDATE');
select ok(not has_column_privilege('authenticated', 'public.task_relations', 'created_by', 'insert'),
  'authenticated không ghi được created_by');
select ok(not has_table_privilege('anon', 'public.task_relations', 'select'),
  'anon không có quyền đọc');

-- can_edit_task khớp đúng chính sách tasks_update cho mọi persona và mọi task (UPDATE không đổi giá
-- trị nên không ghi nhật ký; rollback cuối tệp).
create function tests.edit_mismatches()
returns text
language plpgsql
as $$
declare
  who text;
  task text;
  via_policy boolean;
  via_fn boolean;
  bad text := '';
begin
  foreach who in array array['admin', 'pm_a', 'pm_b', 'member_a', 'viewer_a', 'outsider', 'locked', 'locked_admin'] loop
    foreach task in array array['t_m1', 't_m2', 't_p1', 't_l1', 't_b'] loop
      perform tests.login_as(tests.uid(who));
      via_fn := private.can_edit_task(tests.r(task));
      via_policy := tests.affected_rows(format(
        'update public.tasks set title = title where id = %L', tests.r(task))) = 1;
      perform tests.logout();
      if via_fn is distinct from via_policy then
        bad := bad || format('%s/%s fn=%s policy=%s; ', who, task, via_fn, via_policy);
      end if;
    end loop;
  end loop;
  return bad;
end;
$$;
select is(tests.edit_mismatches(), '', 'private.can_edit_task trùng điều kiện tasks_update');

-- ===========================================================================
-- INSERT: cần quyền sửa CẢ HAI task
-- ===========================================================================
select tests.login_as(tests.uid('pm_a'));
select lives_ok(tests.rel_sql('t_p1', 't_p2', 'blocks'), 'PM: P1 chặn P2');
select is((select created_by from public.task_relations where from_task_id = tests.r('t_p1')
  and kind = 'blocks'), tests.uid('pm_a'), 'created_by tự lấy auth.uid()');
select throws_ok(format(
  'insert into public.task_relations (from_task_id, to_task_id, kind, created_by) values (%L, %L, ''relates'', %L)',
  tests.r('t_p1'), tests.r('t_p3'), tests.uid('member_a')),
  '42501', null, 'Không giả mạo created_by (không có quyền cột)');

select tests.login_as(tests.uid('member_a'));
select lives_ok(tests.rel_sql('t_m1', 't_m2', 'relates'),
  'Thành viên tạo (M1) và phụ trách (M2): đặt quan hệ được');
select throws_ok(tests.rel_sql('t_m1', 't_p1', 'blocks'), '42501', null,
  'Thành viên chỉ sửa được một task: bị từ chối');
select throws_ok(tests.rel_sql('t_p1', 't_m1', 'blocks'), '42501', null,
  'Thành viên chỉ sửa được một task (chiều ngược): bị từ chối');

select tests.login_as(tests.r('member2'));
select throws_ok(tests.rel_sql('t_p1', 't_p3', 'relates'), '42501', null,
  'Thành viên không sửa được task nào: bị từ chối');

select tests.login_as(tests.uid('viewer_a'));
select throws_ok(tests.rel_sql('t_p1', 't_p3', 'relates'), '42501', null, 'Người xem không đặt quan hệ');

select tests.login_as(tests.uid('admin'));
select lives_ok(tests.rel_sql('t_p2', 't_p3', 'precedes', 2),
  'Admin (không thuộc dự án): P2 đứng trước P3, trễ 2 ngày');

select tests.login_as(tests.uid('outsider'));
select throws_ok(tests.rel_sql('t_p1', 't_p3', 'relates'), '42501', null, 'Người ngoài dự án bị từ chối');

select tests.login_as(tests.uid('locked'));
select throws_ok(tests.rel_sql('t_l1', 't_l2', 'relates'), '42501', null,
  'Người bị khóa không đặt quan hệ giữa task mình tạo');

select tests.login_as(tests.uid('locked_admin'));
select throws_ok(tests.rel_sql('t_p1', 't_p3', 'relates'), '42501', null, 'Admin bị khóa bị từ chối');

select tests.login_anon();
select throws_ok(tests.rel_sql('t_p1', 't_p3', 'relates'), '42501', null, 'anon bị từ chối');

-- ===========================================================================
-- Ràng buộc: tự quan hệ, trùng, relates đối xứng, lag_days, khác dự án
-- ===========================================================================
select tests.login_as(tests.uid('pm_a'));
select throws_ok(tests.rel_sql('t_p1', 't_p1', 'relates'), '23514', null, 'Không tự quan hệ');
select throws_ok(tests.rel_sql('t_p1', 't_p1', 'blocks'), '23514', null,
  'Tự chặn chính mình: lỗi tự quan hệ (không phải vòng)');
select throws_ok(tests.rel_sql('t_p1', 't_p2', 'blocks'), '23505', null, 'Trùng (from, to, kind)');
select lives_ok(tests.rel_sql('t_p1', 't_p2', 'precedes'),
  'Cùng cặp, kiểu khác (precedes) vẫn được');
select lives_ok(tests.rel_sql('t_p1', 't_p3', 'relates'), 'P1 liên quan P3');
select throws_ok(tests.rel_sql('t_p3', 't_p1', 'relates'), '23505', null,
  'relates đối xứng: P3 liên quan P1 trùng với P1 liên quan P3');
select lives_ok(tests.rel_sql('t_p3', 't_p1', 'duplicates'), 'duplicates có hướng, không chống vòng');
select lives_ok(tests.rel_sql('t_p1', 't_p3', 'duplicates'), 'duplicates hai chiều được phép');
select throws_ok(tests.rel_sql('t_p2', 't_m1', 'blocks', 3), '23514', null,
  'lag_days khác 0 chỉ cho precedes');
select throws_ok(tests.rel_sql('t_p2', 't_m1', 'precedes', 366), '23514', null,
  'lag_days ngoài ±365 bị từ chối');
select lives_ok(tests.rel_sql('t_p2', 't_m1', 'precedes', -3), 'lag_days âm (chồng lấn) được');

select tests.login_as(tests.uid('admin'));
select throws_ok(tests.rel_sql('t_p1', 't_b', 'relates'), 'P0001', 'task_relation_cross_project',
  'Admin: hai task khác dự án bị từ chối');
select tests.login_as(tests.uid('pm_b'));
select throws_ok(tests.rel_sql('t_b', 't_p1', 'blocks'), '42501', null,
  'PM dự án B với task dự án A: 42501, không lộ lỗi khác dự án');
select tests.logout();
select throws_ok(tests.rel_sql('t_b', 't_p1', 'relates'), 'P0001', 'task_relation_cross_project',
  'Đường hệ thống (không auth.uid) vẫn kiểm cùng dự án');

-- ===========================================================================
-- Chống vòng (BR-05). Đồ thị hiện có: P1 -blocks-> P2, P1 -precedes-> P2, P2 -precedes-> P3,
-- P2 -precedes-> M1. relates/duplicates không tính.
-- ===========================================================================
select tests.login_as(tests.uid('pm_a'));
select throws_ok(tests.rel_sql('t_p2', 't_p1', 'blocks'), 'P0001', 'task_relation_cycle',
  'Vòng trực tiếp: P2 chặn P1 khi P1 chặn P2');
select throws_ok(tests.rel_sql('t_p2', 't_p1', 'precedes'), 'P0001', 'task_relation_cycle',
  'Vòng trực tiếp khác kiểu: P2 đứng trước P1 khi P1 chặn P2');
select throws_ok(tests.rel_sql('t_p3', 't_p1', 'blocks'), 'P0001', 'task_relation_cycle',
  'Vòng gián tiếp P1→P2→P3→P1 (blocks + precedes chung đồ thị)');
select throws_ok(tests.rel_sql('t_m1', 't_p1', 'precedes'), 'P0001', 'task_relation_cycle',
  'Vòng gián tiếp qua M1');
select lives_ok(tests.rel_sql('t_p2', 't_p1', 'relates'),
  'relates ngược chiều không phải vòng');
select lives_ok(tests.rel_sql('t_p3', 't_m1', 'blocks'),
  'Hai đường cùng tới M1 (kim cương) không phải vòng');

select tests.login_as(tests.uid('outsider'));
select throws_ok(tests.rel_sql('t_p3', 't_p1', 'blocks'), '42501', null,
  'Người ngoài thử cạnh đóng vòng: 42501, không lộ có vòng');

select tests.logout();
select throws_ok(tests.rel_sql('t_p3', 't_p1', 'blocks'), 'P0001', 'task_relation_cycle',
  'Đường hệ thống (service_role, migration) vẫn bị chống vòng');
select throws_ok(format(
  'update public.task_relations set to_task_id = %L where from_task_id = %L and to_task_id = %L and kind = ''blocks''',
  tests.r('t_p1'), tests.r('t_p3'), tests.r('t_m1')), 'P0001', 'task_relation_cycle',
  'UPDATE (chỉ hệ thống) cũng bị chống vòng');

-- ===========================================================================
-- SELECT: thấy được cả hai task
-- ===========================================================================
-- Hiện có trong A: 1 relates(M1,M2), 4 blocks/precedes P, 1 precedes P2→M1, 1 relates P1-P3,
-- 2 duplicates, 1 relates P2-P1, 1 blocks P3→M1 = 10.
select tests.logout();
select is((select count(*)::int from public.task_relations), 10, 'Dữ liệu: 10 quan hệ');

select tests.login_as(tests.uid('pm_a'));
select is((select count(*)::int from public.task_relations), 10, 'PM đọc mọi quan hệ của dự án');
select tests.login_as(tests.uid('member_a'));
select is((select count(*)::int from public.task_relations), 10, 'Thành viên đọc mọi quan hệ');
select tests.login_as(tests.r('member2'));
select is((select count(*)::int from public.task_relations), 10,
  'Thành viên không sửa được task nào vẫn đọc');
select tests.login_as(tests.uid('viewer_a'));
select is((select count(*)::int from public.task_relations), 10, 'Người xem đọc được');
select tests.login_as(tests.uid('admin'));
select is((select count(*)::int from public.task_relations), 10, 'Admin đọc được');
select tests.login_as(tests.uid('pm_b'));
select is_empty('select 1 from public.task_relations', 'PM dự án khác không thấy quan hệ của A');
select tests.login_as(tests.uid('outsider'));
select is_empty('select 1 from public.task_relations', 'Người ngoài không thấy');
select tests.login_as(tests.uid('locked'));
select is_empty('select 1 from public.task_relations', 'Người bị khóa không thấy');
select tests.login_as(tests.uid('locked_admin'));
select is_empty('select 1 from public.task_relations', 'Admin bị khóa không thấy');
select tests.login_anon();
select throws_ok('select 1 from public.task_relations', '42501', null, 'anon không đọc được');

-- ===========================================================================
-- DELETE: cần quyền sửa cả hai task; UPDATE không có
-- ===========================================================================
select tests.logout();
create function tests.del_sql(from_name text, to_name text, kind text)
returns text
language sql
immutable
as $$
  select format(
    'delete from public.task_relations where from_task_id = %L and to_task_id = %L and kind = %L',
    tests.r(from_name), tests.r(to_name), kind);
$$;
grant execute on function tests.del_sql(text, text, text) to anon, authenticated;

select tests.login_as(tests.uid('pm_a'));
select throws_ok(format('update public.task_relations set lag_days = 1 where from_task_id = %L',
  tests.r('t_p2')), '42501', null, 'Không ai UPDATE được (không cấp quyền)');

select tests.login_as(tests.uid('viewer_a'));
select is(tests.affected_rows(tests.del_sql('t_m1', 't_m2', 'relates')), 0, 'Người xem không xóa được');
select tests.login_as(tests.r('member2'));
select is(tests.affected_rows(tests.del_sql('t_m1', 't_m2', 'relates')), 0,
  'Thành viên không sửa được task nào không xóa được');
select tests.login_as(tests.uid('outsider'));
select is(tests.affected_rows(tests.del_sql('t_p1', 't_p2', 'blocks')), 0, 'Người ngoài không xóa được');
select tests.login_as(tests.uid('locked'));
select is(tests.affected_rows(tests.del_sql('t_m1', 't_m2', 'relates')), 0, 'Người bị khóa không xóa được');
select tests.login_as(tests.uid('member_a'));
select is(tests.affected_rows(tests.del_sql('t_p2', 't_m1', 'precedes')), 0,
  'Thành viên chỉ sửa được một task không xóa được');
select is(tests.affected_rows(tests.del_sql('t_m1', 't_m2', 'relates')), 1,
  'Thành viên sửa được cả hai task: xóa được');
select tests.login_as(tests.uid('pm_a'));
select is(tests.affected_rows(tests.del_sql('t_p1', 't_p2', 'blocks')), 1, 'PM xóa được');
select tests.login_as(tests.uid('admin'));
select is(tests.affected_rows(tests.del_sql('t_p1', 't_p2', 'precedes')), 1, 'Admin xóa được');
-- Bỏ hai cạnh P1→P2 thì cạnh P2→P1 không còn đóng vòng.
select tests.login_as(tests.uid('pm_a'));
select lives_ok(tests.rel_sql('t_p2', 't_p1', 'blocks'), 'Sau khi bỏ cạnh, chiều ngược đặt được');

-- ===========================================================================
-- Xóa task thì quan hệ mất (ON DELETE CASCADE)
-- ===========================================================================
select tests.logout();
select ok((select count(*) from public.task_relations
  where tests.r('t_p3') in (from_task_id, to_task_id)) > 0, 'P3 đang có quan hệ');
delete from public.tasks where id = tests.r('t_p3');
select is((select count(*)::int from public.task_relations
  where tests.r('t_p3') in (from_task_id, to_task_id)), 0, 'Xóa P3 thì mọi quan hệ của P3 mất');

select * from finish();
rollback;
