-- QLDA-58 (Story E8-3): cảnh báo task bị chặn (BR-06), cờ `blocked`/`blocked_by` ở API task.
-- Thiết kế: docs/03-design/database.md mục 6 (BR-06 không chặn cứng, đọc task_relations kind
-- `blocks`); api-contract.md mục 4 (ví dụ "Kéo thả Kanban": PATCH 200 kèm warnings).
--
-- Quyết định:
--   1. Định nghĩa "bị chặn bởi": tồn tại quan hệ `blocks` từ task KHÁC (from) tới task này (to) mà
--      task from CHƯA XONG (completed_at null ⇔ trạng thái không thuộc nhóm done, trigger E2-3).
--      Cùng định nghĩa với số "bị chặn" của dashboard (20261115250000_project_dashboard.sql).
--      Hàm này chỉ trả task chặn còn mở; việc task đích tự đã xong thì không coi là bị chặn nữa là
--      quyết định của tầng API (lib/tasks/blocked.ts), để PATCH vẫn biết task vừa hoàn thành có còn
--      task chặn mở hay không (cảnh báo `blocked_by_open_task`).
--   2. `precedes` (đứng trước) KHÔNG chặn: chỉ là thứ tự lịch (Gantt, E12), không cảnh báo khi
--      hoàn thành. `relates`, `duplicates` cũng không.
--   3. Một truy vấn tập hợp cho cả trang (tối đa 500 task, LIST_LIMIT_MAX), không N+1: lọc
--      task_relations theo to_task_id = any(mảng) dùng chỉ mục task_relations_to_task_id_idx, nối
--      tasks theo khóa chính. Gọi bằng POST (mảng nằm trong thân, không làm dài URL).
--   4. SECURITY INVOKER: RLS của task_relations (thấy cả hai task) và tasks áp dụng nguyên vẹn, nên
--      chỉ tính task người gọi đọc được; dự án/task người gọi không thấy thì không có dòng nào (không
--      lộ sự tồn tại). Không cần hàm SECURITY DEFINER mới.
--   5. Trả tối đa p_limit id (mặc định 5, tối đa 20) theo thứ tự tạo task chặn, cộng tổng số task
--      chặn mở, để giao diện biết danh sách bị cắt.
--   6. Chặn mảng quá lớn (> 1000 phần tử): 22023, tránh gọi thẳng RPC với mảng khổng lồ.

create or replace function public.task_open_blockers(p_task_ids uuid[], p_limit integer default 5)
returns table (task_id uuid, blocker_ids uuid[], blocker_count integer)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if p_task_ids is null or cardinality(p_task_ids) = 0 then
    return;
  end if;
  if cardinality(p_task_ids) > 1000 then
    raise exception 'too many task ids' using errcode = '22023';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 20 then
    raise exception 'invalid limit' using errcode = '22023';
  end if;

  return query
  select
    r.to_task_id,
    (array_agg(r.from_task_id order by b.created_at, b.id))[1:p_limit],
    count(*)::integer
  from public.task_relations r
  join public.tasks b on b.id = r.from_task_id
  where r.to_task_id = any(p_task_ids)
    and r.kind = 'blocks'
    and b.completed_at is null
  group by r.to_task_id;
end;
$$;
comment on function public.task_open_blockers(uuid[], integer) is
  'Task chặn CÒN MỞ (quan hệ blocks, from chưa xong) của từng task trong mảng (QLDA-58, BR-06). '
  'SECURITY INVOKER: chỉ tính quan hệ và task người gọi thấy qua RLS. precedes không chặn.';
revoke all on function public.task_open_blockers(uuid[], integer) from public, anon, authenticated;
grant execute on function public.task_open_blockers(uuid[], integer) to authenticated;
