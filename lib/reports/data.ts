import type { SupabaseClient } from "@supabase/supabase-js";
import {
  toDashboard,
  type Dashboard,
  type DashboardRow,
  type StatusCategory,
  type TaskPriority,
} from "@/lib/dashboard/model";
import { REPORT_MAX_TASKS, REPORT_TASK_PAGE_SIZE } from "./model";
import { periodBounds } from "./period";
import type { ReportTask } from "./placeholders";

/**
 * Đọc dữ liệu báo cáo bằng client PHIÊN của người gọi (RLS áp dụng, Story E5-3). Mọi truy vấn nhận
 * AbortSignal để dừng khi quá thời gian (504 report_timeout).
 *
 * ĐỊNH NGHĨA "task trong kỳ" [from, to) giờ Việt Nam: task có ÍT NHẤT MỘT trong các mốc sau rơi vào
 * kỳ: tạo (created_at), cập nhật lần cuối (updated_at), hoàn thành (completed_at), hạn (due_date,
 * ngày lịch, tính cả hai đầu). Task mở từ trước, không đổi gì và hạn ngoài kỳ thì không vào danh
 * sách (số liệu tổng {{counts.*}} vẫn tính mọi task của dự án tại lúc xuất).
 * Sắp xếp: hạn sớm trước (không hạn ở cuối), rồi ngày tạo, rồi id (ổn định giữa các trang).
 */

export class TooManyTasksError extends Error {
  constructor() {
    super("too many tasks");
    this.name = "TooManyTasksError";
  }
}

const TASK_REPORT_COLUMNS =
  "id, title, status_id, type_id, assignee_id, priority, start_date, due_date, completed_at, created_at, updated_at, depth, task_labels(label_id)";

interface TaskReportRow {
  id: string;
  title: string;
  status_id: string | null;
  type_id: string | null;
  assignee_id: string | null;
  priority: TaskPriority;
  start_date: string | null;
  due_date: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  depth: number;
  task_labels: { label_id: string }[] | null;
}

/** Bộ lọc OR của PostgREST cho "task trong kỳ"; giá trị trong ngoặc kép vì có ":" và ".". */
export function periodTaskFilter(start: string, end: string): string {
  const { from, to } = periodBounds(start, end);
  const ts = (col: string) => `and(${col}.gte."${from}",${col}.lt."${to}")`;
  return [
    ts("created_at"),
    ts("updated_at"),
    ts("completed_at"),
    `and(due_date.gte.${start},due_date.lte.${end})`,
  ].join(",");
}

export async function loadDashboard(
  session: SupabaseClient,
  projectId: string,
  today: string,
  signal: AbortSignal,
): Promise<Dashboard | null> {
  const { data, error } = await session
    .rpc("project_dashboard", { p_project_id: projectId, p_today: today })
    .abortSignal(signal);
  if (error) throw error;
  return data ? toDashboard(data as DashboardRow) : null;
}

/** Task trong kỳ, đọc theo trang REPORT_TASK_PAGE_SIZE; vượt REPORT_MAX_TASKS: TooManyTasksError. */
export async function loadPeriodTasks(
  session: SupabaseClient,
  projectId: string,
  period: { start: string; end: string },
  dashboard: Dashboard,
  signal: AbortSignal,
): Promise<ReportTask[]> {
  const [statuses, types, labels] = await Promise.all([
    session
      .from("task_statuses")
      .select("id, name, category")
      .eq("project_id", projectId)
      .abortSignal(signal),
    session
      .from("task_types")
      .select("id, name")
      .eq("project_id", projectId)
      .abortSignal(signal),
    session
      .from("labels")
      .select("id, name")
      .eq("project_id", projectId)
      .abortSignal(signal),
  ]);
  for (const r of [statuses, types, labels]) if (r.error) throw r.error;
  const statusById = new Map(
    (
      (statuses.data ?? []) as {
        id: string;
        name: string;
        category: StatusCategory;
      }[]
    ).map((s) => [s.id, s]),
  );
  const typeById = new Map(
    ((types.data ?? []) as { id: string; name: string }[]).map((t) => [
      t.id,
      t.name,
    ]),
  );
  const labelById = new Map(
    ((labels.data ?? []) as { id: string; name: string }[]).map((l) => [
      l.id,
      l.name,
    ]),
  );
  // Tên người phụ trách lấy từ dashboard (cùng quy tắc S06: null khi đã rời dự án).
  const assigneeName = new Map(
    dashboard.by_assignee.map((a) => [a.assignee_id, a.full_name]),
  );

  const filter = periodTaskFilter(period.start, period.end);
  const rows: TaskReportRow[] = [];
  for (let offset = 0; ; offset += REPORT_TASK_PAGE_SIZE) {
    const { data, error } = await session
      .from("tasks")
      .select(TASK_REPORT_COLUMNS)
      .eq("project_id", projectId)
      .or(filter)
      .order("due_date", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(offset, offset + REPORT_TASK_PAGE_SIZE - 1)
      .abortSignal(signal);
    if (error) throw error;
    const page = (data ?? []) as unknown as TaskReportRow[];
    rows.push(...page);
    if (rows.length > REPORT_MAX_TASKS) throw new TooManyTasksError();
    if (page.length < REPORT_TASK_PAGE_SIZE) break;
  }

  return rows.map((r) => {
    const status = r.status_id ? statusById.get(r.status_id) : undefined;
    return {
      id: r.id,
      title: r.title,
      status_name: status?.name ?? null,
      status_category: status?.category ?? null,
      assignee_id: r.assignee_id,
      assignee_name: r.assignee_id
        ? (assigneeName.get(r.assignee_id) ?? null)
        : null,
      priority: r.priority,
      type_name: r.type_id ? (typeById.get(r.type_id) ?? null) : null,
      start_date: r.start_date,
      due_date: r.due_date,
      completed_at: r.completed_at,
      created_at: r.created_at,
      updated_at: r.updated_at,
      labels: (r.task_labels ?? [])
        .map((l) => labelById.get(l.label_id))
        .filter((name): name is string => Boolean(name))
        .sort((a, b) => a.localeCompare(b, "vi")),
      depth: r.depth,
    };
  });
}
