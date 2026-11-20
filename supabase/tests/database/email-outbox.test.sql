-- QLDA-66 (Story E4-2): email giao việc (migration 20261115370000_email_outbox.sql).
-- Kiểm: cấu trúc, quyền bảng/cột/hàm (outbox chỉ service_role, không chính sách cho người dùng);
-- RLS notification_preferences cho PM, Thành viên, Người xem, Admin, người ngoài, người bị khóa,
-- anon; mặc định theo loại; trigger chỉ ghi hàng đợi khi người nhận BẬT, không tự gửi cho chính mình,
-- không trùng dòng pending; hàm worker (nhận việc kiểm quyền lúc gửi, ghi kết quả, thử lại); tick
-- pg_cron chỉ gọi HTTP khi có việc và đã cấu hình Vault.
begin;
\ir _helpers.psql
select tests.seed_fixture();

-- Thành viên thứ hai của dự án A.
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000c2', 'member2_a@test.example', '{"full_name":"Member 2 A"}');
insert into public.project_members (project_id, user_id, role) values
  (tests.uid('project_a'), '00000000-0000-0000-0000-0000000000c2', 'member');

-- Cô lập khỏi dữ liệu có sẵn trong CSDL dùng chung (rollback cuối tệp trả lại).
delete from public.email_outbox;
delete from vault.secrets where name in ('email_dispatch_url', 'email_dispatch_secret');

create function tests.t(name text)
returns uuid language sql immutable as $$
  select case name
    when 'member2' then '00000000-0000-0000-0000-0000000000c2'
    when 'task_1' then '00000000-0000-0000-0000-00000000e001'
    when 'task_2' then '00000000-0000-0000-0000-00000000e002'
    when 'task_3' then '00000000-0000-0000-0000-00000000e003'
    when 'task_4' then '00000000-0000-0000-0000-00000000e004'
    when 'task_5' then '00000000-0000-0000-0000-00000000e005'
    when 'task_6' then '00000000-0000-0000-0000-00000000e006'
  end::uuid;
$$;
create function tests.st(project text, status_name text)
returns uuid language sql stable security definer set search_path = public as $$
  select id from public.task_statuses where project_id = tests.uid(project) and name = status_name;
$$;
-- Đếm hàng đợi (bỏ qua RLS).
create function tests.ob_count(recipient uuid, kind text default null, task uuid default null,
  st text default null)
returns integer language sql stable security definer set search_path = public as $$
  select count(*)::int from public.email_outbox
  where user_id = recipient and (kind is null or type = kind) and (task is null or task_id = task)
    and (st is null or status = st);
$$;
create function tests.ob_row(recipient uuid, kind text, task uuid)
returns public.email_outbox language sql stable security definer set search_path = public as $$
  select * from public.email_outbox
  where user_id = recipient and type = kind and task_id = task
  order by created_at desc, id desc limit 1;
$$;
create function tests.act_as(user_id uuid)
returns void language plpgsql as $f$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', user_id, 'role', 'authenticated')::text, true);
end;
$f$;
create function tests.as_service()
returns void language plpgsql as $f$
begin
  perform set_config('role', 'service_role', true);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
end;
$f$;
grant execute on all functions in schema tests to anon, authenticated, service_role;
grant usage on schema tests to service_role;

select plan(79);

-- ===========================================================================
-- Cấu trúc, quyền
-- ===========================================================================
select has_table('public', 'notification_preferences', 'Có bảng notification_preferences');
select has_table('public', 'email_outbox', 'Có bảng email_outbox');
select is((select relrowsecurity from pg_class where oid = 'public.notification_preferences'::regclass),
  true, 'RLS bật trên notification_preferences');
select is((select relrowsecurity from pg_class where oid = 'public.email_outbox'::regclass),
  true, 'RLS bật trên email_outbox');
select is((select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'email_outbox'),
  0, 'email_outbox không có chính sách nào cho người dùng');
select ok(
  not has_table_privilege('anon', 'public.email_outbox', 'select')
  and not has_table_privilege('authenticated', 'public.email_outbox', 'select')
  and not has_table_privilege('authenticated', 'public.email_outbox', 'insert')
  and not has_table_privilege('authenticated', 'public.email_outbox', 'update')
  and not has_table_privilege('authenticated', 'public.email_outbox', 'delete'),
  'anon, authenticated không có quyền nào trên email_outbox');
