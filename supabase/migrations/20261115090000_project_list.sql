-- QLDA-37 (Story E2-1): danh sách dự án S02 (FR-03, BR-10). Không thêm cột; bổ sung:
--   1. Ràng buộc độ dài mô tả dự án (trước đây không giới hạn) khớp schema API.
--   2. Chỉ mục cho danh sách mặc định (lọc trạng thái, mới tạo trước, phân trang con trỏ).
--   3. Hàm public.project_stats(): số thành viên, số task, số task đã xong, số task trễ hạn và vai
--      trò của người gọi cho một trang dự án. SECURITY INVOKER: RLS của projects, project_members,
--      tasks, profiles vẫn áp dụng, dự án người gọi không thấy thì không có dòng nào.
--
-- Giới hạn đã biết: trạng thái task (task_statuses, nhóm `done`) thuộc Story E2-3, chưa có. Tạm coi
-- task "đã xong" là completed_at is not null; "trễ hạn" là due_date < hôm nay và completed_at is null.
-- Khi E2-3 đặt completed_at theo trạng thái nhóm done thì hàm này đúng mà không phải sửa.

-- ---------------------------------------------------------------------------
-- 1. Ràng buộc
-- ---------------------------------------------------------------------------
alter table public.projects
  add constraint projects_description_length
  check (description is null or char_length(description) <= 5000);

-- ---------------------------------------------------------------------------
-- 2. Chỉ mục
-- ---------------------------------------------------------------------------
create index projects_status_created_idx
  on public.projects (status, created_at desc, id desc);

-- ---------------------------------------------------------------------------
-- 3. Thống kê cho danh sách dự án
-- ---------------------------------------------------------------------------
-- p_today: ngày "hôm nay" theo giờ người dùng (API truyền ngày theo Asia/Ho_Chi_Minh); null thì
-- lấy ngày hiện tại theo Asia/Ho_Chi_Minh. Tối đa 100 dự án một lần (bằng limit tối đa của API).
-- members_preview: tối đa 3 người (PM trước, rồi theo ngày tham gia), chỉ id và họ tên, không email.
create or replace function public.project_stats(
  p_project_ids uuid[],
  p_today date default null
)
returns table (
  project_id uuid,
  my_role public.project_role,
  member_count integer,
  task_count integer,
  done_task_count integer,
  overdue_task_count integer,
  members_preview jsonb
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_today date := coalesce(p_today, (now() at time zone 'Asia/Ho_Chi_Minh')::date);
begin
  if p_project_ids is null or cardinality(p_project_ids) = 0 then
    return;
  end if;
  if cardinality(p_project_ids) > 100 then
    raise exception 'too_many_projects' using errcode = '22023';
  end if;

  return query
  select
    p.id,
    private.project_role_of(p.id),
    (select count(*)::integer from public.project_members m where m.project_id = p.id),
    t.task_count,
    t.done_task_count,
    t.overdue_task_count,
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object('id', x.user_id, 'full_name', x.full_name)
          order by x.is_pm desc, x.joined_at, x.user_id
        )
        from (
          select m.user_id, pr.full_name, m.role = 'pm' as is_pm, m.joined_at
          from public.project_members m
          join public.profiles pr on pr.id = m.user_id
          where m.project_id = p.id
          order by m.role = 'pm' desc, m.joined_at, m.user_id
          limit 3
        ) x
      ),
      '[]'::jsonb
    )
  from public.projects p
  cross join lateral (
    select
      count(*)::integer as task_count,
      (count(*) filter (where tk.completed_at is not null))::integer as done_task_count,
      (count(*) filter (where tk.completed_at is null and tk.due_date < v_today))::integer
        as overdue_task_count
    from public.tasks tk
    where tk.project_id = p.id
  ) t
  where p.id = any(p_project_ids);
end;
$$;
comment on function public.project_stats(uuid[], date) is
  'Số liệu cho danh sách dự án S02 (QLDA-37). SECURITY INVOKER: chỉ dự án người gọi thấy qua RLS.';
revoke all on function public.project_stats(uuid[], date) from public, anon;
grant execute on function public.project_stats(uuid[], date) to authenticated;
