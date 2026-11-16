import type { StatusCategory } from "@/lib/project-config/model";
import { DISPLAY_TIME_ZONE } from "@/lib/i18n/format";
import { canEditTask, type Actor } from "@/lib/tasks/policy";
import type { Task, TaskPriority } from "@/lib/tasks/model";
import { compareCards } from "./position";

/**
 * Dữ liệu bảng Kanban (Story E3-1): nhóm task theo trạng thái, đếm việc con, trễ hạn, bộ lọc nhanh.
 * Thuần, không I/O.
 */

export interface BoardColumnStatus {
  id: string;
  name: string;
  category: StatusCategory;
  color: string;
  position: number;
}

/** Task mỗi cột (đã sắp theo compareCards) theo id trạng thái. */
export function groupByStatus(
  statuses: readonly { id: string }[],
  tasks: readonly Task[],
): Map<string, Task[]> {
  const columns = new Map<string, Task[]>(statuses.map((s) => [s.id, []]));
  for (const task of tasks) {
    if (task.status_id) columns.get(task.status_id)?.push(task);
  }
  for (const list of columns.values()) list.sort(compareCards);
  return columns;
}

export interface SubtaskCount {
  done: number;
  total: number;
}

/** Số việc con trực tiếp (đã xong / tổng) theo id task cha, từ chính danh sách task đã tải. */
export function subtaskCounts(
  tasks: readonly Task[],
  categoryOf: (statusId: string | null) => StatusCategory | undefined,
): Map<string, SubtaskCount> {
  const counts = new Map<string, SubtaskCount>();
  for (const task of tasks) {
    if (!task.parent_id) continue;
    const c = counts.get(task.parent_id) ?? { done: 0, total: 0 };
    c.total += 1;
    if (categoryOf(task.status_id) === "done") c.done += 1;
    counts.set(task.parent_id, c);
  }
  return counts;
}

/** Ngày hôm nay YYYY-MM-DD theo múi giờ hiển thị (người dùng ở Việt Nam). */
export function todayIso(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: DISPLAY_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** Trễ hạn: có hạn, hạn trước hôm nay và chưa ở nhóm hoàn thành. */
export function isOverdue(
  dueDate: string | null,
  category: StatusCategory | undefined,
  today: string,
): boolean {
  return !!dueDate && dueDate < today && category !== "done";
}

/** Giá trị đặc biệt của bộ lọc người phụ trách: task chưa giao cho ai. */
export const UNASSIGNED = "none";

export interface BoardFilters {
  /** id người phụ trách, UNASSIGNED, hoặc "" (mọi người). */
  assignee: string;
  priority: TaskPriority | "";
  label: string;
  /** Từ khóa; khớp do máy chủ quyết định (bỏ dấu, E3-3), xem `matchIds`. */
  q: string;
}

export const EMPTY_FILTERS: BoardFilters = {
  assignee: "",
  priority: "",
  label: "",
  q: "",
};

export function hasActiveFilters(f: BoardFilters): boolean {
  return (
    f.assignee !== "" ||
    f.priority !== "" ||
    f.label !== "" ||
    f.q.trim() !== ""
  );
}

/**
 * Task có khớp bộ lọc nhanh không. `matchIds`: id task máy chủ trả về cho từ khóa (null = không tìm
 * theo từ khóa hoặc chưa có kết quả).
 */
export function matchesFilters(
  task: Task,
  f: BoardFilters,
  matchIds: ReadonlySet<string> | null,
): boolean {
  if (
    f.assignee === UNASSIGNED
      ? task.assignee_id !== null
      : f.assignee && task.assignee_id !== f.assignee
  ) {
    return false;
  }
  if (f.priority && task.priority !== f.priority) return false;
  if (f.label && !task.label_ids.includes(f.label)) return false;
  if (matchIds && !matchIds.has(task.id)) return false;
  return true;
}

/**
 * Người gọi có kéo/chuyển được task không: cùng quy tắc với API (BR-03, lib/tasks/policy.ts).
 * API và RLS vẫn kiểm lại; 403 trả về được giao diện hoàn tác.
 */
export function canMoveTask(actor: Actor, task: Task): boolean {
  return canEditTask(actor, task);
}