select ok(
  has_table_privilege('service_role', 'public.email_outbox', 'select')
  and not has_table_privilege('service_role', 'public.email_outbox', 'insert')
  and not has_table_privilege('service_role', 'public.email_outbox', 'update'),
  'service_role chỉ đọc (ghi trạng thái qua hàm), không INSERT/UPDATE trực tiếp');
select ok(not has_table_privilege('anon', 'public.notification_preferences', 'select'),
  'anon không đọc preferences');
select ok(not has_table_privilege('authenticated', 'public.notification_preferences', 'delete'),
  'Trình duyệt không xóa preferences');
select ok(
  has_column_privilege('authenticated', 'public.notification_preferences', 'email_enabled', 'update')
  and not has_column_privilege('authenticated', 'public.notification_preferences', 'user_id', 'update')
  and not has_column_privilege('authenticated', 'public.notification_preferences', 'type', 'update'),
  'Trình duyệt chỉ sửa được email_enabled');
select ok(
  has_function_privilege('service_role', 'public.email_outbox_claim(integer, integer)', 'execute')
  and has_function_privilege('service_role', 'public.email_outbox_finish(uuid, boolean, text, timestamptz)', 'execute')
  and not has_function_privilege('authenticated', 'public.email_outbox_claim(integer, integer)', 'execute')
  and not has_function_privilege('anon', 'public.email_outbox_claim(integer, integer)', 'execute')
  and not has_function_privilege('authenticated', 'public.email_outbox_finish(uuid, boolean, text, timestamptz)', 'execute'),
  'Hàm worker chỉ service_role gọi được');
select ok(
  not has_function_privilege('anon', 'public.set_my_notification_preferences(jsonb)', 'execute')
  and not has_function_privilege('anon', 'public.my_notification_preferences()', 'execute'),
  'anon không gọi hàm preferences');
select ok(
  not has_function_privilege('authenticated', 'private.email_dispatch_tick()', 'execute')
  and not has_function_privilege('service_role', 'private.email_dispatch_tick()', 'execute')
  and not has_function_privilege('authenticated', 'private.enqueue_notification_email()', 'execute'),
  'Hàm tick và trigger không gọi được từ API');
select is(
  (select bool_and(prosecdef and proconfig = array['search_path=""']) from pg_proc
   where oid in ('public.email_outbox_claim(integer, integer)'::regprocedure,
                 'public.email_outbox_finish(uuid, boolean, text, timestamptz)'::regprocedure,
                 'private.email_dispatch_tick()'::regprocedure,
                 'private.enqueue_notification_email()'::regprocedure,
                 'private.email_enabled_for(uuid, text)'::regprocedure)),
  true, 'Hàm SECURITY DEFINER đặt search_path rỗng');
select is(
  (select bool_and(not prosecdef and proconfig = array['search_path=""']) from pg_proc
   where oid in ('public.my_notification_preferences()'::regprocedure,
                 'public.set_my_notification_preferences(jsonb)'::regprocedure)),
  true, 'Hàm preferences là SECURITY INVOKER (RLS áp dụng)');
select is((select count(*)::int from cron.job
           where jobname = 'qlda-email-dispatch' and schedule = '* * * * *'
             and command = 'select private.email_dispatch_tick()'),
  1, 'Job pg_cron qlda-email-dispatch mỗi phút');

-- ===========================================================================
-- Preferences: mặc định và RLS chính chủ
-- ===========================================================================
select tests.login_as(tests.uid('member_a'));
select results_eq(
  'select type, email_enabled from public.my_notification_preferences()',
  $$values ('task_assigned', true), ('task_due_soon', true), ('task_status_changed', false)$$,
  'Mặc định: giao việc BẬT, nhắc hạn BẬT (E4-3), đổi trạng thái TẮT');
select lives_ok(
  $$select public.set_my_notification_preferences('{"task_status_changed": true}')$$,
  'Thành viên bật email đổi trạng thái');
