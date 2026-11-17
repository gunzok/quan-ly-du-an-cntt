-- QLDA-43 (Story E2-6): ma trận quyền task theo vai trò (BR-02, BR-03; database.md mục 5).
-- Mỗi ca là một persona đứng trước một task cụ thể; mỗi thao tác chạy trong giao dịch con rồi
-- hủy (dữ liệu không đổi giữa các thao tác), kết quả chuẩn hóa thành:
--   ok    câu lệnh có tác dụng (≥ 1 dòng, hoặc hàm chạy xong)
--   deny  RLS lọc mất dòng (0 dòng) hoặc lỗi quyền 42501 (RLS, quyền cột, trigger chống dò)
--   <sqlstate>:<thông điệp> với mọi lỗi khác (để test đỏ và lộ ra lỗi lạ)
-- Thao tác: sửa từng trường, đổi trạng thái (kể cả sang nhóm done), đổi loại, giao/gỡ người phụ
-- trách, đặt cha, tạo việc con, gắn/gỡ/đặt lại nhãn, thêm/xóa quan hệ, xóa task, tạo task.
-- Persona: Admin (không thuộc dự án), PM, Thành viên là người tạo, Thành viên là người phụ trách,
-- Thành viên khác, Người xem, PM của dự án khác, PM là Người xem ở dự án kia, người ngoài, người
-- bị khóa (là người tạo task), Admin bị khóa, anon.
begin;
\ir _helpers.psql
select tests.seed_fixture();

-- Dữ liệu:
--   member2  (…c2) Thành viên A, không tạo, không phụ trách task nào
--   task_m   (…9001) A, member_a tạo, chưa giao
--   task_as  (…9002) A, pm_a tạo, giao member_a
--   task_pm  (…9003) A, pm_a tạo, chưa giao
--   task_par (…9004) A, member_a tạo: cha mới và đầu kia của quan hệ cho task ở A
--   task_l   (…9005) A, locked tạo (người tạo nay bị khóa)
--   task_b   (…9006) B, pm_b tạo
--   task_b2  (…9007) B, pm_b tạo: đầu kia của quan hệ cho task ở B
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000c2', 'member2_a@test.example', '{"full_name":"Member 2 A"}');
insert into public.project_members (project_id, user_id, role) values
  (tests.uid('project_a'), '00000000-0000-0000-0000-0000000000c2', 'member');

create function tests.m(name text)
returns uuid
language sql
immutable
as $$
  select case name
    when 'member2' then '00000000-0000-0000-0000-0000000000c2'
    when 'task_m' then '00000000-0000-0000-0000-000000009001'
    when 'task_as' then '00000000-0000-0000-0000-000000009002'
    when 'task_pm' then '00000000-0000-0000-0000-000000009003'
    when 'task_par' then '00000000-0000-0000-0000-000000009004'
    when 'task_l' then '00000000-0000-0000-0000-000000009005'
    when 'task_b' then '00000000-0000-0000-0000-000000009006'
    when 'task_b2' then '00000000-0000-0000-0000-000000009007'
  end::uuid;
$$;
grant execute on function tests.m(text) to anon, authenticated;

insert into public.tasks (id, project_id, title, created_by, assignee_id) values
  (tests.m('task_m'), tests.uid('project_a'), 'M', tests.uid('member_a'), null),
  (tests.m('task_as'), tests.uid('project_a'), 'AS', tests.uid('pm_a'), tests.uid('member_a')),
  (tests.m('task_pm'), tests.uid('project_a'), 'PM', tests.uid('pm_a'), null),
  (tests.m('task_par'), tests.uid('project_a'), 'PAR', tests.uid('member_a'), null),
  (tests.m('task_l'), tests.uid('project_a'), 'L', tests.uid('locked'), null),
  (tests.m('task_b'), tests.uid('project_b'), 'B', tests.uid('pm_b'), null),
  (tests.m('task_b2'), tests.uid('project_b'), 'B2', tests.uid('pm_b'), null);

insert into public.labels (project_id, name) values
  (tests.uid('project_a'), 'Ma trận 1'), (tests.uid('project_a'), 'Ma trận 2'),
  (tests.uid('project_b'), 'Ma trận 1'), (tests.uid('project_b'), 'Ma trận 2');

