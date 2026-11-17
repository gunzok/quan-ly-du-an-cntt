import { call } from "@/lib/admin/users/client-api";
import type {
  Notification,
  NotificationListResponse,
  UnreadCountResponse,
} from "./model";

/** Gọi API thông báo từ trình duyệt (cookie phiên cùng origin; trình duyệt tự gửi Origin khi POST). */
export function fetchUnreadCount(signal?: AbortSignal) {
  return call<UnreadCountResponse>("/api/v1/notifications/unread-count", {
    signal,
  });
}

export function fetchNotifications(
  params: { unread?: boolean; cursor?: string | null; limit?: number },
  signal?: AbortSignal,
) {
  const search = new URLSearchParams();
  if (params.unread) search.set("unread", "true");
  if (params.cursor) search.set("cursor", params.cursor);
  if (params.limit) search.set("limit", String(params.limit));
  const qs = search.toString();
  return call<NotificationListResponse>(
    `/api/v1/notifications${qs ? `?${qs}` : ""}`,
    { signal },
  );
}

export function markNotificationRead(id: string) {
  return call<{ data: Notification; unread_count: number }>(
    `/api/v1/notifications/${encodeURIComponent(id)}/read`,
    { method: "POST" },
  );
}

export function markAllNotificationsRead() {
  return call<{ data: { updated: number; unread_count: number } }>(
    "/api/v1/notifications/read-all",
    { method: "POST" },
  );
}