select results_eq(
  'select type, email_enabled from public.my_notification_preferences()',
  $$values ('task_assigned', true), ('task_due_soon', true), ('task_status_changed', true)$$,
  'Đọc lại thấy giá trị đã lưu');
select lives_ok(
  $$select public.set_my_notification_preferences('{"task_status_changed": true, "task_assigned": true}')$$,
  'Ghi lại (trùng khóa) không lỗi');
select is((select count(*)::int from public.notification_preferences), 2,
  'Thành viên chỉ thấy dòng của mình');
select throws_ok(
  format($$insert into public.notification_preferences (user_id, type, email_enabled)
          values (%L, 'task_assigned', false)$$, tests.uid('pm_a')),
  '42501', null, 'Không thêm được dòng cho người khác');
select throws_ok(
  $$select public.set_my_notification_preferences('{"due_reminder": true}')$$,
  '23514', null, 'Loại lạ bị CHECK chặn');
select throws_ok(
  $$select public.set_my_notification_preferences('{"task_assigned": "yes"}')$$,
  '22023', null, 'Giá trị không phải boolean bị từ chối');
select throws_ok(
  $$select public.set_my_notification_preferences('[]')$$,
  '22023', null, 'p_prefs phải là object');

-- PM A, Người xem, người ngoài: mỗi người ghi được của mình.
select tests.login_as(tests.uid('pm_a'));
select lives_ok($$select public.set_my_notification_preferences('{"task_assigned": true}')$$,
  'PM ghi được tùy chọn của mình');
select is(tests.affected_rows(format(
  $$update public.notification_preferences set email_enabled = false where user_id = %L$$,
  tests.uid('member_a'))), 0, 'PM không sửa được tùy chọn của Thành viên');
select tests.login_as(tests.uid('viewer_a'));
select lives_ok($$select public.set_my_notification_preferences('{"task_assigned": false}')$$,
  'Người xem ghi được tùy chọn của mình');
select tests.login_as(tests.uid('outsider'));
select lives_ok($$select public.set_my_notification_preferences('{"task_assigned": false}')$$,
  'Người ngoài dự án ghi được tùy chọn của mình');
select is((select count(*)::int from public.notification_preferences where user_id <> tests.uid('outsider')),
  0, 'Người ngoài không thấy tùy chọn của ai khác');

-- Admin cũng không đọc tùy chọn người khác.
select tests.login_as(tests.uid('admin'));
select is((select count(*)::int from public.notification_preferences), 0,
  'Admin không đọc tùy chọn của người khác');
select is(tests.affected_rows(format(
  $$update public.notification_preferences set email_enabled = false where user_id = %L$$,
  tests.uid('member_a'))), 0, 'Admin không sửa tùy chọn của người khác');

-- Người bị khóa.
select tests.login_as(tests.uid('locked'));
select is((select count(*)::int from public.my_notification_preferences()), 0,
  'Người bị khóa không đọc được tùy chọn');
select throws_ok($$select public.set_my_notification_preferences('{"task_assigned": false}')$$,
  '42501', null, 'Người bị khóa không ghi được');

-- anon.
select tests.login_anon();
select throws_ok($$select public.my_notification_preferences()$$, '42501', null,
  'anon không đọc');
select throws_ok($$select * from public.notification_preferences$$, '42501', null,
  'anon không đọc bảng');
select tests.logout();

-- ===========================================================================
-- Trigger: thông báo → hàng đợi (chỉ khi BẬT)
-- ===========================================================================
-- AC1: PM A giao task cho member_a (bật giao việc) → một dòng pending, actor = PM A.
select tests.act_as(tests.uid('pm_a'));
insert into public.tasks (id, project_id, title, assignee_id) values
  (tests.t('task_1'), tests.uid('project_a'), 'Viết đặc tả <b>email</b>', tests.uid('member_a'));
select tests.logout();
select is(tests.ob_count(tests.uid('member_a'), 'task_assigned', tests.t('task_1'), 'pending'), 1,
  'AC1: được giao + bật email → một dòng pending');
select is((tests.ob_row(tests.uid('member_a'), 'task_assigned', tests.t('task_1'))).actor_id,
  tests.uid('pm_a'), 'Ghi người giao (actor_id)');
