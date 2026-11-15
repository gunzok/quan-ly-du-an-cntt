import type { ApiError } from "@/lib/api/errors";
import { apiError } from "@/lib/api/respond";
import {
  canEditTask,
  type Actor,
  type TaskOwnership,
} from "@/lib/tasks/policy";
import { relationMessages } from "./messages";

/**
 * Logic quyền thuần (không I/O) cho API quan hệ task. Lớp kiểm thứ nhất (403 rõ ràng); RLS
 * task_relations_insert/_delete (migration 20261115170000) là lớp thứ hai, quyết định cuối.
 */

/** Đặt hoặc bỏ quan hệ: cần quyền SỬA cả hai task (api-contract.md mục 3, BR-03). */
export function canManageRelation(
  actor: Actor,
  from: TaskOwnership,
  to: TaskOwnership,
): boolean {
  return canEditTask(actor, from) && canEditTask(actor, to);
}

export function forbiddenRelation(): ApiError {
  return apiError("forbidden", relationMessages.forbiddenEdit);
}

export function selfRelationError(): ApiError {
  return apiError("business_rule_violated", relationMessages.selfRelation, [
    { field: "to_task_id", issue: "invalid_value" },
  ]);
}

export function crossProjectError(): ApiError {
  return apiError("business_rule_violated", relationMessages.crossProject, [
    { field: "to_task_id", issue: "invalid_value" },
  ]);
}

/**
 * Lỗi Postgres khi ghi task_relations → lỗi API. Trả null nếu là lỗi hệ thống (nơi gọi trả 500).
 *   - P0001 `task_relation_cycle` (trigger check_relation, BR-05): 409.
 *   - 23505 (trùng from/to/kind, hoặc relates đảo cặp): 409.
 *   - P0001 `task_relation_cross_project`: 422.
 *   - 23514 `task_relations_not_self`: 422; 23514 khác (lag_days): 400. Schema API đã chặn trước.
 *   - 23503 (task vừa bị xóa giữa lúc đọc và ghi): 404.
 *   - 42501 (RLS hoặc quyền cột): 403.
 */
export function mapRelationWriteError(error: {
  code?: string;
  message?: string;
}): ApiError | null {
  switch (error.code) {
    case "P0001":
      if (error.message === "task_relation_cycle") {
        return apiError("conflict", relationMessages.cycle);
      }
      if (error.message === "task_relation_cross_project") {
        return crossProjectError();
      }
      return null;
    case "23505":
      return apiError("conflict", relationMessages.duplicate);
    case "23514":
      if (error.message?.includes("task_relations_not_self")) {
        return selfRelationError();
      }
      return apiError("validation_failed");
    case "23503":
      return apiError("not_found");
    case "42501":
      return forbiddenRelation();
    default:
      return null;
  }
}
