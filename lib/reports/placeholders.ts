import { calcProgressPercent } from "@/lib/progress";
import type {
  Dashboard,
  StatusCategory,
  TaskPriority,
} from "@/lib/dashboard/model";
import type { Messages } from "@/lib/i18n/messages";
import { periodBounds } from "./period";

/**
 * Dữ liệu báo cáo → giá trị cho từng ô giữ chỗ `{{...}}` của template (Story E5-3).
 * Danh sách ô giữ chỗ là HỢP ĐỒNG với người soạn template của công ty: tài liệu ở
 * docs/03-design/report-template-xlsx.md, test kiểm tài liệu liệt kê đủ (placeholders.test.ts).
 */

/** Giá trị một ô: giữ kiểu để Excel tính toán, sắp xếp, định dạng được. */
export type CellValue =
  | { kind: "text"; value: string }
  | { kind: "number"; value: number }
  /** Ngày lịch YYYY-MM-DD (không múi giờ). */
  | { kind: "date"; value: string }
  /** Thời điểm; ghi ra Excel theo giờ Việt Nam. */
  | { kind: "datetime"; value: Date }
  /** Tỷ lệ 0..1 (định dạng phần trăm). */
  | { kind: "ratio"; value: number };

export type ValueMap = Record<string, CellValue | null>;

/** Vùng lặp: `{{#tasks}}` trên một dòng, các ô trong dòng dùng `{{task.<trường>}}`. */
export const SECTIONS = {
  tasks: "task",
  statuses: "status",
  assignees: "assignee",
} as const;
export type SectionName = keyof typeof SECTIONS;

/** Ô giữ chỗ dùng ở bất kỳ đâu (ngoài dòng lặp). */
export const SCALAR_PLACEHOLDERS = [
  "project.name",
  "project.description",
  "project.start_date",
  "project.end_date",
  "project.status",
  "period.start",
  "period.end",
  "period.days",
  "period.task_count",
  "period.created_count",
  "period.completed_count",
  "period.due_count",
  "report.generated_at",
  "report.generated_by",
  "report.today",
  "counts.total",
  "counts.done",
  "counts.open",
  "counts.todo",
  "counts.in_progress",
  "counts.overdue",
  "counts.open_no_due",
  "counts.blocked",
  "progress.percent",
  "progress.ratio",
] as const;

/** Trường của từng vùng lặp (viết `{{task.title}}`, `{{status.count}}`...). */
export const SECTION_FIELDS: Record<SectionName, readonly string[]> = {
  tasks: [
    "index",
    "title",
    "status",
    "status_group",
    "assignee",
    "priority",
    "type",
    "start_date",
    "due_date",
    "completed_at",
    "created_at",
    "updated_at",
    "labels",
    "overdue",
    "level",
  ],
  statuses: ["index", "name", "group", "count", "ratio"],
  assignees: ["index", "name", "total", "done", "open", "overdue"],
};

export interface ReportProject {
  id: string;
  name: string;
  description: string | null;
  start_date: string | null;
  end_date: string | null;
  status: "active" | "archived";
}

export interface ReportTask {
  id: string;
  title: string;
  status_name: string | null;
  status_category: StatusCategory | null;
  assignee_id: string | null;
  /** null: chưa giao, hoặc người gọi không còn thấy hồ sơ người đó (đã rời dự án). */
  assignee_name: string | null;
  priority: TaskPriority;
  type_name: string | null;
  start_date: string | null;
  due_date: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  labels: string[];
  depth: number;
}

export interface ReportData {
  project: ReportProject;
  period: { start: string; end: string };
  generatedAt: Date;
  generatedBy: string;
  /** Số liệu dashboard tại thời điểm xuất (cùng hàm CSDL với S06). */
  dashboard: Dashboard;
  /** Task trong kỳ, đã sắp xếp. */
  tasks: ReportTask[];
}

const text = (value: string): CellValue => ({ kind: "text", value });
const num = (value: number): CellValue => ({ kind: "number", value });
const date = (value: string | null): CellValue | null =>
  value ? { kind: "date", value } : null;
const datetime = (value: string | null): CellValue | null =>
  value ? { kind: "datetime", value: new Date(value) } : null;

function inRange(iso: string | null, from: string, to: string): boolean {
  if (!iso) return false;
  const t = Date.parse(iso);
  return t >= Date.parse(from) && t < Date.parse(to);
}