select is((tests.ob_row(tests.uid('member_a'), 'task_assigned', tests.t('task_1'))).attempts::int,
  0, 'Chưa gửi lần nào');

-- Tự giao cho mình: không có dòng.
select tests.act_as(tests.uid('pm_a'));
insert into public.tasks (id, project_id, title, assignee_id) values
  (tests.t('task_2'), tests.uid('project_a'), 'Việc của PM', tests.uid('pm_a'));
select tests.logout();
select is(tests.ob_count(tests.uid('pm_a')), 0, 'Tự giao cho chính mình: không email');

-- Đổi trạng thái task_1 (PM A làm): member_a đã BẬT đổi trạng thái → có dòng.
select tests.act_as(tests.uid('pm_a'));
update public.tasks set status_id = tests.st('project_a', 'Đang thực hiện') where id = tests.t('task_1');
select tests.logout();
select is(tests.ob_count(tests.uid('member_a'), 'task_status_changed', tests.t('task_1')), 1,
  'Người phụ trách bật email đổi trạng thái → có dòng');

-- member_a đổi trạng thái: người tạo (PM A) mặc định TẮT → không có dòng (vẫn có thông báo trong app).
select tests.act_as(tests.uid('member_a'));
update public.tasks set status_id = tests.st('project_a', 'Đang kiểm thử') where id = tests.t('task_1');
select tests.logout();
select is((select count(*)::int from public.notifications
           where user_id = tests.uid('pm_a') and type = 'task_status_changed' and task_id = tests.t('task_1')),
  1, 'PM A vẫn có thông báo trong app');
select is(tests.ob_count(tests.uid('pm_a'), 'task_status_changed'), 0,
  'Mặc định TẮT email đổi trạng thái → không có dòng');

-- Người xem đã TẮT giao việc (ở trên); member2 dùng mặc định. Tắt giao việc của member2 rồi giao.
select tests.login_as(tests.t('member2'));
select public.set_my_notification_preferences('{"task_assigned": false}');
select tests.act_as(tests.uid('pm_a'));
insert into public.tasks (id, project_id, title, assignee_id) values
  (tests.t('task_3'), tests.uid('project_a'), 'Việc tắt email', tests.t('member2'));
select tests.logout();
select is((select count(*)::int from public.notifications
           where user_id = tests.t('member2') and task_id = tests.t('task_3')), 1,
  'Tắt email: vẫn có thông báo trong app');
select is(tests.ob_count(tests.t('member2')), 0, 'Tắt email giao việc → không có dòng');

-- Không trùng: giao, bỏ giao, giao lại member_a trước khi worker chạy → một dòng pending.
select tests.act_as(tests.uid('pm_a'));
insert into public.tasks (id, project_id, title, assignee_id) values
  (tests.t('task_4'), tests.uid('project_a'), 'Giao đi giao lại', tests.uid('member_a'));
update public.tasks set assignee_id = null where id = tests.t('task_4');
update public.tasks set assignee_id = tests.uid('member_a') where id = tests.t('task_4');
select tests.logout();
select is((select count(*)::int from public.notifications
           where user_id = tests.uid('member_a') and type = 'task_assigned' and task_id = tests.t('task_4')),
  2, 'Hai thông báo giao việc');
select is(tests.ob_count(tests.uid('member_a'), 'task_assigned', tests.t('task_4'), 'pending'), 1,
  'Chỉ một dòng pending (không gửi trùng)');

-- Rollback thao tác gốc thì không có dòng (cùng giao dịch).
savepoint before_task5;
select tests.act_as(tests.uid('pm_a'));
insert into public.tasks (id, project_id, title, assignee_id) values
  (tests.t('task_5'), tests.uid('project_a'), 'Sẽ rollback', tests.uid('member_a'));
rollback to savepoint before_task5;
select tests.logout();
select is(tests.ob_count(tests.uid('member_a'), null, tests.t('task_5')), 0,
  'Thao tác gốc rollback → không có email');

-- ===========================================================================
-- Worker: nhận việc, kiểm quyền lúc gửi, ghi kết quả
-- ===========================================================================
-- Trình duyệt không gọi được.
select tests.login_as(tests.uid('member_a'));
select throws_ok($$select * from public.email_outbox_claim(10, 4)$$, '42501', null,
  'Người dùng không gọi được hàm nhận việc');