-- Nhãn, trạng thái, loại của dự án theo tên.
create function tests.label_of(p_project uuid, p_name text)
returns uuid
language sql
stable
as $$ select id from public.labels where project_id = p_project and name = p_name $$;
create function tests.status_of(p_project uuid, p_name text)
returns uuid
language sql
stable
as $$ select id from public.task_statuses where project_id = p_project and name = p_name $$;
create function tests.type_of(p_project uuid, p_name text)
returns uuid
language sql
stable
as $$ select id from public.task_types where project_id = p_project and name = p_name $$;

-- Mỗi task đích có sẵn nhãn "Ma trận 2" (để thử gỡ) và quan hệ blocks tới đầu kia (để thử xóa).
insert into public.task_labels (task_id, label_id)
select t.id, tests.label_of(t.project_id, 'Ma trận 2')
from public.tasks t
where t.id in (tests.m('task_m'), tests.m('task_as'), tests.m('task_pm'), tests.m('task_l'),
               tests.m('task_b'));
insert into public.task_relations (from_task_id, to_task_id, kind, created_by)
select t.id,
       case when t.project_id = tests.uid('project_b') then tests.m('task_b2') else tests.m('task_par') end,
       'blocks', tests.uid('pm_a')
from public.tasks t
where t.id in (tests.m('task_m'), tests.m('task_as'), tests.m('task_pm'), tests.m('task_l'),
               tests.m('task_b'));

-- Danh sách thao tác theo thứ tự cố định (dùng cho cả kết quả thực tế và kỳ vọng).
create function tests.ops()
returns text[]
language sql
immutable
as $$
  select array[
    'title', 'description', 'priority', 'dates', 'position',
    'status', 'complete', 'type',
    'assign', 'unassign',
    'parent', 'subtask',
    'label_add', 'label_remove', 'label_set',
    'relation_add', 'relation_remove',
    'delete', 'create'
  ];
$$;

-- Câu lệnh SQL của một thao tác trên task đích (chạy với vai trò của persona).
create function tests.op_sql(p_op text, p_task uuid)
returns text
language plpgsql
stable
as $$
declare
  v_project uuid;
  v_partner uuid;
begin
  select project_id into v_project from public.tasks where id = p_task;
  v_partner := case when v_project = tests.uid('project_b') then tests.m('task_b2') else tests.m('task_par') end;
  return case p_op
    when 'title' then format('update public.tasks set title = ''Đổi tên'' where id = %L', p_task)
    when 'description' then format('update public.tasks set description = ''Mô tả mới'' where id = %L', p_task)
    when 'priority' then format('update public.tasks set priority = ''urgent'' where id = %L', p_task)
    when 'dates' then format(
      'update public.tasks set start_date = ''2026-12-01'', due_date = ''2026-12-10'' where id = %L', p_task)
    when 'position' then format('update public.tasks set position = 42 where id = %L', p_task)
    when 'status' then format('update public.tasks set status_id = %L where id = %L',
      tests.status_of(v_project, 'Đang thực hiện'), p_task)
    when 'complete' then format('update public.tasks set status_id = %L where id = %L',
      tests.status_of(v_project, 'Đã xong'), p_task)
    when 'type' then format('update public.tasks set type_id = %L where id = %L',
      tests.type_of(v_project, 'Bug'), p_task)
    when 'assign' then format('update public.tasks set assignee_id = %L where id = %L',
      tests.uid('pm_a'), p_task)
    when 'unassign' then format('update public.tasks set assignee_id = null where id = %L', p_task)
    when 'parent' then format('update public.tasks set parent_id = %L where id = %L', v_partner, p_task)
    when 'subtask' then format(
      'insert into public.tasks (project_id, title, parent_id) values (%L, ''Việc con'', %L)', v_project, p_task)
    when 'label_add' then format('insert into public.task_labels (task_id, label_id) values (%L, %L)',
      p_task, tests.label_of(v_project, 'Ma trận 1'))
    when 'label_remove' then format('delete from public.task_labels where task_id = %L and label_id = %L',
      p_task, tests.label_of(v_project, 'Ma trận 2'))
    when 'label_set' then format('select public.set_task_labels(%L, array[%L]::uuid[])',
      p_task, tests.label_of(v_project, 'Ma trận 1'))
    when 'relation_add' then format(
      'insert into public.task_relations (from_task_id, to_task_id, kind) values (%L, %L, ''relates'')',
      p_task, v_partner)
    when 'relation_remove' then format(
      'delete from public.task_relations where from_task_id = %L and to_task_id = %L and kind = ''blocks''',
      p_task, v_partner)
    when 'delete' then format('delete from public.tasks where id = %L', p_task)
    when 'create' then format('insert into public.tasks (project_id, title) values (%L, ''Task mới'')', v_project)
  end;
