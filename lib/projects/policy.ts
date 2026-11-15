import type { ApiError } from "@/lib/api/errors";
import { apiError } from "@/lib/api/respond";
import { strings } from "@/lib/strings";
import type { ProjectRole } from "./model";

/**
 * Logic quyền thuần (không I/O) cho API dự án. Lớp kiểm thứ nhất (trả 403 rõ ràng); RLS trong
 * migration 20261113120000_users_projects_rls.sql là lớp thứ hai, quyết định cuối.
 * database.md mục 5: PM sửa (kể cả lưu trữ) dự án mình là PM, tạo mới nếu là PM ở ít nhất một dự
 * án; chỉ Admin xóa vĩnh viễn (BR-11, sếp chốt 2026-11-13).
 */

/** Người gọi trong phạm vi một dự án. role = null: không thuộc dự án (Admin vẫn có thể thấy). */
export interface ProjectActor {
  userId: string;
  isAdmin: boolean;
  role: ProjectRole | null;
}

/** Tạo dự án: Admin, hoặc đang là PM ở ít nhất một dự án (private.can_create_project). */
export function canCreateProject(actor: {
  isAdmin: boolean;
  isPmAnywhere: boolean;
}): boolean {
  return actor.isAdmin || actor.isPmAnywhere;
}

/** Sửa, lưu trữ, khôi phục: Admin hoặc PM của dự án. */
export function canEditProject(actor: ProjectActor): boolean {
  return actor.isAdmin || actor.role === "pm";
}

/** Xóa vĩnh viễn: chỉ Admin. */
export function canDeleteProject(actor: ProjectActor): boolean {
  return actor.isAdmin;
}

/** Ngày kết thúc dự án sớm hơn ngày bắt đầu (ràng buộc projects_dates_check). */
export function projectDateOrderError(): ApiError {
  return apiError("business_rule_violated", strings.projects.errors.dateOrder, [
    { field: "end_date", issue: "invalid_value" },
  ]);
}

/**
 * Lỗi Postgres khi ghi dự án → lỗi API; null nếu là lỗi hệ thống (nơi gọi trả 500).
 *   - 23514 `projects_dates_check`: 422.
 *   - 23514 khác (độ dài tên, mô tả, trạng thái): 400. Schema API đã chặn trước, đây là lưới đỡ.
 *   - 42501 (RLS hoặc quyền cột): 403.
 */
export function mapProjectWriteError(error: {
  code?: string;
  message?: string;
}): ApiError | null {
  switch (error.code) {
    case "23514":
      if (error.message?.includes("projects_dates_check")) {
        return projectDateOrderError();
      }
      return apiError("validation_failed");
    case "42501":
      return apiError("forbidden");
    default:
      return null;
  }
}
