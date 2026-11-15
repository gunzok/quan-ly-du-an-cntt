import type { ApiError } from "@/lib/api/errors";
import { isUuid } from "@/lib/api/request";
import { apiError } from "@/lib/api/respond";
import { strings } from "@/lib/strings";

/**
 * Việc con (Story E2-4, FR-07, BR-04): ánh xạ lỗi của trigger trong migration
 * 20261115190000_subtasks.sql sang lỗi API, và các lỗi dùng chung cho handler. Thuần, không I/O.
 *
 * Mã HTTP:
 *   - cha không tồn tại hoặc khác dự án (cùng một lỗi, không lộ task dự án khác): 422;
 *   - vượt 3 cấp (kể cả cây con đi theo khi chuyển): 422;
 *   - tự làm cha / tạo vòng: 409 (giống vòng quan hệ BR-05, api-contract.md mục 2);
 *   - đóng task cha khi còn hậu duệ chưa xong (BR-04): 422 kèm `task_ids` (tối đa 5, nông trước);
 *   - không sửa được task cha: 403;
 *   - khóa chết / tuần tự hóa thất bại (40P01, 40001): 409, thử lại.
 */

const t = strings.subtasks.errors;

/** Số id việc con chưa xong tối đa trả về (khớp private.open_subtask_ids(..., 5)). */
export const OPEN_SUBTASK_IDS_MAX = 5;

export function parentNotFound(): ApiError {
  return apiError("business_rule_violated", t.parentNotFound, [
    { field: "parent_id", issue: "invalid_value" },
  ]);
}

export function parentNotEditable(): ApiError {
  return apiError("forbidden", t.parentNotEditable);
}

export function depthExceeded(): ApiError {
  return apiError("business_rule_violated", t.depthExceeded, [
    { field: "parent_id", issue: "invalid_value" },
  ]);
}

export function parentCycle(): ApiError {
  return apiError("conflict", t.cycle, [
    { field: "parent_id", issue: "invalid_value" },
  ]);
}

/** DETAIL của lỗi parent_has_open_subtasks: id cách nhau dấu phẩy. Chỉ giữ uuid hợp lệ. */
export function parseOpenSubtaskIds(detail: unknown): string[] {
  if (typeof detail !== "string") return [];
  return detail
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => isUuid(s))
    .slice(0, OPEN_SUBTASK_IDS_MAX);
}

/**
 * BR-04: 422 kèm `task_ids`. field = null: lỗi không gắn với trường nào (đổi nhóm trạng thái, xóa
 * trạng thái có chuyển task, ở API cấu hình dự án).
 */
export function openSubtasks(
  detail: unknown,
  message: string = t.openSubtasks,
  field: string | null = "status_id",
): ApiError {
  const ids = parseOpenSubtaskIds(detail);
  return {
    ...apiError(
      "business_rule_violated",
      message,
      field ? [{ field, issue: "invalid_value" }] : undefined,
    ),
    ...(ids.length > 0 ? { task_ids: ids } : {}),
  };
}

export interface DbError {
  code?: string;
  message?: string;
  details?: string | null;
}

/**
 * Lỗi Postgres khi ghi task → lỗi API về việc con; null nếu không phải lỗi loại này (nơi gọi xét
 * tiếp các ánh xạ khác).
 */
export function mapSubtaskError(error: DbError): ApiError | null {
  switch (error.code) {
    case "P0001":
      switch (error.message) {
        case "parent_not_in_project":
          return parentNotFound();
        case "subtask_depth_exceeded":
          return depthExceeded();
        case "task_parent_cycle":
          return parentCycle();
        case "parent_has_open_subtasks":
          return openSubtasks(error.details);
        default:
          return null;
      }
    case "42501":
      return error.message === "parent_not_editable"
        ? parentNotEditable()
        : null;
    case "23514":
      // Lưới đỡ: CHECK tasks_parent_not_self (trigger đã báo task_parent_cycle trước),
      // tasks_depth_range (trigger đã báo subtask_depth_exceeded trước).
      if (error.message?.includes("tasks_parent_not_self")) {
        return parentCycle();
      }
      if (error.message?.includes("tasks_depth_range")) return depthExceeded();
      return null;
    case "23503":
      // Task cha vừa bị xóa giữa lúc trigger kiểm và lúc khóa ngoại kiểm.
      return error.message?.includes("tasks_parent_id_fkey")
        ? parentNotFound()
        : null;
    case "40P01":
    case "40001":
      return apiError("conflict", t.concurrentChange);
    default:
      return null;
  }
}
