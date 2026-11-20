import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getMessages } from "@/lib/i18n/messages";
import { dumpDocx } from "@/tests/fixtures/reports/docx";
import {
  dumpXlsx,
  fixtureReportData,
  fixtureTask,
} from "@/tests/fixtures/reports/report-data";
import type { ReportTask } from "./placeholders";
import { renderDocxReport, renderXlsxReport } from "./render";
import { buildSampleDocxTemplate } from "./sample-docx-template";
import { buildSampleXlsxTemplate } from "./sample-template";

/**
 * Story E5-5 (NFR-03): xuất xlsx và docx với 2.000 task từ template mẫu, dữ liệu giả cố định đa
 * dạng (trạng thái, người phụ trách, ưu tiên, hạn, nhãn, cấp, chữ có dấu, ký tự đặc biệt).
 *
 *   - Thời gian bước điền dưới 10 giây mỗi định dạng (NFR-03 là 30 giây cho CẢ lượt xuất; số đo
 *     đầu-cuối có đọc CSDL: make perf-seed && make perf-report).
 *   - Bộ nhớ: heap tăng dưới 300 MB mỗi lượt (đo thật ở perf-report: RSS đỉnh).
 *   - Golden ổn định: xuất hai lần ra cùng nội dung; tóm tắt SHA-256 của nội dung (đọc lại, không
 *     so byte) khớp tệp chuẩn tests/fixtures/reports/golden/export-2000-digest.json. Sửa có chủ
 *     đích: UPDATE_GOLDEN=1 pnpm vitest run lib/reports/export-2000.test.ts, rồi xem diff.
 */

const GOLDEN = new URL(
  "../../tests/fixtures/reports/golden/export-2000-digest.json",
  import.meta.url,
);

const STATUSES = [
  ["Cần làm", "todo"],
  ["Đang làm", "in_progress"],
  ["Hoàn thành", "done"],
] as const;
const PRIORITIES = ["low", "medium", "high", "urgent"] as const;

function bigTasks(n: number): ReportTask[] {
  return Array.from({ length: n }, (_, i) => {
    const [status_name, status_category] = STATUSES[i % 3];
    const day = String((i % 28) + 1).padStart(2, "0");
    return fixtureTask(i + 1, {
      title: `Task ${i + 1}: ${i % 7 === 0 ? "=SUM(A1) " : ""}chữ có dấu Ưu tiên & <thẻ> ${"x".repeat(i % 40)}`,
      status_name,
      status_category,
      assignee_id:
        i % 5 === 0
          ? null
          : `00000000-0000-4000-8000-0000000000${String(i % 4).padStart(2, "0")}`,
      assignee_name: i % 5 === 0 || i % 11 === 0 ? null : `Người ${i % 4}`,
      priority: PRIORITIES[i % 4],
      due_date: i % 6 === 0 ? null : `2026-11-${day}`,
      completed_at:
        status_category === "done" ? `2026-11-${day}T08:30:00Z` : null,
      labels: i % 3 === 0 ? ["backend", "csdl"] : [],
      depth: (i % 3) + 1,
    });
  });
}

const sha = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

const vi = getMessages("vi");
const data = fixtureReportData(bigTasks(2000));

async function measure<T>(work: () => Promise<T>) {
  global.gc?.();
  const heapBefore = process.memoryUsage().heapUsed;
  const started = performance.now();
  const out = await work();
  const ms = performance.now() - started;
  const heapMb = (process.memoryUsage().heapUsed - heapBefore) / 1048576;
  return { out, ms, heapMb };
}

describe("E5-5: xuất 2.000 task (NFR-03) và golden ổn định", () => {
  const digests: Record<string, string> = {};

  it("xlsx: dưới 10 giây, đủ 2.000 dòng, xuất hai lần cùng nội dung", async () => {
    const tpl = await buildSampleXlsxTemplate(vi);
    const first = await measure(() => renderXlsxReport(tpl, data, "vi"));
    const dump = await dumpXlsx(first.out);
    const sheet = Object.values(dump)[0].cells;
    expect(sheet.A22).toBe(1);
    expect(sheet.A2021).toBe(2000);
    expect(sheet.B29).toBe(
      "Task 8: =SUM(A1) chữ có dấu Ưu tiên & <thẻ> xxxxxxx",
    );
    expect(first.ms).toBeLessThan(10_000);
    expect(first.heapMb).toBeLessThan(300);
    const second = await dumpXlsx(await renderXlsxReport(tpl, data, "vi"));
    expect(sha(second)).toBe(sha(dump));
    digests.xlsx = sha(dump);
    console.log(
      `[E5-5] xlsx 2.000 task: ${Math.round(first.ms)} ms, heap +${Math.round(first.heapMb)} MB`,
    );
  }, 60_000);

  it("docx: dưới 10 giây, đủ 2.000 dòng, xuất hai lần cùng nội dung", async () => {
    const tpl = buildSampleDocxTemplate(vi);
    const first = await measure(() => renderDocxReport(tpl, data, "vi"));
    const dump = dumpDocx(first.out);
    const lines = dump["word/document.xml"];
    const start = lines.indexOf("¶ 4. DANH SÁCH TASK TRONG KỲ") + 3;
    const end = lines.findIndex((l, i) => i > start && l.startsWith("¶"));
    const rows = lines.slice(start, end);
    expect(rows).toHaveLength(2000);
    expect(rows[0]).toMatch(/^\| 1 \| Task /);
    expect(rows[1999]).toMatch(/^\| 2\.000 \| Task /);
    expect(rows[7]).toContain("| Task 8: =SUM(A1) chữ có dấu Ưu tiên & <thẻ> ");
    expect(first.ms).toBeLessThan(10_000);
    expect(first.heapMb).toBeLessThan(300);
    const second = dumpDocx(await renderDocxReport(tpl, data, "vi"));
    expect(sha(second)).toBe(sha(dump));
    digests.docx = sha(dump);
    console.log(
      `[E5-5] docx 2.000 task: ${Math.round(first.ms)} ms, heap +${Math.round(first.heapMb)} MB`,
    );
  }, 60_000);

  it("tóm tắt nội dung khớp golden", () => {
    expect(Object.keys(digests).sort()).toEqual(["docx", "xlsx"]);
    const text = `${JSON.stringify(digests, null, 2)}\n`;
    if (process.env.UPDATE_GOLDEN === "1") writeFileSync(GOLDEN, text);
    expect(text).toBe(readFileSync(GOLDEN, "utf8"));
  });
});
