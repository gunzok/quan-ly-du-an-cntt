import type { ApiError } from "@/lib/api/errors";
import { apiError } from "@/lib/api/respond";
import type { ProjectRole } from "@/lib/project-config/policy";
import { strings } from "@/lib/strings";
import type { SavedViewRow, SavedViewVisibility } from "./model";

/**
 * Logic quyền và ánh xạ lỗi thuần (không I/O) cho API chế độ xem đã lưu. Lớp kiểm thứ nhất (403 rõ
 * ràng); RLS trong migration 20261115210000_saved_views.sql là lớp thứ hai và phải trùng điều kiện
 * ở đây (test tích hợp và pgTAP cùng kiểm từng vai trò).
 */

export interface ViewActor {
  userId: string;
  isAdmin: boolean;
  /** Vai trò trong dự án của chế độ xem; null nếu không thuộc dự án (hoặc chế độ xem dùng chung). */
  role: ProjectRole | null;
}

type ViewIdentity = Pick<
  SavedViewRow,
  "owner_id" | "visibility" | "is_default"
>;

/** Tạo, sửa, xóa chế độ xem công khai: PM của dự án và Admin. */
export function canManagePublicViews(actor: ViewActor): boolean {
  return actor.isAdmin || actor.role === "pm";
}

/** Có chế độ xem riêng trong dự án: mọi vai trò (kể cả Người xem) và Admin. */
function inProject(actor: ViewActor): boolean {
  return actor.isAdmin || actor.role !== null;
}

export function canCreateView(
  actor: ViewActor,
  visibility: SavedViewVisibility,
): boolean {
  return visibility === "public"
    ? canManagePublicViews(actor)
    : inProject(actor);
}

/** Sửa tên, query, công khai/riêng tư; xóa. Chế độ xem mặc định: không ai. */
export function canEditView(actor: ViewActor, view: ViewIdentity): boolean {
  if (view.is_default) return false;
  if (view.visibility === "public") return canManagePublicViews(actor);
  return view.owner_id === actor.userId && inProject(actor);
}

/**
 * Đổi sang `next`: công khai chỉ PM/Admin; riêng tư chỉ chủ sở hữu (PM khác hay Admin không biến
 * chế độ xem của người khác thành riêng tư của người đó).
 */
export function canSetVisibility(
  actor: ViewActor,
  view: ViewIdentity,
  next: SavedViewVisibility,
): boolean {
  return next === "public"
    ? canManagePublicViews(actor)
    : view.owner_id === actor.userId && inProject(actor);
}

const t = strings.savedViews.errors;

/** Lý do 403 khi không sửa được, để giao diện hiển thị đúng. */
export function editForbidden(view: ViewIdentity): ApiError {
  if (view.is_default) return apiError("forbidden", t.defaultReadOnly);
  if (view.visibility === "public") {
    return apiError("forbidden", t.publicForbidden);
  }
  return apiError("forbidden", t.forbidden);
}

export function visibilityForbidden(next: SavedViewVisibility): ApiError {
  return next === "public"
    ? apiError("forbidden", t.publicForbidden, [
        { field: "visibility", issue: "invalid_value" },
      ])
    : apiError("forbidden", t.privatizeForbidden, [
        { field: "visibility", issue: "invalid_value" },
      ]);
}

/**
 * Lỗi Postgres khi ghi chế độ xem → lỗi API; null nếu là lỗi hệ thống (nơi gọi trả 500).
 *   - 23505 trùng tên (cùng dự án, cùng chủ sở hữu, không phân biệt hoa thường): 409.
 *   - 23514 CHECK (tên, query; schema API đã chặn trước): 400.
 *   - 42501 RLS, quyền cột: 403.
 *   - P0001 saved_view_identity_immutable (đổi dự án, chủ sở hữu; API không gửi): 403.
 */
export function mapViewWriteError(error: {
  code?: string;
  message?: string;
}): ApiError | null {
  switch (error.code) {
    case "23505":
      return apiError("conflict", t.nameExists, [
        { field: "name", issue: "invalid_value" },
      ]);
    case "23514":
      return apiError("validation_failed");
    case "42501":
      return apiError("forbidden");
    case "P0001":
      return error.message === "saved_view_identity_immutable"
        ? apiError("forbidden")
        : null;
    default:
      return null;
  }
}
