import type { ApiError } from "@/lib/api/errors";
import { apiError } from "@/lib/api/respond";
import { strings } from "@/lib/strings";

/**
 * Logic quyền và ánh xạ lỗi thuần (không I/O) cho template dự án (Story E7-1). Lớp kiểm thứ nhất
 * (trả 403/404 rõ ràng); RLS và hai hàm SECURITY DEFINER trong migration 20261115420000 là lớp thứ
 * hai, quyết định cuối.
 */

export type TemplateGate =
  | { ok: true; userId: string; isAdmin: boolean }
  | { ok: false; error: ApiError };

/**
 * Đọc template dự án (dùng chung, BR-08): Admin đang hoạt động hoặc người đang hoạt động là PM ở ít
 * nhất một dự án (giống private.can_create_project). Khác: 403.
 */
export function decideTemplateGate(
  user: { id: string } | null,
  profile: { is_admin: boolean; is_active: boolean } | null,
  isPmSomewhere: boolean,
): TemplateGate {
  if (!user) return { ok: false, error: apiError("unauthenticated") };
  if (!profile || !profile.is_active) {
    return {
      ok: false,
      error: apiError(
        "forbidden",
        strings.projectTemplates.errors.forbiddenRead,
      ),
    };
  }
  if (!profile.is_admin && !isPmSomewhere) {
    return {
      ok: false,
      error: apiError(
        "forbidden",
        strings.projectTemplates.errors.forbiddenRead,
      ),
    };
  }
  return { ok: true, userId: user.id, isAdmin: profile.is_admin };
}

/** Đổi tên, lưu trữ, xóa: người lưu template hoặc Admin. */
export function canManageTemplate(
  actor: { userId: string; isAdmin: boolean },
  createdBy: string | null,
): boolean {
  return actor.isAdmin || (createdBy !== null && createdBy === actor.userId);
}

/** Lưu dự án thành template: Admin hoặc PM của chính dự án đó (người dùng đang hoạt động). */
export function canSaveTemplate(actor: {
  isAdmin: boolean;
  isActive: boolean;
  role: string | null;
}): boolean {
  return actor.isActive && (actor.isAdmin || actor.role === "pm");
}

const E = () => strings.projectTemplates.errors;

export function nameTakenError(): ApiError {
  return apiError("conflict", E().nameTaken, [
    { field: "name", issue: "invalid_value" },
  ]);
}

/**
 * Lỗi Postgres khi lưu, đổi tên, xóa template → lỗi API; null nếu là lỗi hệ thống (nơi gọi trả 500).
 *   - 23505 (tên trùng, chỉ mục project_templates_name_ci_key): 409.
 *   - P0001 template_too_many_tasks / template_too_large: 422.
 *   - P0002 project_not_found: 404 (RPC kiểm lại; API đã kiểm trước).
 *   - 42501 (RLS, quyền cột, RPC từ chối): 403.
 *   - 23514 (CHECK tên lọt qua schema): 400.
 */
export function mapTemplateWriteError(error: {
  code?: string;
  message?: string;
}): ApiError | null {
  switch (error.code) {
    case "23505":
      return nameTakenError();
    case "P0001":
      if (error.message === "template_too_many_tasks") {
        return apiError("business_rule_violated", E().tooManyTasks);
      }
      if (error.message === "template_too_large") {
        return apiError("business_rule_violated", E().tooLarge);
      }
      return null;
    case "P0002":
      return apiError("not_found");
    case "42501":
      return apiError("forbidden");
    case "23514":
      return apiError("validation_failed", undefined, [
        { field: "name", issue: "invalid_value" },
      ]);
    default:
      return null;
  }
}

/**
 * Lỗi của public.create_project_from_template khi tạo dự án có `template_id` → lỗi API; null nếu
 * không phải lỗi riêng của template (nơi gọi thử ánh xạ lỗi dự án, rồi 500).
 *   - P0002 template_not_found (không có, đã lưu trữ, hoặc người gọi không đọc được): 422 trên
 *     trường template_id (template là dữ liệu tham chiếu trong thân request, không phải tài nguyên
 *     của đường dẫn).
 *   - P0001 template_invalid (structure sai schema): 422.
 */
export function mapCreateFromTemplateError(error: {
  code?: string;
  message?: string;
}): ApiError | null {
  if (error.code === "P0002" && error.message === "template_not_found") {
    return apiError("business_rule_violated", E().templateNotFound, [
      { field: "template_id", issue: "invalid_value" },
    ]);
  }
  if (error.code === "P0001" && error.message === "template_invalid") {
    return apiError("business_rule_violated", E().templateInvalid, [
      { field: "template_id", issue: "invalid_value" },
    ]);
  }
  return null;
}
