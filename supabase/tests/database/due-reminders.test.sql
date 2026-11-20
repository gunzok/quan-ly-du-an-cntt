-- QLDA-74 (Story E4-3): nhắc hạn (migration 20261115390000_due_reminders.sql).
-- Kiểm: cấu trúc, quyền (hàm chỉ service_role/postgres, sổ nhắc chỉ hệ thống), lịch pg_cron;
-- chọn đúng task theo ngày giờ Việt Nam (ranh giới 23:59:59 / 00:00); mốc 1 và 3 ngày; không nhắc
-- task đã xong, không hạn, không người phụ trách, dự án lưu trữ, người bị khóa, người mất quyền;
-- chống trùng (chạy lại, đổi hạn rồi đổi về); payload và CHECK chống rò rỉ; email theo tùy chọn và
-- kiểm "nhắc còn đúng" lúc gửi.
begin;
\ir _helpers.psql
select tests.seed_fixture();

-- Thành viên thứ hai, thứ ba của dự án A (một người sẽ mất quyền, một người sẽ bị khóa).
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000c2', 'member2_a@test.example', '{"full_name":"Member 2 A"}'),
  ('00000000-0000-0000-0000-0000000000c3', 'member3_a@test.example', '{"full_name":"Member 3 A"}');
insert into public.project_members (project_id, user_id, role) values
  (tests.uid('project_a'), '00000000-0000-0000-0000-0000000000c2', 'member'),
  (tests.uid('project_a'), '00000000-0000-0000-0000-0000000000c3', 'member');

delete from public.email_outbox;

create function tests.t(name text)
returns uuid language sql immutable as $$
  select case name
    when 'member2' then '00000000-0000-0000-0000-0000000000c2'
    when 'member3' then '00000000-0000-0000-0000-0000000000c3'
    when 'd1' then '00000000-0000-0000-0000-00000000f001'
    when 'd3' then '00000000-0000-0000-0000-00000000f003'
    when 'd2' then '00000000-0000-0000-0000-00000000f002'
    when 'd0' then '00000000-0000-0000-0000-00000000f000'
    when 'done' then '00000000-0000-0000-0000-00000000f010'
    when 'no_assignee' then '00000000-0000-0000-0000-00000000f011'
    when 'locked' then '00000000-0000-0000-0000-00000000f012'
    when 'gone' then '00000000-0000-0000-0000-00000000f013'
    when 'archived' then '00000000-0000-0000-0000-00000000f014'
    when 'no_due' then '00000000-0000-0000-0000-00000000f015'
    when 'pm_off' then '00000000-0000-0000-0000-00000000f016'
    when 'boundary' then '00000000-0000-0000-0000-00000000f020'
  end::uuid;
$$;
-- "Hôm nay" theo giờ Việt Nam của giao dịch test (now() cố định trong giao dịch) + n ngày.
create function tests.d(n integer)
returns date language sql stable as $$
  select (now() at time zone 'Asia/Ho_Chi_Minh')::date + n;
$$;
-- Thời điểm hh:mm:ss giờ Việt Nam của ngày tests.d(n).
create function tests.vn(n integer, hhmmss text)
returns timestamptz language sql stable as $$
  select (tests.d(n) + hhmmss::time) at time zone 'Asia/Ho_Chi_Minh';
$$;
create function tests.due_count(task uuid, recipient uuid default null)
returns integer language sql stable security definer set search_path = public as $$
  select count(*)::int from public.notifications
  where type = 'task_due_soon' and task_id = task and (recipient is null or user_id = recipient);
$$;
create function tests.ob_due(task uuid, st text default null)
returns integer language sql stable security definer set search_path = public as $$
  select count(*)::int from public.email_outbox
  where type = 'task_due_soon' and task_id = task and (st is null or status = st);
