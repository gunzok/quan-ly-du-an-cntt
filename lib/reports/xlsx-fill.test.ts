import { readFileSync, writeFileSync } from "node:fs";
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { getMessages } from "@/lib/i18n/messages";
import { inspectOoxml } from "@/lib/report-templates/ooxml";
import {
  dumpXlsx,
  fixtureReportData,
  fixtureTask,
  readZipText,
} from "@/tests/fixtures/reports/report-data";
import { renderXlsxReport } from "./render";
import { buildSampleXlsxTemplate } from "./sample-template";

/**
 * Test bộ điền template xlsx (Story E5-3). Golden file: tệp xuất từ template mẫu + dữ liệu giả cố
 * định, đọc lại thành bảng giá trị ô (tests/fixtures/reports/golden/*.json). Sửa có chủ đích thì
 * sinh lại: UPDATE_GOLDEN=1 pnpm vitest run lib/reports/xlsx-fill.test.ts, rồi xem diff.
 */

const GOLDEN_DIR = new URL("../../tests/fixtures/reports/golden/", import.meta.url);

async function expectGolden(name: string, value: unknown) {
  const file = new URL(`${name}.json`, GOLDEN_DIR);
  const text = `${JSON.stringify(value, null, 2)}\n`;
  if (process.env.UPDATE_GOLDEN === "1") writeFileSync(file, text);
  expect(text).toBe(readFileSync(file, "utf8"));
}

async function load(bytes: Uint8Array) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes as unknown as ArrayBuffer);
  return wb;
}

