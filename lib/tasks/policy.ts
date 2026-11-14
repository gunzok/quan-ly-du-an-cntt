import type { ApiError } from "@/lib/api/errors";
import { apiError } from "@/lib/api/respond";
import { strings } from "@/lib/strings";

/**
 * Logic quyền thuần (không I/O) cho API task, tách ra để test đơn vị. Đây là lớp kiểm thứ nhất
 * (trả 403 rõ ràng); RLS trong migration 20261114090000_tasks.sql là lớp thứ hai, quyết định cuối.
 */

export type ProjectRole = "pm" | "member" | "viewer";

/** Người gọi trong phạm vi một dự án. role = null: không thuộc dự án (Admin vẫn có thể thấy). */
export interface Actor {
  userId: string;
  isAdmin: boolean;
  role: ProjectRole | null;
}

export interface TaskOwnership {
  created_by: string | null;
  assignee_id: string | null;
}

/** Tạo task: Admin, PM, Thành viên; Người xem không (BR-02). */
export function canCreateTask(actor: Actor): boolean {
  return actor.isAdmin || actor.role === "pm" || actor.role === "member";
}

/** Sửa: Admin, PM mọi task; Thành viên task mình phụ trách hoặc tạo (BR-03). */
export function canEditTask(actor: Actor, task: TaskOwnership): boolean {
  if (actor.isAdmin || actor.role === "pm") return true;
  return (
    actor.role === "member" &&
    (task.assignee_id === actor.userId || task.created_by === actor.userId)
  );
}

/** Xóa vĩnh viễn: Admin, PM; Thành viên chỉ task mình tạo (api-contract.md mục 3). */
export function canDeleteTask(actor: Actor, task: TaskOwnership): boolean {
  if (actor.isAdmin || actor.role === "pm") return true;
  return actor.role === "member" && task.created_by === actor.userId;
}

/**
 * Lỗi Postgres khi ghi task → lỗi API. Trả null nếu là lỗi hệ thống (nơi gọi trả 500).
 *   - P0001 `assignee_not_member` (trigger check_assignee): 422.
 *   - 23514 `tasks_dates_check` (BR-13): 422.
 *   - 23514 khác (ràng buộc độ dài, khoảng giá trị): 400. Schema API đã chặn trước, đây là lưới đỡ.
 *   - 42501 (RLS hoặc quyền cột): 403.
 */
export function mapTaskWriteError(error: {
  code?: string;
  message?: string;
}): ApiError | null {
  switch (error.code) {
    case "P0001":
      if (error.message === "assignee_not_member") {
        return apiError(
          "business_rule_violated",
          strings.tasks.errors.assigneeNotMember,
          [{ field: "assignee_id", issue: "invalid_value" }],
        );
      }
      return null;
    case "23514":
      if (error.message?.includes("tasks_dates_check")) {
        return dateOrderError();
      }
      return apiError("validation_failed");
    case "42501":
      return apiError("forbidden");
    default:
      return null;
  }
}

/** BR-13: ngày kết thúc sớm hơn ngày bắt đầu. */
export function dateOrderError(): ApiError {
  return apiError("business_rule_violated", strings.tasks.errors.dateOrder, [
    { field: "due_date", issue: "invalid_value" },
  ]);
}