end;
$$;

-- Chạy mọi thao tác cho một persona (who = 'anon' hoặc tên trong tests.uid / 'member2') trên task
-- đích. Mỗi thao tác trong giao dịch con bị hủy bằng lỗi P0099 nên không thao tác nào ảnh hưởng
-- thao tác sau. Biến plpgsql giữ giá trị sau khi giao dịch con bị hủy.
create function tests.run_case(p_who text, p_task uuid)
returns text
language plpgsql
as $$
declare
  v_op text;
  v_sql text;
  v_rows integer;
  v_outcome text;
  v_result text[] := '{}';
begin
  foreach v_op in array tests.ops() loop
    v_sql := tests.op_sql(v_op, p_task);
    v_outcome := null;
    begin
      if p_who = 'anon' then
        perform tests.login_anon();
      elsif p_who = 'member2' then
        perform tests.login_as(tests.m('member2'));
      else
        perform tests.login_as(tests.uid(p_who));
      end if;
      execute v_sql;
      get diagnostics v_rows = row_count;
      v_outcome := case when v_rows > 0 then 'ok' else 'deny' end;
      raise exception 'rollback_probe' using errcode = 'P0099';
    exception
      when sqlstate 'P0099' then null;
      when insufficient_privilege then v_outcome := 'deny';
      when others then v_outcome := sqlstate || ':' || sqlerrm;
    end;
    perform tests.logout();
    v_result := v_result || (v_op || '=' || v_outcome);
  end loop;
  return array_to_string(v_result, ' ');
end;
$$;

-- Kỳ vọng: mặc định p_default cho mọi thao tác, trừ các thao tác trong p_except (lấy giá trị ngược).
create function tests.expect(p_default text, p_except text[] default '{}')
returns text
language sql
immutable
as $$
  select string_agg(
    op || '=' || case when op = any (p_except)
                      then case p_default when 'ok' then 'deny' else 'ok' end
                      else p_default end,
    ' ' order by ord)
  from unnest(tests.ops()) with ordinality as o (op, ord);
$$;

select plan(20);

-- ===========================================================================
-- Ma trận persona × thao tác
-- ===========================================================================
select is(tests.run_case('admin', tests.m('task_pm')), tests.expect('ok'),
  'Admin (không thuộc dự án): mọi thao tác trên task');

select is(tests.run_case('pm_a', tests.m('task_m')), tests.expect('ok'),
  'PM: mọi thao tác trên task do Thành viên tạo (BR-03)');

select is(tests.run_case('member_a', tests.m('task_m')), tests.expect('ok'),
  'Thành viên là người tạo: sửa mọi trường, giao/gỡ người phụ trách, nhãn, cha, quan hệ, xóa (BR-03)');

select is(tests.run_case('member_a', tests.m('task_as')),
  tests.expect('ok', array['assign', 'unassign', 'delete']),
  'Thành viên chỉ là người phụ trách: sửa trường, trạng thái, nhãn, cha, quan hệ; '
  'không giao đi, không tự gỡ mình, không xóa (WITH CHECK = USING, BR-11)');

select is(tests.run_case('member2', tests.m('task_pm')), tests.expect('deny', array['create']),
  'Thành viên khác: chỉ tạo task mới; không sửa trường, trạng thái, nhãn, cha, quan hệ, '
  'không xóa task của người khác (AC1, BR-03)');

select is(tests.run_case('viewer_a', tests.m('task_m')), tests.expect('deny'),
  'Người xem: bị từ chối mọi thao tác ghi, kể cả tạo task (AC2, BR-02)');

