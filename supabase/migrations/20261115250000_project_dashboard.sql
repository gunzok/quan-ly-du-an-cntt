-- QLDA-60 (Story E5-1): số liệu dashboard tiến độ S06 (FR-13).
-- Thiết kế: docs/03-design/api-contract.md mục 3 (GET /api/v1/projects/{id}/dashboard).
--
-- Quyết định:
--   1. MỘT hàm `public.project_dashboard(p_project_id, p_today)` tính mọi số liệu trong CSDL và trả
--      một jsonb; API không tải task về Node. SECURITY INVOKER: RLS của projects, tasks,
--      task_statuses, task_types, task_relations, profiles, project_members vẫn áp dụng. Dự án
--      người gọi không thấy (người ngoài, bị khóa) thì trả null (API trả 404, BR-10).
--   2. "Đã xong" = completed_at is not null. Trigger apply_task_config (E2-3) giữ bất biến
--      completed_at có giá trị ⇔ trạng thái thuộc nhóm done, nên đếm theo completed_at hay theo
--      nhóm cho cùng kết quả; dùng completed_at giống public.project_stats (E2-1) để hai màn khớp.
--   3. "Trễ hạn" = chưa xong và due_date < p_today. p_today là ngày "hôm nay" theo giờ Việt Nam do
--      API truyền vào; null thì lấy now() theo Asia/Ho_Chi_Minh. Hạn đúng hôm nay chưa trễ; task
--      không hạn không bao giờ trễ; task đã xong (kể cả xong sau hạn) không tính trễ.
--   4. "Bị chặn" = task chưa xong có ít nhất một quan hệ `blocks` từ một task chưa xong (BR-06).
--   5. Đếm MỌI task của dự án kể cả subtask (giống project_stats).
--   6. Theo người phụ trách: gom theo tasks.assignee_id, có một nhóm "chưa giao" (assignee_id null).
--      Người đã bị gỡ khỏi dự án vẫn giữ task (quyết định E1-6) nên vẫn có nhóm riêng với
--      is_member = false; họ tên lấy qua RLS của profiles nên có thể null nếu người gọi không còn
--      được thấy hồ sơ đó (giao diện hiện "Người đã rời dự án").
--   7. Danh sách task trễ hạn: tối đa 10 task, hạn sớm nhất trước.
--   8. Chỉ mục một phần cho task chưa xong theo hạn (dashboard và E3-4 đều dùng).

create index if not exists tasks_project_open_due_idx
  on public.tasks (project_id, due_date)
  where completed_at is null;

create or replace function public.project_dashboard(
  p_project_id uuid,
  p_today date default null
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_today date := coalesce(p_today, (now() at time zone 'Asia/Ho_Chi_Minh')::date);
  v_result jsonb;
begin
  if p_project_id is null then
    return null;
  end if;
  -- RLS: dự án không thấy được thì không có dòng.
  if not exists (select 1 from public.projects p where p.id = p_project_id) then
    return null;
  end if;

  with t as materialized (
    select
      tk.id,
      tk.title,
      tk.status_id,
      tk.type_id,
      tk.priority,
      tk.assignee_id,
      tk.due_date,
      tk.completed_at is not null as is_done,
      s.category,
      (tk.completed_at is null and tk.due_date < v_today) as is_overdue
    from public.tasks tk
    join public.task_statuses s on s.id = tk.status_id
    where tk.project_id = p_project_id
  ),
  blocked as (
    select count(distinct t.id)::integer as n
    from t
    join public.task_relations r on r.to_task_id = t.id and r.kind = 'blocks'
    join public.tasks b on b.id = r.from_task_id
    where not t.is_done and b.completed_at is null
  ),
  totals as (
    select
      count(*)::integer as total,
      (count(*) filter (where is_done))::integer as done,
      (count(*) filter (where category = 'in_progress'))::integer as in_progress,
      (count(*) filter (where category = 'todo'))::integer as todo,
      (count(*) filter (where is_overdue))::integer as overdue,
      (count(*) filter (where due_date is null and not is_done))::integer as open_no_due
    from t
  ),
  by_status as (
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'id', s.id, 'name', s.name, 'category', s.category, 'color', s.color,
        'count', coalesce(c.n, 0)
      ) order by s.position, s.created_at, s.id
    ), '[]'::jsonb) as v
    from public.task_statuses s
    left join (select status_id, count(*)::integer as n from t group by status_id) c
      on c.status_id = s.id
    where s.project_id = p_project_id
  ),
  by_type as (
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'id', ty.id, 'name', ty.name, 'color', ty.color, 'is_milestone', ty.is_milestone,
        'count', coalesce(c.n, 0)
      ) order by ty.position, ty.created_at, ty.id
    ), '[]'::jsonb) as v
    from public.task_types ty
    left join (select type_id, count(*)::integer as n from t group by type_id) c
      on c.type_id = ty.id
    where ty.project_id = p_project_id
  ),
  by_priority as (
    select jsonb_agg(
      jsonb_build_object('priority', pr.p, 'count', coalesce(c.n, 0)) order by pr.ord
    ) as v
    from (values
      ('urgent'::public.task_priority, 1), ('high', 2), ('medium', 3), ('low', 4)
    ) as pr (p, ord)
    left join (select priority, count(*)::integer as n from t group by priority) c
      on c.priority = pr.p
  ),
  by_assignee as (
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'assignee_id', a.assignee_id,
        'full_name', pf.full_name,
        'is_member', (a.assignee_id is not null and m.user_id is not null),
        'total', a.total, 'done', a.done, 'open', a.total - a.done, 'overdue', a.overdue
      ) order by (a.assignee_id is null), a.total - a.done desc, a.total desc,
        pf.full_name nulls last, a.assignee_id
    ), '[]'::jsonb) as v
    from (
      select
        assignee_id,
        count(*)::integer as total,
        (count(*) filter (where is_done))::integer as done,
        (count(*) filter (where is_overdue))::integer as overdue
      from t
      group by assignee_id
    ) a
    left join public.profiles pf on pf.id = a.assignee_id
    left join public.project_members m
      on m.project_id = p_project_id and m.user_id = a.assignee_id
  ),
  overdue_list as (
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'id', o.id, 'title', o.title, 'due_date', o.due_date,
        'days_overdue', v_today - o.due_date, 'assignee_id', o.assignee_id
      ) order by o.due_date, o.title, o.id
    ), '[]'::jsonb) as v
    from (
      select id, title, due_date, assignee_id
      from t
      where is_overdue
      order by due_date, title, id
      limit 10
    ) o
  )
  select jsonb_build_object(
    'project_id', p_project_id,
    'today', v_today,
    'total', totals.total,
    'done', totals.done,
    'open', totals.total - totals.done,
    'todo', totals.todo,
    'in_progress', totals.in_progress,
    'overdue', totals.overdue,
    'open_no_due', totals.open_no_due,
    'blocked', blocked.n,
    'by_status', by_status.v,
    'by_type', by_type.v,
    'by_priority', by_priority.v,
    'by_assignee', by_assignee.v,
    'overdue_tasks', overdue_list.v
  )
  into v_result
  from totals, blocked, by_status, by_type, by_priority, by_assignee, overdue_list;

  return v_result;
end;
$$;
comment on function public.project_dashboard(uuid, date) is
  'Số liệu dashboard tiến độ S06 (QLDA-60). SECURITY INVOKER: dự án người gọi không thấy qua RLS trả null.';
revoke all on function public.project_dashboard(uuid, date) from public, anon;
grant execute on function public.project_dashboard(uuid, date) to authenticated;