async function save(wb: ExcelJS.Workbook): Promise<Uint8Array> {
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

describe("template mẫu", () => {
  it("qua được kiểm tra tải lên của E5-2 (không macro, đúng chữ ký xlsx)", async () => {
    const bytes = await buildSampleXlsxTemplate(getMessages("vi"));
    expect(inspectOoxml(bytes, "xlsx")).toEqual({ ok: true });
  });

  it("golden: template mẫu", async () => {
    await expectGolden(
      "sample-template-vi",
      await dumpXlsx(await buildSampleXlsxTemplate(getMessages("vi"))),
    );
  });

  it("golden: báo cáo tiếng Việt từ template mẫu", async () => {
    const tpl = await buildSampleXlsxTemplate(getMessages("vi"));
    const out = await renderXlsxReport(tpl, fixtureReportData(), "vi");
    await expectGolden("report-vi", await dumpXlsx(out));
  });

  it("golden: báo cáo tiếng Anh, kỳ không có task", async () => {
    const tpl = await buildSampleXlsxTemplate(getMessages("en"));
    const out = await renderXlsxReport(tpl, fixtureReportData([]), "en");
    await expectGolden("report-en-empty", await dumpXlsx(out));
  });

  it("giữ kiểu ô, công thức tổng, bộ lọc, định dạng có điều kiện, vùng in theo số dòng", async () => {
    const tpl = await buildSampleXlsxTemplate(getMessages("vi"));
    const tasks = Array.from({ length: 50 }, (_, i) => fixtureTask(i + 1));
    const out = await renderXlsxReport(tpl, fixtureReportData(tasks), "vi");
    const wb = await load(out);
    const ws = wb.worksheets[0];
    // Template: dòng task 20, tổng 21; sau khi 3 trạng thái (+2 dòng) và 50 task (+49 dòng).
    expect(ws.getCell("A22").value).toBe(1);
    expect(ws.getCell("A71").value).toBe(50);
    expect(ws.getCell("F72").formula).toBe("COUNTA(B22:B71)");
    expect(ws.getCell("F22").numFmt).toBe("dd/mm/yyyy");
    expect(ws.autoFilter).toBe("A21:H71");
    expect(ws.pageSetup.printArea).toBe("A1:H77");
    const cf = (ws as unknown as { conditionalFormattings: { ref: string; rules: { formulae: string[] }[] }[] }).conditionalFormattings;
    expect(cf[0].ref).toBe("F22:F71");
    expect(cf[0].rules[0].formulae[0]).toBe('AND(F22<>"",H22="",F22<INT(NOW()))');
    expect(ws.getCell("F77").value).toBe("PM Mẫu");
    expect(ws.headerFooter.oddFooter).toBe("Dự án mẫu E5-3 · &P/&N");
    expect(readZipText(out, "xl/workbook.xml")).toMatch(/<calcPr[^>]*fullCalcOnLoad="1"/);
  });

  it("tiêu đề giống công thức vẫn là ô chữ", async () => {
    const tpl = await buildSampleXlsxTemplate(getMessages("vi"));
    const wb = await load(await renderXlsxReport(tpl, fixtureReportData(), "vi"));
    const cell = wb.worksheets[0].getCell("B23");
    expect(cell.type).toBe(ExcelJS.ValueType.String);
    expect(cell.value).toBe("=1+1 tiêu đề giống công thức");
  });

  it("2.000 task điền dưới 10 giây (NFR-03 đặt 30 giây cho cả lần xuất)", async () => {
    const tpl = await buildSampleXlsxTemplate(getMessages("vi"));
    const tasks = Array.from({ length: 2000 }, (_, i) =>
      fixtureTask(i + 1, { title: `Task ${i + 1} ${"x".repeat(60)}`, labels: ["a", "b"] }),
    );
    const started = performance.now();
    const out = await renderXlsxReport(tpl, fixtureReportData(tasks), "vi");
    const ms = performance.now() - started;
    const wb = await load(out);
    expect(wb.worksheets[0].getCell("A2021").value).toBe(2000);
    expect(ms).toBeLessThan(10_000);
  }, 30_000);
});

describe("template tự soạn", () => {
  async function custom(build: (wb: ExcelJS.Workbook, ws: ExcelJS.Worksheet) => void) {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Báo cáo");
    build(wb, ws);
    return save(wb);
  }

  it("ô giữ chỗ trong chữ, chữ nhiều kiểu, khóa lạ giữ nguyên, ngôn ngữ en", async () => {
    const tpl = await custom((_, ws) => {
      ws.getCell("A1").value = "Dự án {{ project.name }} – {{counts.total}} task – {{khong.co}}";
      ws.getCell("A2").value = {
        richText: [
          { text: "Từ ", font: { bold: true } },
          { text: "{{period.start}}", font: { italic: true } },
        ],
      };
      ws.getCell("A3").value = "{{progress.ratio}}";
      ws.getCell("A4").value = "{{report.generated_at}}";
    });
    const data = fixtureReportData();
    const wb = await load(
      await renderXlsxReport(tpl, { ...data, dashboard: { ...data.dashboard, total: 1234 } }, "en"),
    );
    const ws = wb.worksheets[0];
    expect(ws.getCell("A1").value).toBe("Dự án Dự án mẫu E5-3 – 1,234 task – {{khong.co}}");
    expect(ws.getCell("A2").value).toEqual({
      richText: [
        { text: "Từ ", font: { bold: true } },
        { text: "01 Nov 2026", font: { italic: true } },
      ],
    });
    expect(ws.getCell("A3").numFmt).toBe("0%");
    expect(ws.getCell("A4").value).toEqual(new Date("2026-11-18T10:04:00Z"));
    expect(ws.getCell("A4").numFmt).toBe("dd/mm/yyyy hh:mm");
  });

  it("dòng lặp: ô gộp trong dòng, công thức theo dòng, công thức trang khác, kiểm dữ liệu", async () => {
    const tpl = await custom((wb, ws) => {
      ws.getCell("A1").value = "{{#tasks}}{{task.index}}";
      ws.getCell("B1").value = "{{task.title}}";
      ws.mergeCells("B1:C1");
      ws.getCell("D1").value = "{{task.level}}";
      ws.getCell("E1").value = { formula: "D1*2", result: 0 } as ExcelJS.CellFormulaValue;
      ws.getCell("F1").value = "{{/tasks}}";
      ws.getCell("A2").value = { formula: "SUM(D1:D1)", result: 0 } as ExcelJS.CellFormulaValue;
      ws.getCell("A3").value = "Cuối";
      ws.mergeCells("A3:B4");
      ws.getCell("D3").dataValidation = {
        type: "list",
        allowBlank: true,
        formulae: ['"x,y"'],
      };
      const other = wb.addWorksheet("Tổng hợp");
      other.getCell("A1").value = {
        formula: "SUM('Báo cáo'!D1:D1)+'Báo cáo'!A3",
        result: 0,
      } as ExcelJS.CellFormulaValue;
    });
    const tasks = [1, 2, 3].map((n) => fixtureTask(n, { depth: n }));
    const out = await renderXlsxReport(tpl, fixtureReportData(tasks), "vi");
    const wb = await load(out);
    const ws = wb.getWorksheet("Báo cáo")!;
    expect([1, 2, 3].map((r) => ws.getCell(`A${r}`).value)).toEqual([1, 2, 3]);
    expect(ws.getCell("F1").value).toBeNull();
    expect(ws.getCell("E3").formula).toBe("D3*2");
    expect(ws.getCell("A4").formula).toBe("SUM(D1:D3)");
    expect(ws.getCell("A5").value).toBe("Cuối");
    expect(ws.getCell("D5").dataValidation?.type).toBe("list");
    const merges = (await dumpXlsx(out))["Báo cáo"].merges;
    expect(merges).toEqual(["A5:B6", "B1:C1", "B2:C2", "B3:C3"]);
    expect(wb.getWorksheet("Tổng hợp")!.getCell("A1").formula).toBe(
      "SUM('Báo cáo'!D1:D3)+'Báo cáo'!A5",
    );
  });

  it("vùng lặp rỗng: một dòng, chữ báo không có dữ liệu ở ô giữ chỗ đầu", async () => {
    const tpl = await custom((_, ws) => {
      ws.getCell("A1").value = "STT";
      ws.getCell("B2").value = "{{#tasks}}{{task.index}}";
      ws.getCell("C2").value = "{{task.title}}";
      ws.getCell("A3").value = "Sau";
    });
    const wb = await load(await renderXlsxReport(tpl, fixtureReportData([]), "vi"));
    const ws = wb.worksheets[0];
    expect(ws.getCell("B2").value).toBe("Không có task nào trong kỳ.");
    expect(ws.getCell("C2").value).toBeNull();
    expect(ws.getCell("A3").value).toBe("Sau");
  });

  it("template không mở được: ném lỗi", async () => {
    await expect(
      renderXlsxReport(new Uint8Array([1, 2, 3]), fixtureReportData(), "vi"),
    ).rejects.toThrow();
  });
});
