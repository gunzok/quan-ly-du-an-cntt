-- QLDA-74 (Story E4-3): nhắc hạn bằng bộ lập lịch, tùy chọn bật tắt (FR-11, FR-12, ADR-003).
-- Loại thông báo mới `task_due_soon` do hàm hệ thống public.run_due_reminders() tạo, pg_cron chạy mỗi
-- ngày 01:00 UTC (08:00 giờ Việt Nam). Thông báo trong app (E4-1) và email (E4-2, qua trigger
-- enqueue_notification_email sẵn có) dùng lại toàn bộ đường đi cũ.
--
-- Quyết định:
--   1. Mốc nhắc: 1 và 3 ngày LỊCH trước hạn (ADR-003, mặc định đã được sếp đồng ý làm trước bằng giả
--      định). "Hôm nay" là ngày theo giờ Việt Nam (Asia/Ho_Chi_Minh) của thời điểm chạy p_now: task có
--      due_date = hôm nay + 1 hoặc hôm nay + 3. Chạy cả cuối tuần (mốc là ngày lịch, hạn thứ Hai vẫn
--      được nhắc thứ Bảy/thứ Sáu). KHÔNG bù mốc đã lỡ: hôm nào job không chạy thì mốc của hôm đó bỏ
--      qua (nhắc trễ một ngày dễ gây hiểu nhầm "còn 1 ngày" khi thực ra là hôm nay).
--   2. KHÔNG làm `task_overdue` (nhắc quá hạn) ở Story này: tiêu chí chấp nhận chỉ nói "sắp đến hạn";
--      nhắc quá hạn mỗi ngày dễ thành thư rác và cần chính sách riêng (nhắc mấy lần, cho ai). Danh
--      sách task trễ hạn đã có ở bảng điều khiển (E2-1). Thêm sau = thêm loại + mốc âm vào hàm này.
--   3. Người nhận: CHỈ người phụ trách (assignee_id), đang hoạt động và còn đọc được dự án (thành
--      viên hoặc Admin, private.notification_recipient_ok như E4-1). Người tạo task không nhận nhắc.
--   4. Không nhắc: task đã xong (completed_at có giá trị), task không có hạn hoặc không có người phụ
--      trách, dự án đã lưu trữ (projects.status = 'archived': dự án đóng băng, không ai cần làm tiếp).
--   5. Chống trùng bằng sổ nhắc public.task_due_reminders, khóa (task_id, user_id, due_date,
--      days_before). Hàm ghi sổ trước (ON CONFLICT DO NOTHING) rồi chỉ tạo thông báo cho dòng sổ MỚI,
--      trong cùng một câu lệnh, nên: chạy lại trong ngày, chạy song song, đổi hạn rồi đổi về hạn cũ
--      đều không ra thông báo trùng. Đổi hạn sang NGÀY KHÁC là hạn mới, có mốc mới: được nhắc lại
--      theo hạn mới (đúng ý người dùng: nhắc theo hạn đang có hiệu lực). Đổi người phụ trách: người
--      mới có khóa khác nên được nhắc ở mốc kế tiếp. Sổ chỉ hệ thống đọc (RLS bật, không chính sách).
--   6. Email: thông báo task_due_soon đi qua trigger E4-2 (mở rộng danh sách loại) nên chỉ vào
--      email_outbox khi người nhận BẬT email loại này. Mặc định BẬT (FR-12: nhắc hạn là lý do chính để
--      có email; một email mỗi task mỗi mốc nên ít). email_outbox_claim kiểm lại LÚC GỬI: còn là
--      người phụ trách, task chưa xong, dự án chưa lưu trữ, hạn chưa qua và còn trong 3 ngày; không
--      đạt thì skipped 'reminder_stale' (không gửi nhắc cho việc đã xong hoặc đã dời hạn xa).
--   7. payload task_due_soon chỉ có {title ≤ 80, due_date 'YYYY-MM-DD', days_left 1|3}; CHECK mới tách
--      khóa theo loại (loại khác không được có due_date/days_left, task_due_soon không có actor_id,
--      status_name). Hiển thị vẫn qua public.notification_payloads (kiểm quyền đọc task).
--   8. public.run_due_reminders(p_now, p_project_id) là SECURITY DEFINER, CHỈ service_role (và postgres,
--      chủ hàm, người chạy job pg_cron) gọi được. p_now để test với "hôm nay" cố định và để chạy tay
--      (`make reminders-run`, REMINDERS_NOW); p_project_id (tùy chọn) giới hạn một dự án khi chạy tay
--      hoặc khi test trên CSDL dùng chung. Job gọi không tham số. pg_cron trên Supabase chạy theo GMT/UTC
--      (cron.timezone = GMT), nên lịch '0 1 * * *' = 08:00 giờ Việt Nam (không có giờ mùa hè).

