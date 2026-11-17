import { call } from "@/lib/admin/users/client-api";
import type { SavedView } from "./model";

/**
 * Gọi API chế độ xem từ trình duyệt (Story E13-2, menu S12). Cookie phiên cùng origin, Origin tự
 * gửi; API và RLS kiểm quyền ở từng request (E13-1).
 */
export function fetchViews(projectId: string, signal?: AbortSignal) {
  return call<{ data: SavedView[] }>(
    `/api/v1/projects/${encodeURIComponent(projectId)}/views`,
    { signal },
  );
}

/** Đánh dấu/bỏ yêu thích (của riêng người gọi; chỉ cần đọc được chế độ xem, kể cả Người xem). */
export function setViewFavorite(id: string, isFavorite: boolean) {
  return call<{ data: SavedView }>(`/api/v1/views/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ is_favorite: isFavorite }),
  });
}
