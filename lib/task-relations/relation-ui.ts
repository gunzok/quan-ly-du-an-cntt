import type { ApiError } from "@/lib/api/errors";
import {
  canEditTask,
  type Actor,
  type TaskOwnership,
} from "@/lib/tasks/policy";
import {
  relationLabel,
  type RelationLabel,
  type TaskRelationKind,
  type TaskRelationView,
  type RelatedTask,
} from "./model";
import { LAG_DAYS_MAX_ABS } from "./validate";

/**
 * Logic thuần (không I/O, không React) của giao diện thêm/bỏ quan hệ trong ngăn chi tiết task
 * (Story E8-2, S05 v2). Tách ra để test đơn vị.
 *
 * Bảng chỉ lưu một chiều (from → to) với 4 kiểu. Người dùng chọn kiểu theo GÓC NHÌN của task đang
 * xem ("Bị chặn bởi X"), nên kiểu đảo (blocked_by, follows) được gửi từ phía task đích:
 * POST /tasks/{X}/relations { kind: "blocks", to_task_id: <task đang xem> }. API kiểm quyền sửa cả
 * hai task bất kể gọi từ đầu nào.
 */

/** Kiểu chọn được trong hộp thoại, theo góc nhìn task đang xem (thứ tự hiển thị). */
export type RelationChoice = Exclude<RelationLabel, "duplicated_by">;

export const RELATION_CHOICES: readonly RelationChoice[] = [
  "relates",
  "blocks",
  "blocked_by",
  "precedes",
  "follows",
  "duplicates",
];

/** Kiểu lưu trong bảng và chiều (task đang xem là from hay to) của một lựa chọn. */
const CHOICE_TO_STORED: Record<
  RelationChoice,
  { kind: TaskRelationKind; reversed: boolean }
> = {
  relates: { kind: "relates", reversed: false },
  blocks: { kind: "blocks", reversed: false },
  blocked_by: { kind: "blocks", reversed: true },
  precedes: { kind: "precedes", reversed: false },
  follows: { kind: "precedes", reversed: true },
  duplicates: { kind: "duplicates", reversed: false },
};

/** Lựa chọn có độ trễ (lag_days): chỉ cặp đứng trước / đứng sau (task_relations_lag_days_kind). */
export function choiceHasLag(choice: RelationChoice): boolean {
  return CHOICE_TO_STORED[choice].kind === "precedes";
}

export interface RelationCreateRequest {
  /** Task gọi POST /tasks/{sourceTaskId}/relations (đầu `from` của dòng lưu). */
  sourceTaskId: string;
  body: { kind: TaskRelationKind; to_task_id: string; lag_days?: number };
}

/** Yêu cầu POST cho lựa chọn `choice` giữa task đang xem và task đích. */
export function toCreateRequest(
  choice: RelationChoice,
  currentTaskId: string,
  targetTaskId: string,
  lagDays = 0,
): RelationCreateRequest {
  const { kind, reversed } = CHOICE_TO_STORED[choice];
  const from = reversed ? targetTaskId : currentTaskId;
  const to = reversed ? currentTaskId : targetTaskId;
  const body: RelationCreateRequest["body"] = { kind, to_task_id: to };
  if (kind === "precedes" && lagDays !== 0) body.lag_days = lagDays;
  return { sourceTaskId: from, body };
}

/**
 * Dòng hiển thị cho quan hệ vừa tạo, nhìn từ task đang xem. API trả phần tử nhìn từ task nguồn
 * (có thể là task đích khi chọn kiểu đảo), nên dựng lại theo chiều của lựa chọn.
 */
export function createdView(
  created: Pick<
    TaskRelationView,
    "id" | "kind" | "lag_days" | "created_by" | "created_at"
  >,
  choice: RelationChoice,
  target: RelatedTask,
): TaskRelationView {
  const direction = CHOICE_TO_STORED[choice].reversed ? "incoming" : "outgoing";
  return {
    id: created.id,
    kind: created.kind,
    direction,
    relation: relationLabel(created.kind, direction),
    lag_days: created.lag_days,
    task: { id: target.id, title: target.title, status_id: target.status_id },
    created_by: created.created_by,
    created_at: created.created_at,
  };
}

/** Nhãn của cùng một quan hệ nhìn từ task ở đầu kia (Chặn ↔ Bị chặn bởi...). */
export function oppositeLabel(label: RelationLabel): RelationLabel {
  switch (label) {
    case "blocks":
      return "blocked_by";
    case "blocked_by":
      return "blocks";
    case "precedes":
      return "follows";
    case "follows":
      return "precedes";
    case "duplicates":
      return "duplicated_by";
    case "duplicated_by":
      return "duplicates";
    default:
      return "relates";
  }
}

/** Đọc ô độ trễ: số nguyên trong ±365; rỗng là 0; sai thì null. */
export function parseLagDays(raw: string): number | null {
  const text = raw.trim();
  if (text === "") return 0;
  if (!/^[+-]?\d+$/.test(text)) return null;
  const n = Number(text);
  if (!Number.isSafeInteger(n) || Math.abs(n) > LAG_DAYS_MAX_ABS) return null;
  return n === 0 ? 0 : n;
}

/** Loại lỗi khi thêm/bỏ quan hệ, để giao diện chọn câu giải thích. */
export type RelationErrorKind =
  | "cycle"
  | "duplicate"
  | "selfRelation"
  | "crossProject"
  | "forbidden"
  | "notFound"
  | "other";

/**
 * Lỗi API → loại lỗi. Hai lỗi 409 (vòng, trùng) và hai lỗi 422 (tự quan hệ, khác dự án) phân biệt
 * bằng `message_key` (API gắn khóa từ điển, lib/task-relations/policy.ts).
 */
export function relationErrorKind(error: ApiError): RelationErrorKind {
  const key = error.message_key ?? "";
  switch (error.code) {
    case "conflict":
      return key === "taskRelations.errors.cycle" ? "cycle" : "duplicate";
    case "business_rule_violated":
      if (key === "taskRelations.errors.selfRelation") return "selfRelation";
      if (key === "taskRelations.errors.crossProject") return "crossProject";
      return "other";
    case "forbidden":
      // 403 của Origin (CSRF) chỉ xảy ra khi gọi từ trang lạ; giao diện cùng origin nên coi mọi
      // 403 là thiếu quyền sửa một trong hai task.
      return "forbidden";
    case "not_found":
      return "notFound";
    default:
      return "other";
  }
}

/**
 * Người dùng có thể thêm/bỏ quan hệ ở ngăn này không, tính từ vai trò (chỉ để khóa giao diện; API
 * và RLS kiểm lại):
 *   - "hidden": Người xem, người không thuộc dự án: không thấy nút (AC2).
 *   - "locked": Thành viên không sửa được task đang xem: nút bị khóa kèm giải thích.
 *   - "enabled": Admin, PM, Thành viên sửa được task đang xem (task đích kiểm riêng).
 */
export type RelationAccess = "hidden" | "locked" | "enabled";

export function relationAccess(
  role: Actor["role"],
  isAdmin: boolean,
  canEditCurrent: boolean,
): RelationAccess {
  if (canEditCurrent) return "enabled";
  if (!isAdmin && role === "member") return "locked";
  return "hidden";
}

/** Task đích có sửa được không (BR-03): cần để đặt quan hệ, vì API đòi quyền sửa cả hai task. */
export function canEditTarget(actor: Actor, target: TaskOwnership): boolean {
  return canEditTask(actor, target);
}
