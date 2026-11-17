import type { StatusCategory } from "@/lib/project-config/model";
import type { TaskRelationView } from "@/lib/task-relations/model";
import { BLOCKED_WARNING_CODE } from "./blocked";
import { openBlockers } from "./detail-view";
import type { Task } from "./model";

/**
 * Logic hiển thị cảnh báo bị chặn ở giao diện (Story E8-3, BR-06), thuần để test đơn vị.
 */

export interface BlockerItem {
  id: string;
  /** null: chỉ biết id (danh sách quan hệ chưa tải được). */
  title: string | null;
}

type Categorize = (statusId: string | null) => StatusCategory | undefined;

function isDone(
  task: Pick<Task, "status_id" | "completed_at">,
  categoryOf: Categorize,
): boolean {
  const category = categoryOf(task.status_id);
  return category ? category === "done" : task.completed_at !== null;
}

/**
 * Task chặn còn mở để hiện banner ở chi tiết task; rỗng = không hiện. Ưu tiên danh sách quan hệ
 * (đủ cả tiêu đề, cập nhật ngay khi thêm/bỏ quan hệ); khi quan hệ chưa tải được thì dùng
 * `blocked_by` của API (chỉ id). Task đã xong không hiện cảnh báo.
 */
export function blockerItems(
  task: Pick<Task, "status_id" | "completed_at" | "blocked" | "blocked_by">,
  relations: readonly TaskRelationView[] | null,
  categoryOf: Categorize,
): BlockerItem[] {
  if (isDone(task, categoryOf)) return [];
  if (relations) {
    const seen = new Set<string>();
    const out: BlockerItem[] = [];
    for (const r of openBlockers(relations, categoryOf)) {
      if (seen.has(r.task.id)) continue;
      seen.add(r.task.id);
      out.push({ id: r.task.id, title: r.task.title });
    }
    return out;
  }
  if (!task.blocked) return [];
  return (task.blocked_by ?? []).map((id) => ({ id, title: null }));
}

/** id task chặn từ phản hồi PATCH (warnings), rỗng nếu không có cảnh báo bị chặn. */
export function blockedWarningIds(
  warnings:
    readonly { code: string; task_ids?: readonly string[] }[] | undefined,
): string[] {
  const w = warnings?.find((x) => x.code === BLOCKED_WARNING_CODE);
  return w?.task_ids ? [...w.task_ids] : [];
}

/**
 * Cập nhật cờ bị chặn trên bảng sau khi task `movedId` vừa xong, không tải lại cả bảng: bỏ movedId
 * khỏi `blocked_by` của các task nó chặn và giảm `blocked_by_count`; hết task chặn mở thì hết bị
 * chặn. Task chặn nằm ngoài 5 id đầu (danh sách bị cắt) thì chưa biết nó, cờ giữ nguyên tới lần tải
 * sau (vẫn đúng: còn task chặn khác).
 *
 * Vừa MỞ LẠI: bảng không biết nó chặn những task nào (quan hệ không tải lên bảng) nên không đổi;
 * không tải lại 2.000 task chỉ vì một cảnh báo, các task phụ thuộc hiện "Bị chặn" từ lần tải sau.
 * Trả chính mảng cũ khi không đổi gì.
 */
export function applyCompletionChange<T extends Task>(
  tasks: readonly T[],
  movedId: string,
  change: "completed" | "reopened" | "none",
): readonly T[] {
  if (change !== "completed") return tasks;
  let changed = false;
  const next = tasks.map((t) => {
    const by = t.blocked_by ?? [];
    if (!by.includes(movedId)) return t;
    changed = true;
    const count = Math.max(0, (t.blocked_by_count ?? by.length) - 1);
    return {
      ...t,
      blocked_by: by.filter((id) => id !== movedId),
      blocked_by_count: count,
      blocked: count > 0,
    };
  });
  return changed ? next : tasks;
}

/** Thay đổi trạng thái hoàn thành giữa hai bản của cùng một task. */
export function completionChange(
  before: Pick<Task, "completed_at">,
  after: Pick<Task, "completed_at">,
): "completed" | "reopened" | "none" {
  if (before.completed_at === null && after.completed_at !== null)
    return "completed";
  if (before.completed_at !== null && after.completed_at === null)
    return "reopened";
  return "none";
}
