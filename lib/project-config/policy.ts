import type { ApiError } from "@/lib/api/errors";
import { apiError } from "@/lib/api/respond";
import { strings } from "@/lib/strings";
import type { ConfigKind } from "./model";

/**
 * Logic quyền và ánh xạ lỗi thuần (không I/O) cho API cấu hình dự án. Lớp kiểm thứ nhất (403 rõ
 * ràng); RLS trong migration 20261115130000_task_statuses_types_labels.sql là lớp thứ hai.
 */

export type ProjectRole = "pm" | "member" | "viewer";

export interface ConfigActor {
  userId: string;
  isAdmin: boolean;
  role: ProjectRole | null;
}

/** Thêm, sửa, xóa trạng thái, loại task, nhãn: PM của dự án và Admin (api-contract.md: ghi A P). */
export function canManageConfig(actor: ConfigActor): boolean {
  return actor.isAdmin || actor.role === "pm";
}

const t = strings.projectConfig.errors;

/**
 * Lỗi Postgres khi ghi cấu hình → lỗi API; null nếu là lỗi hệ thống (nơi gọi trả 500).
 *   - 23505 trùng tên trong dự án: 409.
 *   - P0001 status_in_use / type_in_use, 23503 (khóa ngoại: còn task dùng): 409.
 *   - P0001 invalid_replacement, last_status_of_category, last_task_type: 422.
 *   - P0002 not_found (hàm xóa không thấy dòng hoặc không có quyền xóa): 404.
 *   - 23514 (CHECK, schema API đã chặn trước): 400. 42501 (RLS, quyền cột): 403.
 */
export function mapConfigWriteError(
  kind: ConfigKind,
  error: { code?: string; message?: string },
): ApiError | null {
  switch (error.code) {
    case "23505":
      return apiError("conflict", t.nameExists[kind], [
        { field: "name", issue: "invalid_value" },
      ]);
    case "23503":
      return inUse(kind);
    case "P0001":
      switch (error.message) {
        case "status_in_use":
        case "type_in_use":
          return inUse(kind);
        case "invalid_replacement":
          return apiError("business_rule_violated", t.invalidReplacement, [
            { field: "replace_with", issue: "invalid_value" },
          ]);
        case "last_status_of_category":
          return apiError("business_rule_violated", t.lastOfCategory, [
            { field: "category", issue: "invalid_value" },
          ]);
        case "last_task_type":
          return apiError("business_rule_violated", t.lastType);
        default:
          return null;
      }
    case "P0002":
      return apiError("not_found");
    case "23514":
      return apiError("validation_failed");
    case "42501":
      return apiError("forbidden");
    default:
      return null;
  }
}

function inUse(kind: ConfigKind): ApiError {
  return apiError("conflict", t.inUse[kind], [
    { field: "replace_with", issue: "required" },
  ]);
}

/**
 * Lỗi cấu hình khi ghi task (trigger apply_task_config, check_task_label_project) → 422; null nếu
 * không phải lỗi loại này. Dùng trong lib/tasks/policy.ts.
 */
export function mapTaskConfigError(error: {
  code?: string;
  message?: string;
}): ApiError | null {
  if (error.code === "P0001") {
    switch (error.message) {
      case "status_not_in_project":
        return apiError("business_rule_violated", t.statusNotInProject, [
          { field: "status_id", issue: "invalid_value" },
        ]);
      case "type_not_in_project":
        return apiError("business_rule_violated", t.typeNotInProject, [
          { field: "type_id", issue: "invalid_value" },
        ]);
      case "label_not_in_project":
        return labelNotInProject();
    }
  }
  if (error.code === "23503") {
    // Khóa ngoại kép (cùng dự án) hoặc nhãn vừa bị xóa: lưới đỡ sau trigger.
    return apiError("business_rule_violated", t.statusNotInProject);
  }
  return null;
}

export function labelNotInProject(): ApiError {
  return apiError("business_rule_violated", t.labelNotInProject, [
    { field: "label_ids", issue: "invalid_value" },
  ]);
}
