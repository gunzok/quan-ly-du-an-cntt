import { inflateRawSync } from "node:zlib";
import ExcelJS from "exceljs";
import { toDashboard } from "@/lib/dashboard/model";
import type { ReportData, ReportTask } from "@/lib/reports/placeholders";

/**
 * Dữ liệu báo cáo GIẢ, cố định (Story E5-3) cho test golden file và test bộ điền template. Không có
 * dữ liệu thật. Tiêu đề có ký tự đặc biệt để kiểm không thành công thức ("=1+1", "+SUM(A1)").
 */
export const FIXED_GENERATED_AT = new Date("2026-11-18T03:04:00Z");

export function fixtureTask(
  n: number,
  overrides: Partial<ReportTask> = {},
): ReportTask {
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    title: `Task mẫu ${n}`,
    status_name: "Cần làm",
    status_category: "todo",
    assignee_id: null,
    assignee_name: null,
    priority: "medium",
    type_name: "Task",
    start_date: null,
    due_date: null,
    completed_at: null,
    created_at: "2026-11-02T01:00:00Z",
    updated_at: "2026-11-02T01:00:00Z",
    labels: [],
    depth: 1,
    ...overrides,
  };
}

export function fixtureReportData(tasks?: ReportTask[]): ReportData {
  const list = tasks ?? [
    fixtureTask(1, {
      title: "Thiết kế CSDL báo cáo",
      status_name: "Hoàn thành",
      status_category: "done",
      assignee_id: "00000000-0000-4000-8000-0000000000a1",
      assignee_name: "Nguyễn Văn An",
      priority: "high",
      due_date: "2026-11-10",
      completed_at: "2026-11-09T10:30:00Z",
      labels: ["backend", "csdl"],
    }),
    fixtureTask(2, {
      title: "=1+1 tiêu đề giống công thức",
      status_name: "Đang làm",
      status_category: "in_progress",
      assignee_id: "00000000-0000-4000-8000-0000000000a2",
      assignee_name: null,
      priority: "urgent",
      due_date: "2026-11-05",
      depth: 2,
    }),
    fixtureTask(3, {
      title: "+SUM(A1) và chữ có dấu: Ưu tiên",
      priority: "low",
      due_date: "2026-12-15",
      created_at: "2026-10-20T01:00:00Z",
      updated_at: "2026-11-30T16:59:59Z",
    }),
  ];
  return {
    project: {
      id: "00000000-0000-4000-8000-00000000e530",
      name: "Dự án mẫu E5-3",
      description: "Mô tả mẫu",
      start_date: "2026-10-01",
      end_date: "2026-12-31",
      status: "active",
    },
    period: { start: "2026-11-01", end: "2026-11-30" },
    generatedAt: FIXED_GENERATED_AT,
    generatedBy: "PM Mẫu",
    dashboard: toDashboard({
      project_id: "00000000-0000-4000-8000-00000000e530",
      today: "2026-11-18",
      total: 4,
      done: 1,
      open: 3,
      todo: 2,
      in_progress: 1,
      overdue: 1,
      open_no_due: 1,
      blocked: 0,
      by_status: [
        {
          id: "s1",
          name: "Cần làm",
          category: "todo",
          color: "#888888",
          count: 2,
        },
        {
          id: "s2",
          name: "Đang làm",
          category: "in_progress",
          color: "#2054F0",
          count: 1,
        },
        {
          id: "s3",
          name: "Hoàn thành",
          category: "done",
          color: "#1E9E5A",
          count: 1,
        },
      ],
      by_type: [],
      by_priority: [],
      by_assignee: [],
      overdue_tasks: [],
    }),
    tasks: list,
  };
}

export type CellDump = string | number | boolean | null;

/**
 * Đọc lại tệp xlsx thành bảng giá trị ô (không so byte): ngày → "YYYY-MM-DD" hoặc
 * "YYYY-MM-DD HH:mm", công thức → "{=<công thức>}", chữ nhiều kiểu → chữ thường. Bỏ dòng trống cuối.
 */
export async function dumpXlsx(
  bytes: Uint8Array,
): Promise<
  Record<string, { cells: Record<string, CellDump>; merges: string[] }>
> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes as unknown as ArrayBuffer);
  const out: Record<
    string,
    { cells: Record<string, CellDump>; merges: string[] }
  > = {};
  wb.eachSheet((ws) => {
    const cells: Record<string, CellDump> = {};
    ws.eachRow((row) => {
      row.eachCell((cell) => {
        if (cell.type === ExcelJS.ValueType.Merge) return;
        const v = cell.value;
        let d: CellDump;
        if (v instanceof Date) {
          const iso = v.toISOString();
          d = iso.endsWith("T00:00:00.000Z")
            ? iso.slice(0, 10)
            : `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
        } else if (v && typeof v === "object" && "formula" in v) {
          d = `{=${cell.formula}}`;
        } else if (v && typeof v === "object" && "richText" in v) {
          d = v.richText.map((r) => r.text).join("");
        } else {
          d = v as CellDump;
        }
        if (d === null || d === "") return;
        cells[cell.address] = d;
      });
    });
    const merges = Object.values(
      (ws as unknown as { _merges: Record<string, { range: string }> })._merges,
    )
      .map((m) => m.range)
      .sort();
    out[ws.name] = { cells, merges };
  });
  return out;
}

/** Đọc một phần tử trong tệp ZIP (xlsx) theo thư mục trung tâm; không có: null. Chỉ dùng cho test. */
export function readZipText(bytes: Uint8Array, name: string): string | null {
  const buf = Buffer.from(bytes);
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) return null;
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i++) {
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const entryName = buf.toString("utf8", p + 46, p + 46 + nameLen);
    if (entryName === name) {
      const start =
        local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      const data = buf.subarray(start, start + size);
      return (method === 8 ? inflateRawSync(data) : data).toString("utf8");
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  return null;
}