$$;
create function tests.done_status(project uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select id from public.task_statuses where project_id = project and category = 'done'
  order by position limit 1;
$$;
create function tests.as_service()
returns void language plpgsql as $f$
begin
  perform set_config('role', 'service_role', true);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
end;
$f$;
grant execute on all functions in schema tests to anon, authenticated, service_role;
grant usage on schema tests to service_role;

select plan(48);

-- ===========================================================================
-- Cấu trúc, quyền, lịch
-- ===========================================================================
select has_table('public', 'task_due_reminders', 'Có bảng sổ nhắc task_due_reminders');
select is((select relrowsecurity from pg_class where oid = 'public.task_due_reminders'::regclass),
  true, 'RLS bật trên task_due_reminders');
select is((select count(*)::int from pg_policies
           where schemaname = 'public' and tablename = 'task_due_reminders'),
  0, 'Sổ nhắc không có chính sách nào cho người dùng');
select ok(
  not has_table_privilege('anon', 'public.task_due_reminders', 'select')
  and not has_table_privilege('authenticated', 'public.task_due_reminders', 'select')
  and not has_table_privilege('authenticated', 'public.task_due_reminders', 'insert')
  and not has_table_privilege('authenticated', 'public.task_due_reminders', 'update')
  and not has_table_privilege('authenticated', 'public.task_due_reminders', 'delete'),
  'anon, authenticated không có quyền nào trên sổ nhắc');
select ok(
  has_table_privilege('service_role', 'public.task_due_reminders', 'select')
  and not has_table_privilege('service_role', 'public.task_due_reminders', 'insert')
  and not has_table_privilege('service_role', 'public.task_due_reminders', 'update')
  and not has_table_privilege('service_role', 'public.task_due_reminders', 'delete'),
  'service_role chỉ đọc sổ nhắc');
select ok(
  has_function_privilege('service_role', 'public.run_due_reminders(timestamptz, uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.run_due_reminders(timestamptz, uuid)', 'execute')
  and not has_function_privilege('anon', 'public.run_due_reminders(timestamptz, uuid)', 'execute')
  and not has_function_privilege('public', 'public.run_due_reminders(timestamptz, uuid)', 'execute'),
  'run_due_reminders chỉ service_role (và chủ hàm postgres) gọi được');
select is(
  (select prosecdef and proconfig = array['search_path=""'] from pg_proc
   where oid = 'public.run_due_reminders(timestamptz, uuid)'::regprocedure),
  true, 'run_due_reminders là SECURITY DEFINER với search_path rỗng');
select is(
  (select prosecdef and proconfig = array['search_path=""'] from pg_proc
   where oid = 'public.email_outbox_claim(integer, integer)'::regprocedure),
  true, 'email_outbox_claim (tạo lại) vẫn SECURITY DEFINER, search_path rỗng');
select ok(
  has_function_privilege('service_role', 'public.email_outbox_claim(integer, integer)', 'execute')
  and not has_function_privilege('authenticated', 'public.email_outbox_claim(integer, integer)', 'execute')
  and not has_function_privilege('anon', 'public.email_outbox_claim(integer, integer)', 'execute'),
  'email_outbox_claim (tạo lại) vẫn chỉ service_role');
select results_eq(
  $$select schedule, command from cron.job where jobname = 'qlda-due-reminders'$$,
  $$values ('0 1 * * *'::text, 'select public.run_due_reminders()'::text)$$,
  'pg_cron: 01:00 UTC mỗi ngày (= 08:00 giờ Việt Nam)');
select is(current_setting('cron.timezone'), 'GMT', 'pg_cron chạy theo GMT/UTC');

-- ===========================================================================
-- Dữ liệu: dự án A (member_a phụ trách trừ khi ghi khác), dự án B sẽ lưu trữ.
-- ===========================================================================
insert into public.tasks (id, project_id, title, assignee_id, due_date) values
  (tests.t('d1'), tests.uid('project_a'), 'Nộp báo cáo <b>tuần</b>', tests.uid('member_a'), tests.d(1)),
  (tests.t('d3'), tests.uid('project_a'), repeat('Dài ', 40), tests.uid('member_a'), tests.d(3)),
  (tests.t('d2'), tests.uid('project_a'), 'Còn hai ngày', tests.uid('member_a'), tests.d(2)),
  (tests.t('d0'), tests.uid('project_a'), 'Hạn hôm nay', tests.uid('member_a'), tests.d(0)),
  (tests.t('no_assignee'), tests.uid('project_a'), 'Chưa giao', null, tests.d(1)),
  (tests.t('no_due'), tests.uid('project_a'), 'Không hạn', tests.uid('member_a'), null),
  (tests.t('gone'), tests.uid('project_a'), 'Người phụ trách rời dự án', tests.t('member2'), tests.d(1)),
  (tests.t('locked'), tests.uid('project_a'), 'Người phụ trách bị khóa', tests.t('member3'), tests.d(3)),
  (tests.t('pm_off'), tests.uid('project_a'), 'PM tắt email nhắc hạn', tests.uid('pm_a'), tests.d(1)),
  (tests.t('archived'), tests.uid('project_b'), 'Dự án lưu trữ', tests.uid('pm_b'), tests.d(1));
insert into public.tasks (id, project_id, title, assignee_id, due_date, completed_at) values
  (tests.t('done'), tests.uid('project_a'), 'Đã xong', tests.uid('member_a'), tests.d(1), now());

-- Mất quyền: gỡ member2 khỏi dự án (assignee_id giữ nguyên theo E2-2). Bị khóa: member3.
delete from public.project_members
  where project_id = tests.uid('project_a') and user_id = tests.t('member2');
update public.profiles set is_active = false where id = tests.t('member3');
update public.projects set status = 'archived' where id = tests.uid('project_b');

-- PM A tắt email nhắc hạn (thông báo trong app vẫn có).
select tests.login_as(tests.uid('pm_a'));
select lives_ok($$select public.set_my_notification_preferences('{"task_due_soon": false}')$$,
  'PM tắt email nhắc hạn');
select tests.logout();

-- ===========================================================================
-- Quyền gọi hàm
-- ===========================================================================
select tests.login_as(tests.uid('admin'));
select throws_ok($$select public.run_due_reminders()$$, '42501', null,
  'Admin (authenticated) không gọi được hàm lập lịch');
select throws_ok($$select * from public.task_due_reminders$$, '42501', null,
  'authenticated không đọc sổ nhắc');
select tests.login_anon();
select throws_ok($$select public.run_due_reminders()$$, '42501', null,
  'anon không gọi được hàm lập lịch');
select tests.logout();
select throws_ok($$select public.run_due_reminders(null)$$, '22004', null,
  'p_now null → lỗi');

-- ===========================================================================
-- Chạy lúc 08:00 hôm nay (giờ VN) bằng service_role
-- ===========================================================================
select tests.as_service();
select is(public.run_due_reminders(tests.vn(0, '08:00:00'), gen_random_uuid()), 0,
  'p_project_id: chỉ xét dự án đó (dự án không tồn tại → 0 nhắc)');
select is(public.run_due_reminders(tests.vn(0, '08:00:00')), 3,
  'Lần chạy đầu: 3 nhắc (d1, d3 của member_a; pm_off của PM)');
select tests.logout();

select is(tests.due_count(tests.t('d1'), tests.uid('member_a')), 1, 'Hạn ngày mai: nhắc 1 ngày');
select is(tests.due_count(tests.t('d3'), tests.uid('member_a')), 1, 'Hạn sau 3 ngày: nhắc 3 ngày');
select is(tests.due_count(tests.t('pm_off'), tests.uid('pm_a')), 1,
  'Tắt email vẫn có thông báo trong app');
select is(tests.due_count(tests.t('d2')) + tests.due_count(tests.t('d0')), 0,
  'Hạn sau 2 ngày hoặc hôm nay: không nhắc');
select is(tests.due_count(tests.t('done')), 0, 'Task đã xong: không nhắc');
select is(tests.due_count(tests.t('no_assignee')) + tests.due_count(tests.t('no_due')), 0,
  'Không người phụ trách hoặc không hạn: không nhắc');
select is(tests.due_count(tests.t('archived')), 0, 'Dự án đã lưu trữ: không nhắc');
select is(tests.due_count(tests.t('locked')), 0, 'Người phụ trách bị khóa: không nhắc');
select is(tests.due_count(tests.t('gone')), 0, 'Người phụ trách đã mất quyền đọc dự án: không nhắc');
select is((select count(*)::int from public.notifications
           where type = 'task_due_soon' and user_id = tests.uid('pm_a') and task_id <> tests.t('pm_off')),
  0, 'Người tạo/PM không nhận nhắc task của người khác');

select is(
  (select payload from public.notifications where type = 'task_due_soon' and task_id = tests.t('d1')),
  jsonb_build_object('title', 'Nộp báo cáo <b>tuần</b>', 'due_date', to_char(tests.d(1), 'YYYY-MM-DD'),
                     'days_left', 1),
  'payload chỉ có title, due_date, days_left (không actor, không mô tả)');
select is(
  (select char_length(payload ->> 'title') from public.notifications
   where type = 'task_due_soon' and task_id = tests.t('d3')),
  80, 'Tiêu đề rút gọn tối đa 80 ký tự');

-- Người nhận đọc payload qua hàm kiểm quyền (E4-1).
select tests.login_as(tests.uid('member_a'));
select is(
  (select (p.payload ->> 'days_left')::int from public.notification_payloads(
     array(select id from public.notifications where type = 'task_due_soon' and task_id = tests.t('d3'))) p),
  3, 'Người nhận đọc được payload nhắc hạn qua notification_payloads');
select tests.logout();

-- ===========================================================================
-- Chống trùng
-- ===========================================================================
select tests.as_service();
select is(public.run_due_reminders(tests.vn(0, '08:00:00')), 0, 'Chạy lại cùng lúc: 0 nhắc mới');
select is(public.run_due_reminders(tests.vn(0, '23:59:59')), 0, 'Chạy lại cuối ngày: 0 nhắc mới');
select tests.logout();
select is(tests.due_count(tests.t('d1')), 1, 'Vẫn chỉ một nhắc cho d1');

-- Dời hạn d1 sang hôm nay + 3 (hạn mới, mốc mới) → được nhắc theo hạn mới; đổi về hạn cũ → không trùng.
update public.tasks set due_date = tests.d(3) where id = tests.t('d1');
select tests.as_service();
select is(public.run_due_reminders(tests.vn(0, '09:00:00')), 1, 'Dời hạn sang ngày khác: nhắc theo hạn mới');
select tests.logout();
update public.tasks set due_date = tests.d(1) where id = tests.t('d1');
select tests.as_service();
select is(public.run_due_reminders(tests.vn(0, '10:00:00')), 0, 'Đổi về hạn cũ: không nhắc lại mốc đã nhắc');
select tests.logout();
select is(tests.due_count(tests.t('d1')), 2, 'd1: tổng 2 nhắc (hạn cũ 1 ngày, hạn mới 3 ngày)');

-- ===========================================================================
-- Ranh giới giờ Việt Nam: task hạn hôm nay + 5. Lúc 23:59:59 ngày (hôm nay + 1) giờ VN chưa đến
-- mốc 3 ngày; 00:00:00 ngày (hôm nay + 2) giờ VN thì đến. Theo UTC, 00:00 VN vẫn là ngày hôm trước,
-- nên test bắt được lỗi tính "hôm nay" theo UTC.
-- ===========================================================================
insert into public.tasks (id, project_id, title, assignee_id, due_date) values
  (tests.t('boundary'), tests.uid('project_a'), 'Ranh giới', tests.uid('member_a'), tests.d(5));
-- (Các lần chạy này cũng nhắc task khác đúng mốc của ngày đó, ví dụ d2, d3 mốc 1 ngày; chỉ xét
-- task ranh giới.)
select tests.as_service();
select public.run_due_reminders(tests.vn(1, '23:59:59'));
select tests.logout();
select is(tests.due_count(tests.t('boundary')), 0, '23:59:59 giờ VN: chưa đến mốc');
select tests.as_service();
select public.run_due_reminders(tests.vn(2, '00:00:00'));
select tests.logout();
select is(tests.due_count(tests.t('boundary')), 1, '00:00:00 giờ VN: đến mốc 3 ngày');
select is(
  ((select payload from public.notifications where type = 'task_due_soon' and task_id = tests.t('boundary'))
    ->> 'days_left')::int,
  3, 'Ranh giới: days_left = 3');

-- ===========================================================================
-- Email: hàng đợi theo tùy chọn và kiểm lúc gửi
-- ===========================================================================
select is(tests.ob_due(tests.t('d1'), 'pending') + tests.ob_due(tests.t('d3'), 'pending'), 2,
  'member_a (mặc định bật) có email nhắc trong hàng đợi');
select is(tests.ob_due(tests.t('pm_off')), 0, 'PM tắt email nhắc hạn → không có email');

-- d3 hoàn thành trước khi worker gửi → skipped reminder_stale. Thêm đổi trạng thái tạo email khác
-- loại; chỉ xét dòng task_due_soon.
update public.tasks set status_id = tests.done_status(tests.uid('project_a')) where id = tests.t('d3');
select tests.as_service();
create temp table claimed on commit drop as
  select * from public.email_outbox_claim(100, 4);
select tests.logout();
select results_eq(
  $$select due_date, days_left from claimed where type = 'task_due_soon' and task_id = tests.t('d1')$$,
  $$select tests.d(1), 1$$,
  'Worker nhận email nhắc kèm hạn và số ngày còn lại');
select is((select count(*)::int from claimed where type = 'task_due_soon' and task_id = tests.t('d3')),
  0, 'Task đã xong trước lúc gửi: không gửi');
select is((select last_error from public.email_outbox
           where type = 'task_due_soon' and task_id = tests.t('d3')),
  'reminder_stale', 'Dòng email của task đã xong thành skipped reminder_stale');

-- ===========================================================================
-- CHECK payload (chống rò rỉ)
-- ===========================================================================
select throws_ok(
  $$insert into public.notifications (user_id, type, task_id, project_id, payload) values
    (tests.uid('member_a'), 'task_assigned', tests.t('d2'), tests.uid('project_a'),
     '{"title":"x","due_date":"2026-01-01"}')$$,
  '23514', null, 'Loại khác không được mang due_date');
select throws_ok(
  $$insert into public.notifications (user_id, type, task_id, project_id, payload) values
    (tests.uid('member_a'), 'task_due_soon', tests.t('d2'), tests.uid('project_a'),
     '{"title":"x","due_date":"2026-01-01","days_left":1,"actor_id":null}')$$,
  '23514', null, 'task_due_soon không được mang actor_id');
select throws_ok(
  $$insert into public.notifications (user_id, type, task_id, project_id, payload) values
    (tests.uid('member_a'), 'task_due_soon', tests.t('d2'), tests.uid('project_a'),
     '{"title":"x","due_date":"2026-01-01","days_left":"1"}')$$,
  '23514', null, 'days_left phải là số 1 hoặc 3');

select * from finish();
rollback;
