import type { ProjectMember, ProjectRole } from "@/lib/project-members/model";
import type { StatusCategory } from "@/lib/project-config/model";
import type { TaskRelationView } from "@/lib/task-relations/model";
import type { TaskDetail, TaskPermissions, TaskSummary } from "./detail";
import type { TaskPatch } from "./validate";

/**
 * Logic thuần của ngăn chi tiết task (Story E2-5): không I/O, không React, để test đơn vị.
 */

/** Trường sửa được trong ngăn chi tiết (lưu theo từng trường). */
export type DetailField =
  | "title"
  | "description"
  | "type_id"
  | "status_id"
  | "assignee_id"
  | "priority"
  | "start_date"
  | "due_date"
  | "label_ids";

/** Ngày hôm nay (YYYY-MM-DD) theo múi giờ hiển thị. */
export function todayIso(
  now: Date = new Date(),
  timeZone = "Asia/Ho_Chi_Minh",
): string {
  // en-CA cho dạng YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** Trễ hạn: có hạn, hạn trước hôm nay, chưa hoàn thành. */
export function isOverdue(
  dueDate: string | null,
  completedAt: string | null,
  today: string,
): boolean {
  return Boolean(dueDate) && !completedAt && (dueDate as string) < today;
}

/**
 * Lý do chỉ đọc để giải thích cho người dùng: "viewer" (Người xem, AC2), "notOwner" (Thành viên
 * không phụ trách, không tạo task), null nếu sửa được.
 */
export function readOnlyReason(
  role: ProjectRole | null,
  isAdmin: boolean,
  permissions: Pick<TaskPermissions, "can_edit">,
): "viewer" | "notOwner" | null {
  if (permissions.can_edit) return null;
  if (!isAdmin && role === "member") return "notOwner";
  return "viewer";
}

/** Trường có sửa được không, theo quyền API trả về. */
export function canEditField(
  field: DetailField,
  permissions: TaskPermissions,
): boolean {
  if (!permissions.can_edit) return false;
  if (field === "assignee_id") return permissions.can_reassign;
  return true;
}

export interface AssigneeOption {
  id: string;
  name: string;
  /** false: không giao mới được (Người xem, tài khoản khóa) nhưng đang là người phụ trách. */
  assignable: boolean;
}

/**
 * Người để giao: PM, Thành viên đang hoạt động (khớp trigger check_assignee). Người đang phụ trách
 * mà không còn hợp lệ vẫn hiện (không chọn lại được) để không mất thông tin.
 */
export function assigneeOptions(
  members: readonly ProjectMember[],
  currentAssigneeId: string | null,
  displayName: (user: ProjectMember["user"]) => string,
): AssigneeOption[] {
  const options: AssigneeOption[] = [];
  for (const m of members) {
    const assignable =
      (m.role === "pm" || m.role === "member") && m.user.is_active;
    if (assignable || m.user_id === currentAssigneeId) {
      options.push({ id: m.user_id, name: displayName(m.user), assignable });
    }
  }
  return options.sort((a, b) =>
    a.name.localeCompare(b.name, "vi", { sensitivity: "base" }),
  );
}

/** Việc con đã xong / tổng (mọi cấp trong cây con). */
export function subtaskProgress(subtasks: readonly TaskSummary[]): {
  done: number;
  total: number;
} {
  return {
    done: subtasks.filter((s) => s.completed_at !== null).length,
    total: subtasks.length,
  };
}

/**
 * Task đang chặn task này mà chưa xong (quan hệ "bị chặn bởi", trạng thái không thuộc nhóm done).
 * Trạng thái không rõ (không có trong danh mục) coi là chưa xong.
 */
export function openBlockers(
  relations: readonly TaskRelationView[],
  categoryOf: (statusId: string | null) => StatusCategory | undefined,
): TaskRelationView[] {
  return relations.filter(
    (r) =>
      r.relation === "blocked_by" && categoryOf(r.task.status_id) !== "done",
  );
}

/** Giá trị cũ của các trường trong patch, để hoàn tác bằng một PATCH ngược. */
export function undoPatch(task: TaskDetail, patch: TaskPatch): TaskPatch {
  const undo: Record<string, unknown> = {};
  for (const key of Object.keys(patch) as (keyof TaskPatch)[]) {
    if (key === "expected_updated_at") continue;
    if (key === "label_ids") {
      undo.label_ids = [...task.label_ids];
      continue;
    }
    if (key in task) undo[key] = task[key as keyof TaskDetail];
  }
  return undo as TaskPatch;
}

/** Patch có thật sự đổi gì so với task hiện tại không (bỏ qua lưu khi người dùng không đổi). */
export function isNoop(task: TaskDetail, patch: TaskPatch): boolean {
  return (Object.keys(patch) as (keyof TaskPatch)[]).every((key) => {
    if (key === "expected_updated_at") return true;
    if (key === "label_ids") {
      const next = [...(patch.label_ids ?? [])].sort();
      const prev = [...task.label_ids].sort();
      return next.length === prev.length && next.every((v, i) => v === prev[i]);
    }
    return patch[key] === task[key as keyof TaskDetail];
  });
}

/** Văn bản mô tả người dùng nhập → giá trị gửi API: chỉ khoảng trắng thì xóa mô tả (null). */
export function normalizeDescription(text: string): string | null {
  return text.trim() === "" ? null : text;
}