select throws_ok($$select * from public.email_outbox$$, '42501', null,
  'Người dùng không đọc được hàng đợi');

-- Task 6 giao cho member2 rồi member2 bật lại email; dùng để kiểm "mất quyền lúc gửi".
select tests.login_as(tests.t('member2'));
select public.set_my_notification_preferences('{"task_assigned": true}');
select tests.act_as(tests.uid('pm_a'));
insert into public.tasks (id, project_id, title, assignee_id) values
  (tests.t('task_6'), tests.uid('project_a'), 'Người nhận sẽ rời dự án', tests.t('member2'));
select tests.logout();
select is(tests.ob_count(tests.t('member2'), 'task_assigned', tests.t('task_6'), 'pending'), 1,
  'member2 có dòng pending cho task_6');
-- member2 rời dự án trước khi worker chạy.
delete from public.project_members where project_id = tests.uid('project_a') and user_id = tests.t('member2');

-- task_4: PM A tự nhận (member_a không còn là người phụ trách) → bỏ qua; tự giao nên không có
-- thông báo/email mới cho PM A.
select tests.act_as(tests.uid('pm_a'));
update public.tasks set assignee_id = tests.uid('pm_a') where id = tests.t('task_4');
select tests.logout();

select tests.as_service();
create temp table claimed on commit drop as
  select * from public.email_outbox_claim(50, 4);
select tests.logout();

select is((select count(*)::int from claimed), 2,
  'Nhận đúng 2 dòng hợp lệ (task_1 giao việc, task_1 đổi trạng thái)');
select results_eq(
  $$select type, recipient_email, recipient_locale, task_title, project_name, actor_name
    from claimed order by type$$,
  $$values ('task_assigned'::text, 'member_a@test.example'::text, 'vi'::text,
            'Viết đặc tả <b>email</b>'::text, 'Dự án A'::text, 'PM A'::text),
           ('task_status_changed', 'member_a@test.example', 'vi',
            'Viết đặc tả <b>email</b>', 'Dự án A', 'PM A')$$,
  'Trả đủ dữ liệu dựng email (địa chỉ, ngôn ngữ, tên task, dự án, người giao)');
select is((select status_name from claimed where type = 'task_status_changed'), 'Đang kiểm thử',
  'Trạng thái hiện tại của task');
select is((select attempts from claimed limit 1), 1, 'attempts tăng lên 1 khi nhận');
select is((tests.ob_row(tests.uid('member_a'), 'task_assigned', tests.t('task_4'))).status,
  'skipped', 'Không còn là người phụ trách → skipped');
select is((tests.ob_row(tests.uid('member_a'), 'task_assigned', tests.t('task_4'))).last_error,
  'recipient_not_eligible', 'Lý do skipped ngắn');
select is((tests.ob_row(tests.t('member2'), 'task_assigned', tests.t('task_6'))).status,
  'skipped', 'Người nhận rời dự án trước khi gửi → skipped (không lộ tiêu đề)');

-- Đang giữ (lease 5 phút): lần nhận sau không lấy lại.
select tests.as_service();
select is((select count(*)::int from public.email_outbox_claim(50, 4)), 0,
  'Dòng đang giữ không bị nhận trùng');

-- Ghi kết quả.
select ok(public.email_outbox_finish(
  (select id from claimed where type = 'task_assigned'), true, null, null), 'finish ok');
select tests.logout();
select is((tests.ob_row(tests.uid('member_a'), 'task_assigned', tests.t('task_1'))).status, 'sent',
  'Gửi xong → sent');
select ok((tests.ob_row(tests.uid('member_a'), 'task_assigned', tests.t('task_1'))).sent_at is not null,
  'sent_at được ghi');

select tests.as_service();
select ok(not public.email_outbox_finish(
  (select id from claimed where type = 'task_assigned'), false, 'x', null),
  'Không ghi đè dòng đã sent');
-- Lỗi tạm thời, thử lại "ngay" (quá khứ) để lần nhận sau lấy được; mã lỗi dài bị cắt 200.
select ok(public.email_outbox_finish(
  (select id from claimed where type = 'task_status_changed'), false, repeat('e', 500),
  now() - interval '1 second'), 'finish lỗi + thử lại');
