/**
 * Dạng dữ liệu task trả qua API (api-contract.md mục 4). Trùng tên cột bảng public.tasks.
 * Chưa có `blocked` (quan hệ chặn, Story E2-5) và danh sách subtask (E2-4).
 */
export type TaskPriority = "low" | "medium" | "high" | "urgent";

export const TASK_PRIORITIES: readonly TaskPriority[] = [
  "low",
  "medium",
  "high",
  "urgent",
];

export interface Task {
  id: string;
  project_id: string;
  parent_id: string | null;
  depth: number;
  type_id: string | null;
  title: string;
  description: string | null;
  assignee_id: string | null;
  created_by: string | null;
  priority: TaskPriority;
  start_date: string | null;
  due_date: string | null;
  status_id: string | null;
  position: number;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Cột chọn khi đọc task: liệt kê tường minh, không dùng `*`, để thêm cột mới không lộ ra API. */
export const TASK_COLUMNS =
  "id, project_id, parent_id, depth, type_id, title, description, assignee_id, created_by, priority, start_date, due_date, status_id, position, completed_at, created_at, updated_at";

export interface TaskListResponse {
  data: Task[];
  next_cursor: string | null;
}
