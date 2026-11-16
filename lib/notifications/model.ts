/**
 * Mô hình thông báo trong app (Story E4-1, QLDA-59; FR-11). Bảng `notifications` chỉ do trigger
 * hệ thống ghi (migration 20261115270000_notifications.sql).
 */

export const NOTIFICATION_TYPES = [
  "task_assigned",
  "task_status_changed",
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/** Cột trình duyệt đọc được (không có payload: payload đọc qua RPC notification_payloads). */
export const NOTIFICATION_COLUMNS =
  "id, type, task_id, project_id, read_at, created_at";

export interface NotificationRow {
  id: string;
  type: NotificationType;
  task_id: string;
  project_id: string;
  read_at: string | null;
  created_at: string;
}

export interface NotificationPayload {
  title?: string;
  actor_id?: string | null;
  status_name?: string;
}

/**
 * Một thông báo trả cho giao diện. `task_visible = false` (người nhận không còn đọc được task, ví dụ
 * đã bị gỡ khỏi dự án): chỉ còn phần trung tính, `title`, `status_name`, `actor` đều null.
 */
export interface Notification extends NotificationRow {
  task_visible: boolean;
  title: string | null;
  status_name: string | null;
  actor: { id: string; full_name: string | null } | null;
}

export interface NotificationListResponse {
  data: Notification[];
  next_cursor: string | null;
  unread_count: number;
}

export interface UnreadCountResponse {
  data: { unread_count: number };
}

export const NOTIFICATION_LIST_LIMIT_DEFAULT = 20;
export const NOTIFICATION_LIST_LIMIT_MAX = 50;
/** Thân POST (đánh dấu đã đọc) chỉ được rỗng hoặc `{}`. */
export const NOTIFICATION_BODY_MAX_BYTES = 256;

/** Đường dẫn tới task của thông báo (ngăn chi tiết task, E2-5). */
export function notificationHref(n: {
  project_id: string;
  task_id: string;
}): string {
  return `/projects/${encodeURIComponent(n.project_id)}/tasks/${encodeURIComponent(n.task_id)}`;
}