select is(tests.run_case('pm_b', tests.m('task_m')), tests.expect('deny'),
  'PM của dự án khác: không có quyền gì ở dự án này');

select is(tests.run_case('pm_a', tests.m('task_b')), tests.expect('deny'),
  'PM ở A nhưng là Người xem ở B: chỉ đọc ở B (vai trò theo từng dự án)');

select is(tests.run_case('outsider', tests.m('task_m')), tests.expect('deny'),
  'Người ngoài dự án: bị từ chối mọi thao tác');

select is(tests.run_case('locked', tests.m('task_l')), tests.expect('deny'),
  'Người bị khóa: bị từ chối mọi thao tác, kể cả trên task mình tạo');

select is(tests.run_case('locked_admin', tests.m('task_pm')), tests.expect('deny'),
  'Admin bị khóa: bị từ chối mọi thao tác');

select is(tests.run_case('anon', tests.m('task_pm')), tests.expect('deny'),
  'anon: bị từ chối mọi thao tác');

-- Ma trận không để lại dấu vết (mọi thao tác đã bị hủy).
select tests.logout();
select results_eq(
  format('select title, priority::text, assignee_id, parent_id from public.tasks where id = %L',
    tests.m('task_as')),
  format('values (''AS''::text, ''medium''::text, %L::uuid, null::uuid)', tests.uid('member_a')),
  'Các thao tác thử không đổi dữ liệu thật');

-- ===========================================================================
-- Quyền đi theo dữ liệu hiện tại, không theo lịch sử (BR-03)
-- ===========================================================================
-- PM giao task_as cho member2: member_a mất quyền, member2 có quyền.
select tests.login_as(tests.uid('pm_a'));
update public.tasks set assignee_id = tests.m('member2') where id = tests.m('task_as');
select tests.login_as(tests.uid('member_a'));
select is(tests.affected_rows(format(
  'update public.tasks set title = ''x'' where id = %L', tests.m('task_as'))), 0,
  'Thành viên hết phụ trách thì không sửa được task nữa');
select tests.login_as(tests.m('member2'));
select is(tests.affected_rows(format(
  'update public.tasks set title = ''Member2 sửa'' where id = %L', tests.m('task_as'))), 1,
  'Thành viên vừa được giao thì sửa được ngay');

-- Người tạo vẫn sửa được dù đã giao task cho người khác.
select tests.login_as(tests.uid('member_a'));
update public.tasks set assignee_id = tests.m('member2') where id = tests.m('task_m');
select is(tests.affected_rows(format(
  'update public.tasks set title = ''Vẫn của tôi'' where id = %L', tests.m('task_m'))), 1,
  'Thành viên là người tạo vẫn sửa được sau khi giao task cho người khác');

-- Hạ member2 xuống Người xem: mất quyền với task đang phụ trách (BR-02 thắng BR-03).
select tests.logout();
update public.project_members set role = 'viewer'
  where project_id = tests.uid('project_a') and user_id = tests.m('member2');
select tests.login_as(tests.m('member2'));
select is(tests.affected_rows(format(
  'update public.tasks set title = ''x'' where id = %L', tests.m('task_as'))), 0,
  'Thành viên bị hạ xuống Người xem không sửa được task đang phụ trách');
select throws_ok(format(
  'insert into public.task_labels (task_id, label_id) values (%L, %L)',
  tests.m('task_as'), tests.label_of(tests.uid('project_a'), 'Ma trận 1')),
  '42501', null, 'Người xem (vừa bị hạ) không gắn nhãn vào task đang phụ trách');

-- Gỡ member_a khỏi dự án: mất quyền với task mình tạo.
select tests.logout();
delete from public.project_members
  where project_id = tests.uid('project_a') and user_id = tests.uid('member_a');
select tests.login_as(tests.uid('member_a'));
select is(tests.affected_rows(format(
  'update public.tasks set title = ''x'' where id = %L', tests.m('task_m'))), 0,
  'Thành viên bị gỡ khỏi dự án không sửa được task mình tạo');
select is(tests.affected_rows(format(
  'delete from public.tasks where id = %L', tests.m('task_m'))), 0,
  'Thành viên bị gỡ khỏi dự án không xóa được task mình tạo');

select tests.logout();
select * from finish();
rollback;
