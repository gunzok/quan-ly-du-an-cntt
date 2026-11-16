import { calcProgressPercent } from "@/lib/progress";

/**
 * Số liệu dashboard tiến độ S06 (Story E5-1, FR-13). Thô từ public.project_dashboard() (CSDL tính
 * hết), API gắn thêm phần trăm hoàn thành theo cùng công thức với danh sách dự án S02.
 */
export type StatusCategory = "todo" | "in_progress" | "done";
export type TaskPriority = "urgent" | "high" | "medium" | "low";

export const PRIORITIES: readonly TaskPriority[] = [
  "urgent",
  "high",
  "medium",
  "low",
];
export const CATEGORIES: readonly StatusCategory[] = [
  "todo",
  "in_progress",
  "done",
];

export interface StatusBucket {
  id: string;
  name: string;
  category: StatusCategory;
  color: string;
  count: number;
}

export interface TypeBucket {
  id: string;
  name: string;
  color: string;
  is_milestone: boolean;
  count: number;
}

export interface PriorityBucket {
  priority: TaskPriority;
  count: number;
}

export interface AssigneeBucket {
  /** null: task chưa giao. */
  assignee_id: string | null;
  /** null khi chưa giao hoặc người gọi không còn được thấy hồ sơ (RLS). */
  full_name: string | null;
  /** Còn là thành viên dự án; false với nhóm chưa giao và người đã bị gỡ khỏi dự án. */
  is_member: boolean;
  total: number;
  done: number;
  open: number;
  overdue: number;
}

export interface OverdueTask {
  id: string;
  title: string;
  due_date: string;
  days_overdue: number;
  assignee_id: string | null;
}

export interface DashboardRow {
  project_id: string;
  /** Ngày "hôm nay" YYYY-MM-DD theo giờ Việt Nam dùng để tính trễ hạn. */
  today: string;
  total: number;
  done: number;
  open: number;
  todo: number;
  in_progress: number;
  overdue: number;
  open_no_due: number;
  blocked: number;
  by_status: StatusBucket[];
  by_type: TypeBucket[];
  by_priority: PriorityBucket[];
  by_assignee: AssigneeBucket[];
  overdue_tasks: OverdueTask[];
}

export interface Dashboard extends DashboardRow {
  /** 0–100, làm tròn như danh sách dự án (lib/progress.ts). */
  completion_percent: number;
}

export function toDashboard(row: DashboardRow): Dashboard {
  return {
    ...row,
    completion_percent: calcProgressPercent(row.done, row.total),
  };
}

/** Số task theo nhóm trạng thái (todo, in_progress, done). */
export function categoryCounts(
  d: Pick<Dashboard, "todo" | "in_progress" | "done">,
): Record<StatusCategory, number> {
  return { todo: d.todo, in_progress: d.in_progress, done: d.done };
}

/** Phần trăm một phần trong tổng (làm tròn); tổng 0 thì 0. */
export function share(part: number, total: number): number {
  return total > 0 ? Math.round((part / total) * 100) : 0;
}