select tests.logout();
select is((tests.ob_row(tests.uid('member_a'), 'task_status_changed', tests.t('task_1'))).status,
  'pending', 'Lỗi tạm thời → vẫn pending');
select is(char_length((tests.ob_row(tests.uid('member_a'), 'task_status_changed', tests.t('task_1'))).last_error),
  200, 'last_error cắt còn 200 ký tự');

select tests.as_service();
select is((select attempts from public.email_outbox_claim(50, 4)), 2, 'Thử lại: attempts = 2');
select ok(public.email_outbox_finish(
  (select id from claimed where type = 'task_status_changed'), false, 'mailpit_http_500', null),
  'Hết lượt → finish không hẹn thử lại');
select tests.logout();
select is((tests.ob_row(tests.uid('member_a'), 'task_status_changed', tests.t('task_1'))).status,
  'failed', 'Không còn thử lại → failed');

-- Quá số lần (worker chết giữa chừng) và quá 24 giờ.
update public.email_outbox set status = 'pending', attempts = 4, next_attempt_at = now(),
  last_error = null
  where user_id = tests.uid('member_a') and type = 'task_status_changed' and task_id = tests.t('task_1');
update public.tasks set assignee_id = tests.uid('member_a') where id = tests.t('task_4');
update public.email_outbox set created_at = now() - interval '25 hours'
  where user_id = tests.uid('member_a') and task_id = tests.t('task_4') and status = 'pending';
select tests.as_service();
select is((select count(*)::int from public.email_outbox_claim(50, 4)), 0,
  'Dòng quá lượt hoặc quá hạn không được trả về');
select tests.logout();
select is((tests.ob_row(tests.uid('member_a'), 'task_status_changed', tests.t('task_1'))).last_error,
  'max_attempts', 'Quá số lần → failed max_attempts');
select is(tests.ob_count(tests.uid('member_a'), 'task_assigned', tests.t('task_4'), 'skipped'), 2,
  'Chờ quá 24 giờ → skipped');

-- Người nhận bị khóa lúc gửi → skipped.
select tests.act_as(tests.uid('pm_a'));
update public.tasks set assignee_id = tests.uid('member_a'), title = 'Khóa trước khi gửi'
  where id = tests.t('task_2');
select tests.logout();
update public.profiles set is_active = false where id = tests.uid('member_a');
select tests.as_service();
select is((select count(*)::int from public.email_outbox_claim(50, 4)), 0,
  'Người nhận bị khóa: không trả về');
select tests.logout();
select is((tests.ob_row(tests.uid('member_a'), 'task_assigned', tests.t('task_2'))).status, 'skipped',
  'Người nhận bị khóa → skipped');
update public.profiles set is_active = true where id = tests.uid('member_a');

-- ===========================================================================
-- Tick pg_cron
-- ===========================================================================
update public.email_outbox set status = 'pending', last_error = null, next_attempt_at = now()
  where user_id = tests.uid('member_a') and task_id = tests.t('task_2') and type = 'task_assigned';
select is(tests.ob_count(tests.uid('member_a'), 'task_assigned', tests.t('task_2'), 'pending'), 1,
  'Có một dòng đến hạn');
select is(private.email_dispatch_tick(), null, 'Chưa cấu hình Vault: tick không gọi HTTP');
select vault.create_secret('http://host.docker.internal:3000/api/internal/email/dispatch',
  'email_dispatch_url');
select vault.create_secret('test-secret-0123456789abcdef0123456789', 'email_dispatch_secret');
select isnt(private.email_dispatch_tick(), null, 'Có việc + đã cấu hình: tick gửi một request');
select is((select count(*)::int from net.http_request_queue
           where url = 'http://host.docker.internal:3000/api/internal/email/dispatch'
             and method = 'POST'
             and headers ->> 'authorization' = 'Bearer test-secret-0123456789abcdef0123456789'),
  1, 'Request POST kèm Authorization Bearer tới URL đã cấu hình');
delete from public.email_outbox where status = 'pending';
select is(private.email_dispatch_tick(), null, 'Không có việc: tick không gọi HTTP');

select * from finish();
rollback;
