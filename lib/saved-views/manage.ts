import type { ApiError } from "@/lib/api/errors";
import { SAVED_VIEW_NAME_MAX_LENGTH, type SavedView } from "./model";
import { normalizeViewName } from "./validate";

/**
 * Quản lý chế độ xem trên giao diện (Story E13-3, QLDA-63): lưu mới, lưu thay đổi, đổi tên, công
 * khai/riêng tư, xóa. Thuần, không I/O, để test đơn vị.
 *
 * Đây chỉ là lớp HIỂN THỊ (ẩn/khóa nút, giải thích). Quyền thật do API (lib/saved-views/policy.ts)
 * và RLS kiểm ở từng request; giao diện lệch thì API vẫn trả 403 và giao diện báo lại thân thiện.
 */

export interface ManageActor {
  userId: string;
  isAdmin: boolean;
  role: "pm" | "member" | "viewer" | null;
}

/** Tạo/sửa chế độ xem công khai: PM của dự án và Admin (trùng canManagePublicViews). */
export function canChoosePublic(actor: ManageActor): boolean {
  return actor.isAdmin || actor.role === "pm";
}

/** Lưu chế độ xem riêng: mọi vai trò trong dự án (kể cả Người xem) và Admin. */
export function canSaveViews(actor: ManageActor): boolean {
  return actor.isAdmin || actor.role !== null;
}

/** Vì sao chế độ xem đang chọn chỉ đọc (null: sửa được). */
export type ReadOnlyReason = "default" | "public" | "other";

export interface ViewActions {
  /** Lưu thay đổi, đổi tên, xóa (theo `can_edit` API tính cho người gọi). */
  canEdit: boolean;
  /** Chuyển riêng tư → công khai. */
  canPublish: boolean;
  /** Chuyển công khai → riêng tư: chỉ chủ sở hữu (E13-1). */
  canPrivatize: boolean;
  readOnlyReason: ReadOnlyReason | null;
}

export function viewActions(view: SavedView, actor: ManageActor): ViewActions {
  const canEdit = view.can_edit && !view.is_default;
  const owner = view.owner_id !== null && view.owner_id === actor.userId;
  return {
    canEdit,
    canPublish:
      canEdit && view.visibility === "private" && canChoosePublic(actor),
    canPrivatize: canEdit && view.visibility === "public" && owner,
    readOnlyReason: canEdit
      ? null
      : view.is_default
        ? "default"
        : view.visibility === "public"
          ? "public"
          : "other",
  };
}

export type NameProblem = "required" | "too_long";

/** Kiểm tên như API (cắt hai đầu, gộp khoảng trắng; 1..100 ký tự). */
export function checkViewName(raw: string): {
  name: string;
  problem: NameProblem | null;
} {
  const name = normalizeViewName(raw);
  return {
    name,
    problem:
      name === ""
        ? "required"
        : name.length > SAVED_VIEW_NAME_MAX_LENGTH
          ? "too_long"
          : null,
  };
}

/**
 * Lỗi ghi chế độ xem → cách giao diện xử lý:
 *   - `name_conflict` (409): báo ngay dưới ô tên, giữ hộp thoại mở.
 *   - `not_found` (404): chế độ xem đã bị xóa hoặc không còn thấy; tải lại danh sách.
 *   - `forbidden` (403): quyền vừa đổi hoặc giao diện lệch; báo lý do, tải lại danh sách.
 *   - `invalid` (400): tên/cách xem không hợp lệ.
 *   - `other`: lỗi mạng, 5xx, giới hạn tần suất.
 */
export type WriteProblem =
  "name_conflict" | "not_found" | "forbidden" | "invalid" | "other";

export function classifyWriteError(error: ApiError): WriteProblem {
  switch (error.code) {
    case "conflict":
      return "name_conflict";
    case "not_found":
      return "not_found";
    case "forbidden":
      return "forbidden";
    case "validation_failed":
      return "invalid";
    default:
      return "other";
  }
}

/** Thay (theo id) hoặc thêm một chế độ xem vào danh sách đang hiện. */
export function upsertView(
  views: readonly SavedView[],
  view: SavedView,
): SavedView[] {
  const i = views.findIndex((v) => v.id === view.id);
  if (i === -1) return [...views, view];
  const next = views.slice();
  next[i] = view;
  return next;
}

export function removeView(
  views: readonly SavedView[],
  id: string,
): SavedView[] {
  return views.filter((v) => v.id !== id);
}

/** Tên gợi ý khi lưu thành chế độ xem mới từ một chế độ xem có sẵn ("<tên> (bản sao)"). */
export function suggestCopyName(base: string, suffix: string): string {
  const name = `${normalizeViewName(base)} ${suffix}`.trim();
  return name.length > SAVED_VIEW_NAME_MAX_LENGTH
    ? name.slice(0, SAVED_VIEW_NAME_MAX_LENGTH).trimEnd()
    : name;
}
