/**
 * Dạng dữ liệu task trả qua API (api-contract.md mục 4). Trùng tên cột bảng public.tasks.
 * Chưa có `blocked` (quan hệ chặn, Story E2-5) và danh sách subtask (E2-4). status_id, type_id,
 * label_ids: Story E2-3 (trạng thái, loại, nhãn của chính dự án).
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
  /** Nhãn đang gắn (Story E2-3), sắp theo id. */
  label_ids: string[];
}

/** Cột chọn khi đọc task: liệt kê tường minh, không dùng `*`, để thêm cột mới không lộ ra API. */
export const TASK_COLUMNS =
  "id, project_id, parent_id, depth, type_id, title, description, assignee_id, created_by, priority, start_date, due_date, status_id, position, completed_at, created_at, updated_at";

/**
 * Chuỗi select của PostgREST: cột task kèm nhãn đã gắn (bảng task_labels, RLS theo quyền đọc
 * task). Dùng toTask() để làm phẳng thành label_ids.
 */
export const TASK_SELECT = `${TASK_COLUMNS}, task_labels(label_id)`;

export type TaskRow = Omit<Task, "label_ids"> & {
  task_labels?: { label_id: string }[] | null;
  filter_labels?: unknown;
};

export function toTask(row: TaskRow): Task {
  const { task_labels, filter_labels: _filter, ...rest } = row;
  void _filter;
  return {
    ...rest,
    label_ids: (task_labels ?? []).map((l) => l.label_id).sort(),
  };
}

export interface TaskListResponse {
  data: Task[];
  next_cursor: string | null;
}
