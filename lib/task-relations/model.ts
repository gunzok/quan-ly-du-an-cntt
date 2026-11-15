/**
 * Dạng dữ liệu quan hệ giữa task (Story E8-1, FR-10). Trùng tên cột bảng public.task_relations
 * (migration 20261115170000_task_relations.sql).
 *
 * Bảng chỉ lưu một chiều (from → to). Quan hệ đảo suy ra khi đọc từ phía task `to`:
 *   blocks → blocked_by, precedes → follows, duplicates → duplicated_by, relates → relates.
 */
export type TaskRelationKind = "relates" | "blocks" | "precedes" | "duplicates";

export const TASK_RELATION_KINDS: readonly TaskRelationKind[] = [
  "relates",
  "blocks",
  "precedes",
  "duplicates",
];

/** Kiểu có thứ tự: tham gia đồ thị chống vòng (BR-05). */
export const ORDERED_RELATION_KINDS: readonly TaskRelationKind[] = [
  "blocks",
  "precedes",
];

/** outgoing: task đang xem là `from`; incoming: task đang xem là `to`. */
export type RelationDirection = "outgoing" | "incoming";

/** Kiểu hiển thị từ góc nhìn của task đang xem. */
export type RelationLabel =
  | "relates"
  | "blocks"
  | "blocked_by"
  | "precedes"
  | "follows"
  | "duplicates"
  | "duplicated_by";

const INVERSE: Record<TaskRelationKind, RelationLabel> = {
  relates: "relates",
  blocks: "blocked_by",
  precedes: "follows",
  duplicates: "duplicated_by",
};

export function relationLabel(
  kind: TaskRelationKind,
  direction: RelationDirection,
): RelationLabel {
  return direction === "outgoing" ? kind : INVERSE[kind];
}

/** Một dòng task_relations. */
export interface TaskRelation {
  id: string;
  from_task_id: string;
  to_task_id: string;
  kind: TaskRelationKind;
  lag_days: number;
  created_by: string | null;
  created_at: string;
}

/** Cột chọn khi đọc: liệt kê tường minh, không dùng `*`. */
export const RELATION_COLUMNS =
  "id, from_task_id, to_task_id, kind, lag_days, created_by, created_at";

/** Task ở đầu kia của quan hệ. status_id: trạng thái (danh mục trạng thái thuộc E2-3). */
export interface RelatedTask {
  id: string;
  title: string;
  status_id: string | null;
}

/** Phần tử trả qua API: quan hệ nhìn từ một task. */
export interface TaskRelationView {
  id: string;
  kind: TaskRelationKind;
  direction: RelationDirection;
  relation: RelationLabel;
  lag_days: number;
  task: RelatedTask;
  created_by: string | null;
  created_at: string;
}

export interface TaskRelationListResponse {
  data: TaskRelationView[];
}

/** Dựng phần tử API từ dòng quan hệ, nhìn từ task `viewerTaskId`. */
export function toRelationView(
  row: TaskRelation,
  viewerTaskId: string,
  other: RelatedTask,
): TaskRelationView {
  const direction: RelationDirection =
    row.from_task_id === viewerTaskId ? "outgoing" : "incoming";
  return {
    id: row.id,
    kind: row.kind,
    direction,
    relation: relationLabel(row.kind, direction),
    lag_days: row.lag_days,
    task: { id: other.id, title: other.title, status_id: other.status_id },
    created_by: row.created_by,
    created_at: row.created_at,
  };
}