-- ---------------------------------------------------------------------------
-- 1. Mở rộng loại và payload của notifications (giữ chống rò rỉ)
-- ---------------------------------------------------------------------------
alter table public.notifications
  drop constraint notifications_type_check,
  drop constraint notifications_payload_shape;

alter table public.notifications
  add constraint notifications_type_check
    check (type in ('task_assigned', 'task_status_changed', 'task_due_soon')),
  add constraint notifications_payload_shape check (
    jsonb_typeof(payload) = 'object'
    and octet_length(payload::text) <= 1024
    and payload - array['title', 'actor_id', 'status_name', 'due_date', 'days_left'] = '{}'::jsonb
    and (not payload ? 'title' or jsonb_typeof(payload -> 'title') = 'string')
    and (not payload ? 'status_name' or jsonb_typeof(payload -> 'status_name') = 'string')
    and (not payload ? 'actor_id' or jsonb_typeof(payload -> 'actor_id') in ('string', 'null'))
    and (not payload ? 'due_date' or (
      jsonb_typeof(payload -> 'due_date') = 'string'
      and (payload ->> 'due_date') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'))
    and (not payload ? 'days_left' or (
      case when jsonb_typeof(payload -> 'days_left') = 'number'
           then (payload ->> 'days_left')::numeric in (1, 3)
           else false end))
    -- Khóa theo loại: nhắc hạn không mang người làm/trạng thái; loại khác không mang hạn.
    and (type <> 'task_due_soon' or payload - array['title', 'due_date', 'days_left'] = '{}'::jsonb)
    and (type = 'task_due_soon' or not (payload ? 'due_date' or payload ? 'days_left'))
  );
comment on column public.notifications.payload is
  '{title ≤ 80 ký tự, actor_id, status_name ≤ 60} hoặc với task_due_soon {title, due_date, '
  'days_left}. Không chứa mô tả hay email; khi hiển thị phải kiểm lại quyền đọc task.';

-- ---------------------------------------------------------------------------
-- 2. Tùy chọn email: loại mới, mặc định BẬT (quyết định 6)
-- ---------------------------------------------------------------------------
alter table public.notification_preferences
  drop constraint notification_preferences_type_check;
alter table public.notification_preferences
  add constraint notification_preferences_type_check
    check (type in ('task_assigned', 'task_status_changed', 'task_due_soon'));
comment on table public.notification_preferences is
  'Bật/tắt email theo loại thông báo (FR-12, E4-2, E4-3). Không có dòng = mặc định '
  '(private.email_enabled_default: task_assigned, task_due_soon bật; task_status_changed tắt). '
  'Chỉ chính chủ.';

create or replace function private.email_enabled_default(p_type text)
returns boolean
language sql
immutable
security definer
set search_path = ''
as $$
  select p_type in ('task_assigned', 'task_due_soon');
$$;

create or replace function public.my_notification_preferences()
returns table (type text, email_enabled boolean)
language sql
stable
set search_path = ''
as $$
  select t.type, coalesce(np.email_enabled, private.email_enabled_default(t.type))
  from (values ('task_assigned'), ('task_status_changed'), ('task_due_soon')) as t(type)
  left join public.notification_preferences np
    on np.type = t.type and np.user_id = (select auth.uid())
  where (select auth.uid()) is not null
    and (select private.is_active_user())
  order by t.type;
$$;

-- ---------------------------------------------------------------------------
-- 3. Hàng đợi email: loại mới
-- ---------------------------------------------------------------------------
alter table public.email_outbox drop constraint email_outbox_type_check;
alter table public.email_outbox
  add constraint email_outbox_type_check
    check (type in ('task_assigned', 'task_status_changed', 'task_due_soon'));

-- Thân giữ nguyên bản 20261115370000, chỉ thêm 'task_due_soon' vào danh sách loại. actor_id của nhắc
-- hạn là null (hệ thống) nên điều kiện "không tự gửi cho chính mình" luôn đúng.
create or replace function private.enqueue_notification_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.email_outbox (user_id, type, task_id, actor_id)
  select n.user_id, n.type, n.task_id,
         (select p.id from public.profiles p where p.id = (n.payload ->> 'actor_id')::uuid)
  from new_rows n
  where n.type in ('task_assigned', 'task_status_changed', 'task_due_soon')
    and n.user_id is distinct from (n.payload ->> 'actor_id')::uuid
    and private.email_enabled_for(n.user_id, n.type)
  on conflict (user_id, task_id, type) where status = 'pending' do nothing;
  return null;
end;
$$;

-- email_outbox_claim: thêm due_date, days_left vào kết quả và kiểm "nhắc còn đúng" lúc gửi (quyết
-- định 6). Đổi kiểu trả về nên phải DROP rồi tạo lại (cấp quyền lại bên dưới).
drop function public.email_outbox_claim(integer, integer);
create function public.email_outbox_claim(
  p_limit integer default 20,
  p_max_attempts integer default 4
)
returns table (
  id uuid,
  type text,
  task_id uuid,
  project_id uuid,
  attempts integer,
  recipient_email text,
  recipient_locale text,
  recipient_name text,
  task_title text,
  project_name text,
  status_name text,
  actor_name text,
  due_date date,
  days_left integer
)
language sql
volatile
security definer
set search_path = ''
as $$
  with picked as (
    select o.id,
           case
             when o.attempts >= greatest(p_max_attempts, 1) then 'max_attempts'
             when o.created_at < now() - interval '24 hours' then 'expired'
             when not (
               p.is_active
               and coalesce(btrim(p.email), '') <> ''
               and private.notification_recipient_ok(o.user_id, t.project_id)
               and (o.type not in ('task_assigned', 'task_due_soon') or t.assignee_id = o.user_id)
             ) then 'recipient_not_eligible'
             when o.type = 'task_due_soon' and not (
               t.completed_at is null
               and pr.status = 'active'
               and t.due_date is not null
               and t.due_date - (now() at time zone 'Asia/Ho_Chi_Minh')::date between 0 and 3
             ) then 'reminder_stale'
           end as reason
    from public.email_outbox o
    join public.tasks t on t.id = o.task_id
    join public.projects pr on pr.id = t.project_id
    join public.profiles p on p.id = o.user_id
    where o.status = 'pending'
      and o.next_attempt_at <= now()
    order by o.next_attempt_at, o.id
    limit least(greatest(coalesce(p_limit, 20), 1), 100)
    for update of o skip locked
  ),
  dropped as (
    update public.email_outbox o
    set status = case when k.reason = 'max_attempts' then 'failed' else 'skipped' end,
        last_error = k.reason
    from picked k
    where o.id = k.id and k.reason is not null
    returning o.id
  ),
  claimed as (
    update public.email_outbox o
    set attempts = o.attempts + 1,
        next_attempt_at = now() + interval '5 minutes'
    from picked k
    where o.id = k.id and k.reason is null
    returning o.id, o.type, o.task_id, o.user_id, o.actor_id, o.attempts
  )
  select c.id, c.type, c.task_id, t.project_id, c.attempts::integer,
         btrim(p.email), p.locale, p.full_name, t.title, pr.name, s.name, a.full_name,
         case when c.type = 'task_due_soon' then t.due_date end,
         case when c.type = 'task_due_soon'
              then (t.due_date - (now() at time zone 'Asia/Ho_Chi_Minh')::date)::integer end
  from claimed c
  join public.tasks t on t.id = c.task_id
  join public.projects pr on pr.id = t.project_id
  join public.task_statuses s on s.id = t.status_id
  join public.profiles p on p.id = c.user_id
  left join public.profiles a on a.id = c.actor_id
  order by c.id;
$$;
comment on function public.email_outbox_claim(integer, integer) is
  'Worker email (QLDA-66, QLDA-74): nhận dòng đến hạn, kiểm quyền người nhận và (nhắc hạn) task còn '
  'cần nhắc lúc gửi. Chỉ service_role.';

revoke all on function public.email_outbox_claim(integer, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.email_outbox_claim(integer, integer) to service_role;

-- ---------------------------------------------------------------------------
-- 4. Sổ nhắc hạn: chống trùng (quyết định 5)
-- ---------------------------------------------------------------------------
create table public.task_due_reminders (
  task_id uuid not null references public.tasks (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  -- Hạn tại thời điểm nhắc; đổi hạn sang ngày khác là mốc mới.
  due_date date not null,
  days_before smallint not null,
  -- Ngày (giờ Việt Nam) đã nhắc.
  reminded_on date not null,
  created_at timestamptz not null default now(),
  primary key (task_id, user_id, due_date, days_before),
  constraint task_due_reminders_days_before_check check (days_before in (1, 3)),
  constraint task_due_reminders_on_check check (reminded_on = due_date - days_before)
);
comment on table public.task_due_reminders is
  'Sổ nhắc hạn đã gửi (E4-3): mỗi (task, người nhận, hạn, mốc) một dòng, chống nhắc trùng khi job '
  'chạy lại. Chỉ hệ thống ghi (public.run_due_reminders); không ai khác đọc trừ service_role.';

create index task_due_reminders_user_id_idx on public.task_due_reminders (user_id);

revoke all on public.task_due_reminders from public, anon, authenticated, service_role;
grant select on public.task_due_reminders to service_role;
alter table public.task_due_reminders enable row level security;
-- Không có chính sách: anon, authenticated không thấy dòng nào (và không có quyền bảng).

-- Chỉ mục phục vụ quét hằng ngày: task chưa xong theo hạn (một phần, nhỏ).
create index tasks_open_due_date_idx on public.tasks (due_date)
  where completed_at is null and due_date is not null and assignee_id is not null;

-- ---------------------------------------------------------------------------
-- 5. Hàm lập lịch (quyết định 1, 3, 4, 5, 8)
-- ---------------------------------------------------------------------------
-- Tạo thông báo task_due_soon cho mọi task đúng mốc của "hôm nay" (giờ Việt Nam tại p_now). Trả về
-- số thông báo mới tạo (0 khi chạy lại cùng ngày). Email do trigger E4-2 ghi hàng đợi.
create or replace function public.run_due_reminders(
  p_now timestamptz default now(),
  p_project_id uuid default null
)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_today date;
  v_count integer;
begin
  if p_now is null then
    raise exception 'p_now must not be null' using errcode = '22004';
  end if;
  v_today := (p_now at time zone 'Asia/Ho_Chi_Minh')::date;

  with candidates as (
    select t.id as task_id, t.assignee_id as user_id, t.due_date,
           (t.due_date - v_today)::smallint as days_before
    from public.tasks t
    join public.projects pr on pr.id = t.project_id
    where t.completed_at is null
      and t.assignee_id is not null
      and t.due_date is not null
      and t.due_date in (v_today + 1, v_today + 3)
      and pr.status = 'active'
      and (p_project_id is null or t.project_id = p_project_id)
      and private.notification_recipient_ok(t.assignee_id, t.project_id)
  ),
  logged as (
    insert into public.task_due_reminders (task_id, user_id, due_date, days_before, reminded_on)
    select c.task_id, c.user_id, c.due_date, c.days_before, v_today
    from candidates c
    on conflict do nothing
    returning task_id, user_id, due_date, days_before
  )
  insert into public.notifications (user_id, type, task_id, project_id, payload)
  select l.user_id, 'task_due_soon', l.task_id, t.project_id,
         jsonb_build_object(
           'title', private.notification_text(t.title, 80),
           'due_date', to_char(l.due_date, 'YYYY-MM-DD'),
           'days_left', l.days_before
         )
  from logged l
  join public.tasks t on t.id = l.task_id;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
comment on function public.run_due_reminders(timestamptz, uuid) is
  'Nhắc hạn (QLDA-74): task chưa xong có hạn = hôm nay (giờ VN tại p_now) + 1 hoặc + 3, gửi người '
  'phụ trách còn quyền; chống trùng qua task_due_reminders. p_project_id: chỉ một dự án (chạy tay). '
  'pg_cron 01:00 UTC. Chỉ service_role.';

revoke all on function public.run_due_reminders(timestamptz, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.run_due_reminders(timestamptz, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 6. Lịch pg_cron: 01:00 UTC = 08:00 giờ Việt Nam, mỗi ngày (quyết định 1, 8)
-- ---------------------------------------------------------------------------
select cron.schedule(
  'qlda-due-reminders',
  '0 1 * * *',
  'select public.run_due_reminders()'
);