/** Đếm theo kỳ từ danh sách task trong kỳ. */
export function periodCounts(data: Pick<ReportData, "period" | "tasks">) {
  const { from, to } = periodBounds(data.period.start, data.period.end);
  let created = 0;
  let completed = 0;
  let due = 0;
  for (const t of data.tasks) {
    if (inRange(t.created_at, from, to)) created++;
    if (inRange(t.completed_at, from, to)) completed++;
    if (
      t.due_date &&
      t.due_date >= data.period.start &&
      t.due_date <= data.period.end
    ) {
      due++;
    }
  }
  return { created, completed, due };
}

export function scalarValues(data: ReportData, t: Messages): ValueMap {
  const d = data.dashboard;
  const counts = periodCounts(data);
  const days =
    Math.round(
      (Date.parse(`${data.period.end}T00:00:00Z`) -
        Date.parse(`${data.period.start}T00:00:00Z`)) /
        86_400_000,
    ) + 1;
  return {
    "project.name": text(data.project.name),
    "project.description": text(data.project.description ?? ""),
    "project.start_date": date(data.project.start_date),
    "project.end_date": date(data.project.end_date),
    "project.status": text(t.reports.xlsx.projectStatus[data.project.status]),
    "period.start": date(data.period.start),
    "period.end": date(data.period.end),
    "period.days": num(days),
    "period.task_count": num(data.tasks.length),
    "period.created_count": num(counts.created),
    "period.completed_count": num(counts.completed),
    "period.due_count": num(counts.due),
    "report.generated_at": {
      kind: "datetime",
      value: data.generatedAt,
    },
    "report.generated_by": text(data.generatedBy),
    "report.today": date(d.today),
    "counts.total": num(d.total),
    "counts.done": num(d.done),
    "counts.open": num(d.open),
    "counts.todo": num(d.todo),
    "counts.in_progress": num(d.in_progress),
    "counts.overdue": num(d.overdue),
    "counts.open_no_due": num(d.open_no_due),
    "counts.blocked": num(d.blocked),
    "progress.percent": num(calcProgressPercent(d.done, d.total)),
    "progress.ratio": {
      kind: "ratio",
      value: d.total > 0 ? d.done / d.total : 0,
    },
  };
}

function assigneeText(
  id: string | null,
  name: string | null,
  t: Messages,
): string {
  if (id === null) return t.reports.xlsx.unassigned;
  return name?.trim() || t.reports.xlsx.formerMember;
}

export function taskValues(
  task: ReportTask,
  index: number,
  today: string,
  t: Messages,
): ValueMap {
  const overdue =
    task.completed_at === null &&
    task.due_date !== null &&
    task.due_date < today;
  return {
    "task.index": num(index + 1),
    "task.title": text(task.title),
    "task.status": text(task.status_name ?? ""),
    "task.status_group": text(
      task.status_category
        ? t.projectConfig.categories[task.status_category]
        : "",
    ),
    "task.assignee": text(
      assigneeText(task.assignee_id, task.assignee_name, t),
    ),
    "task.priority": text(t.ui.priority[task.priority]),
    "task.type": text(task.type_name ?? ""),
    "task.start_date": date(task.start_date),
    "task.due_date": date(task.due_date),
    "task.completed_at": datetime(task.completed_at),
    "task.created_at": datetime(task.created_at),
    "task.updated_at": datetime(task.updated_at),
    "task.labels": text(task.labels.join(", ")),
    "task.overdue": text(overdue ? t.reports.xlsx.overdue : ""),
    "task.level": num(task.depth),
  };
}

export function sectionValues(
  data: ReportData,
  t: Messages,
): Record<SectionName, ValueMap[]> {
  const d = data.dashboard;
  return {
    tasks: data.tasks.map((task, i) => taskValues(task, i, d.today, t)),
    statuses: d.by_status.map((s, i) => ({
      "status.index": num(i + 1),
      "status.name": text(s.name),
      "status.group": text(t.projectConfig.categories[s.category]),
      "status.count": num(s.count),
      "status.ratio": {
        kind: "ratio",
        value: d.total > 0 ? s.count / d.total : 0,
      },
    })),
    assignees: d.by_assignee.map((a, i) => ({
      "assignee.index": num(i + 1),
      "assignee.name": text(assigneeText(a.assignee_id, a.full_name, t)),
      "assignee.total": num(a.total),
      "assignee.done": num(a.done),
      "assignee.open": num(a.open),
      "assignee.overdue": num(a.overdue),
    })),
  };
}
