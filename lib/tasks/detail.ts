import type { SupabaseClient } from "@supabase/supabase-js";
import type { Task } from "./model";
import { canCreateTask, canDeleteTask, canEditTask, type Actor } from "./policy";

/**
 * Phần mở rộng của GET /api/v1/tasks/{id} cho ngăn chi tiết task (Story E2-5, QLDA-46). Chỉ THÊM
 * trường vào `data`, mọi trường cũ giữ nguyên (khách API cũ không vỡ):
 *   - `parent`: task cha tóm tắt (id, title) hoặc null; null cả khi cha tồn tại mà người gọi không
 *     thấy (không xảy ra trong cùng dự án vì RLS theo dự án).
 *   - `subtasks`: mọi việc con, cháu (tối đa 2 cấp dưới vì cây tối đa 3 cấp, BR E2-4), tóm tắt,
 *     sắp theo thứ tự cây (duyệt trước, anh em theo position rồi created_at).
 *   - `permissions`: quyền của NGƯỜI GỌI trên task này, để giao diện khóa trường. Chỉ là gợi ý cho
 *     giao diện: PATCH/DELETE/POST vẫn tự kiểm lại, RLS quyết định cuối.
 */

/** Độ sâu tối đa của cây task (khớp CHECK tasks_depth_range và trigger check_task_tree, E2-4). */
export const TASK_MAX_DEPTH = 3;

/** Số việc con tóm tắt tối đa trả trong chi tiết (chặn task có cây con quá lớn). */
export const SUBTASKS_MAX = 200;

export interface TaskSummary {
  id: string;
  parent_id: string | null;
  depth: number;
  title: string;
  status_id: string | null;
  assignee_id: string | null;
  due_date: string | null;
  completed_at: string | null;
  position: number;
  created_at: string;
}

export const TASK_SUMMARY_COLUMNS =
  "id, parent_id, depth, title, status_id, assignee_id, due_date, completed_at, position, created_at";

export interface TaskPermissions {
  /** Sửa task (BR-03): Admin, PM; Thành viên nếu phụ trách hoặc tạo. */
  can_edit: boolean;
  /** Xóa vĩnh viễn: Admin, PM; Thành viên nếu tạo. */
  can_delete: boolean;
  /**
   * Đổi người phụ trách sang người khác (hoặc bỏ giao): Admin, PM, người tạo là Thành viên. Thành
   * viên chỉ phụ trách (không tạo) giao đi thì mất quyền sửa nên API trả 403.
   */
  can_reassign: boolean;
  /** Thêm việc con: tạo được task, sửa được task này và task chưa ở cấp cuối. */
  can_add_subtask: boolean;
}

export interface TaskDetail extends Task {
  parent: { id: string; title: string } | null;
  subtasks: TaskSummary[];
  /** true: cây con có nhiều hơn SUBTASKS_MAX việc, `subtasks` bị cắt. */
  subtasks_truncated: boolean;
  permissions: TaskPermissions;
}

export function taskPermissions(
  actor: Actor,
  task: Pick<Task, "created_by" | "assignee_id" | "depth">,
): TaskPermissions {
  const canEdit = canEditTask(actor, task);
  return {
    can_edit: canEdit,
    can_delete: canDeleteTask(actor, task),
    // Giao cho người khác: sau khi đổi, người gọi vẫn phải sửa được (giống kiểm "after" ở PATCH).
    can_reassign:
      canEdit && canEditTask(actor, { ...task, assignee_id: null }),
    can_add_subtask:
      canCreateTask(actor) && canEdit && task.depth < TASK_MAX_DEPTH,
  };
}

function compareSiblings(a: TaskSummary, b: TaskSummary): number {
  if (a.position !== b.position) return a.position - b.position;
  if (a.created_at !== b.created_at) return a.created_at < b.created_at ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Sắp các việc con theo thứ tự cây dưới rootId (duyệt trước). Dòng có cha không nằm trong cây
 * (dữ liệu cắt ngang) bị bỏ, không lặp vô hạn kể cả khi dữ liệu có vòng.
 */
export function orderSubtaskTree(
  rows: readonly TaskSummary[],
  rootId: string,
): TaskSummary[] {
  const byParent = new Map<string, TaskSummary[]>();
  for (const row of rows) {
    if (!row.parent_id) continue;
    const list = byParent.get(row.parent_id) ?? [];
    list.push(row);
    byParent.set(row.parent_id, list);
  }
  const out: TaskSummary[] = [];
  const seen = new Set<string>([rootId]);
  const visit = (parentId: string) => {
    const children = [...(byParent.get(parentId) ?? [])].sort(compareSiblings);
    for (const child of children) {
      if (seen.has(child.id)) continue;
      seen.add(child.id);
      out.push(child);
      visit(child.id);
    }
  };
  visit(rootId);
  return out;
}

/** Đọc phần mở rộng qua client phiên (RLS). Tối đa TASK_MAX_DEPTH truy vấn cho cây con + 1 cho cha. */
export async function loadTaskDetail(
  session: SupabaseClient,
  task: Task,
  actor: Actor,
): Promise<TaskDetail> {
  const parentQuery = task.parent_id
    ? session
        .from("tasks")
        .select("id, title")
        .eq("id", task.parent_id)
        .maybeSingle()
    : null;

  const rows: TaskSummary[] = [];
  let truncated = false;
  let frontier = [task.id];
  for (
    let level = task.depth;
    level < TASK_MAX_DEPTH && frontier.length > 0 && !truncated;
    level++
  ) {
    const remaining = SUBTASKS_MAX - rows.length;
    const { data, error } = await session
      .from("tasks")
      .select(TASK_SUMMARY_COLUMNS)
      .eq("project_id", task.project_id)
      .in("parent_id", frontier)
      .order("position", { ascending: true })
      .order("created_at", { ascending: true })
      .limit(remaining + 1);
    if (error) throw error;
    const levelRows = (data ?? []) as TaskSummary[];
    if (levelRows.length > remaining) {
      truncated = true;
      rows.push(...levelRows.slice(0, remaining));
    } else {
      rows.push(...levelRows);
    }
    frontier = levelRows.map((r) => r.id);
  }

  let parent: TaskDetail["parent"] = null;
  if (parentQuery) {
    const { data, error } = await parentQuery;
    if (error) throw error;
    parent = (data as { id: string; title: string } | null) ?? null;
  }

  return {
    ...task,
    parent,
    subtasks: orderSubtaskTree(rows, task.id),
    subtasks_truncated: truncated,
    permissions: taskPermissions(actor, task),
  };
}
