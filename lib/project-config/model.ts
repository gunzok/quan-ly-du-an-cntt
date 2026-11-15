/**
 * Cấu hình dự án (Story E2-3, QLDA-41): trạng thái, loại task, nhãn. Trường trùng tên cột bảng
 * public.task_statuses, public.task_types, public.labels (migration
 * 20261115130000_task_statuses_types_labels.sql); `task_count` lấy từ
 * public.project_config_task_counts().
 */
export type StatusCategory = "todo" | "in_progress" | "done";

export const STATUS_CATEGORIES: readonly StatusCategory[] = [
  "todo",
  "in_progress",
  "done",
];

export interface TaskStatus {
  id: string;
  project_id: string;
  name: string;
  category: StatusCategory;
  color: string;
  position: number;
  created_at: string;
  updated_at: string;
  /** Số task đang ở trạng thái này (người gọi thấy được). */
  task_count: number;
}

export interface TaskType {
  id: string;
  project_id: string;
  name: string;
  is_milestone: boolean;
  color: string;
  position: number;
  created_at: string;
  updated_at: string;
  task_count: number;
}

export interface Label {
  id: string;
  project_id: string;
  name: string;
  color: string;
  created_at: string;
  updated_at: string;
  task_count: number;
}

/** Ba loại cấu hình; cũng là đoạn đường dẫn API (`/api/v1/<kind>/{id}`). */
export type ConfigKind = "statuses" | "task-types" | "labels";

export interface ConfigItemByKind {
  statuses: TaskStatus;
  "task-types": TaskType;
  labels: Label;
}

export interface ConfigTable {
  table: "task_statuses" | "task_types" | "labels";
  /** Cột đọc: liệt kê tường minh, không dùng `*`. */
  columns: string;
  /** Giá trị `kind` trong public.project_config_task_counts(). */
  countKind: "status" | "type" | "label";
  /** Có cột position (sắp theo position); nhãn sắp theo tên. */
  ordered: boolean;
  /** Hàm xóa có chuyển task sang mục thay thế (trạng thái, loại). Nhãn xóa thẳng. */
  deleteRpc: { fn: string; idArg: string } | null;
}

export const CONFIG_TABLES: Record<ConfigKind, ConfigTable> = {
  statuses: {
    table: "task_statuses",
    columns:
      "id, project_id, name, category, color, position, created_at, updated_at",
    countKind: "status",
    ordered: true,
    deleteRpc: { fn: "delete_task_status", idArg: "p_status_id" },
  },
  "task-types": {
    table: "task_types",
    columns:
      "id, project_id, name, is_milestone, color, position, created_at, updated_at",
    countKind: "type",
    ordered: true,
    deleteRpc: { fn: "delete_task_type", idArg: "p_type_id" },
  },
  labels: {
    table: "labels",
    columns: "id, project_id, name, color, created_at, updated_at",
    countKind: "label",
    ordered: false,
    deleteRpc: null,
  },
};

/**
 * Bảng màu gợi ý cho giao diện (màu chỉ để trang trí, luôn kèm chữ). API nhận mọi màu #RRGGBB;
 * giá trị trùng màu mặc định trong migration.
 */
export const CONFIG_COLORS = [
  { value: "#8A93A6", key: "gray" },
  { value: "#2054F0", key: "blue" },
  { value: "#7C3AED", key: "purple" },
  { value: "#E56DAF", key: "pink" },
  { value: "#D97706", key: "amber" },
  { value: "#137035", key: "green" },
  { value: "#4B5563", key: "slate" },
  { value: "#C0262D", key: "red" },
] as const;

export type ConfigColorKey = (typeof CONFIG_COLORS)[number]["key"];

/** Thứ tự hiển thị: theo position rồi tên (trạng thái, loại); nhãn theo tên tiếng Việt. */
export function compareConfigItems(
  a: { name: string; position?: number; id: string },
  b: { name: string; position?: number; id: string },
): number {
  const pa = a.position ?? 0;
  const pb = b.position ?? 0;
  if (pa !== pb) return pa - pb;
  const byName = a.name.localeCompare(b.name, "vi");
  return byName !== 0 ? byName : a.id.localeCompare(b.id);
}

/**
 * Vị trí mới khi đưa mục ở chỉ số `index` lên (-1) hoặc xuống (+1) một bậc trong danh sách đã
 * sắp xếp: lấy điểm giữa hai hàng xóm ở chỗ mới để chỉ cần sửa MỘT dòng. null nếu không đi được.
 */
export function positionForMove(
  positions: readonly number[],
  index: number,
  direction: -1 | 1,
): number | null {
  const target = index + direction;
  if (index < 0 || index >= positions.length) return null;
  if (target < 0 || target >= positions.length) return null;
  if (direction === -1) {
    const before = target - 1 >= 0 ? positions[target - 1] : null;
    const at = positions[target];
    return before === null ? at - 1 : (before + at) / 2;
  }
  const after = target + 1 < positions.length ? positions[target + 1] : null;
  const at = positions[target];
  return after === null ? at + 1 : (at + after) / 2;
}
