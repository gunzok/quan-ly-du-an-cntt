import { call } from "@/lib/admin/users/client-api";
import type { SavedView, SavedViewQuery, SavedViewVisibility } from "./model";

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

/** Lưu cách xem hiện tại thành chế độ xem mới (E13-3). Công khai chỉ PM/Admin (API trả 403). */
export function createView(
  projectId: string,
  body: {
    name: string;
    query: SavedViewQuery;
    visibility: SavedViewVisibility;
  },
) {
  return call<{ data: SavedView }>(
    `/api/v1/projects/${encodeURIComponent(projectId)}/views`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

/** Sửa tên, cách xem, công khai/riêng tư (E13-3); quyền do API và RLS kiểm. */
export function updateView(
  id: string,
  patch: {
    name?: string;
    query?: SavedViewQuery;
    visibility?: SavedViewVisibility;
  },
) {
  return call<{ data: SavedView }>(`/api/v1/views/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  });
}

/** Xóa (E13-3): 204, thân rỗng. */
export function deleteView(id: string) {
  return call<null>(`/api/v1/views/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}
