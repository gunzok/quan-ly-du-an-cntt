import ExcelJS from "exceljs";
import type { Messages } from "@/lib/i18n/messages";

/**
 * Template xlsx MẪU (Story E5-3, R-005: công ty chưa có template thật). Sinh bằng code, không chứa
 * dữ liệu thật; dùng làm điểm bắt đầu để công ty soạn template riêng và làm template cho test
 * golden file. Minh họa đủ quy ước ở docs/03-design/report-template-xlsx.md: ô giữ chỗ trong chữ
 * và ô riêng (giữ kiểu số/ngày/tỷ lệ), hai vùng lặp trên cùng một trang, ô gộp, công thức tổng
 * giãn theo số dòng, bộ lọc, định dạng có điều kiện, chân trang ký tên nằm dưới bảng.
 *
 * Tải về: GET /api/v1/report-templates/sample?format=xlsx (Admin, PM).
 */

const BORDER: Partial<ExcelJS.Borders> = {
  top: { style: "thin", color: { argb: "FFC9CED8" } },
  left: { style: "thin", color: { argb: "FFC9CED8" } },
  bottom: { style: "thin", color: { argb: "FFC9CED8" } },
  right: { style: "thin", color: { argb: "FFC9CED8" } },
};
const HEADER_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FF0A0F1F" },
};
const HEADER_FONT: Partial<ExcelJS.Font> = {
  bold: true,
  color: { argb: "FFFFFFFF" },
};
const SECTION_FONT: Partial<ExcelJS.Font> = {
  bold: true,
  size: 12,
  color: { argb: "FF2054F0" },
};

/** Ngày giờ tạo cố định: tệp mẫu sinh lại giống hệt nhau (không lộ giờ máy chủ). */
const FIXED_DATE = new Date(Date.UTC(2026, 10, 1));

function headerRow(ws: ExcelJS.Worksheet, row: number, labels: string[]) {
  labels.forEach((label, i) => {
    const cell = ws.getCell(row, i + 1);
    cell.value = label;
    cell.font = HEADER_FONT;
    cell.fill = HEADER_FILL;
    cell.border = BORDER;
    cell.alignment = { vertical: "middle", wrapText: true };
  });
  ws.getRow(row).height = 22;
}

function valueRow(
  ws: ExcelJS.Worksheet,
  row: number,
  values: string[],
  numFmts: (string | undefined)[] = [],
) {
  values.forEach((value, i) => {
    const cell = ws.getCell(row, i + 1);
    cell.value = value;
    cell.border = BORDER;
    cell.alignment = { vertical: "top", wrapText: true };
    if (numFmts[i]) cell.numFmt = numFmts[i];
  });
}

export async function buildSampleXlsxTemplate(t: Messages): Promise<Buffer> {
  const s = t.reports.sample;
  const wb = new ExcelJS.Workbook();
  wb.creator = "QLDA";
  wb.created = FIXED_DATE;
  wb.modified = FIXED_DATE;
  const ws = wb.addWorksheet(s.sheetName, {
    pageSetup: {
      paperSize: 9,
      orientation: "landscape",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
    },
    headerFooter: { oddFooter: "{{project.name}} · &P/&N" },
  });
  ws.columns = [
    { width: 7 },
    { width: 44 },
    { width: 18 },
    { width: 24 },
    { width: 14 },
    { width: 13 },
    { width: 22 },
    { width: 18 },
  ];

  // Tiêu đề (ô gộp ngang cả bảng).
  ws.mergeCells("A1:H1");
  ws.getCell("A1").value = s.title;
  ws.getCell("A1").font = { bold: true, size: 16 };
  ws.getRow(1).height = 26;
  const lines = [s.projectLine, s.periodLine, s.generatedLine];
  lines.forEach((line, i) => {
    ws.mergeCells(`A${i + 2}:H${i + 2}`);
    ws.getCell(`A${i + 2}`).value = line;
  });
  ws.getCell("A2").font = { bold: true };

  // 1. Tổng quan: ô riêng giữ kiểu số và tỷ lệ.
  ws.getCell("A6").value = s.overviewHeading;
  ws.getCell("A6").font = SECTION_FONT;
  headerRow(ws, 7, [
    "",
    s.overview.total,
    s.overview.done,
    s.overview.open,
    s.overview.overdue,
    s.overview.noDue,
    s.overview.blocked,
    s.overview.progress,
  ]);
  valueRow(
    ws,
    8,
    [
      "",
      "{{counts.total}}",
      "{{counts.done}}",
      "{{counts.open}}",
      "{{counts.overdue}}",
      "{{counts.open_no_due}}",
      "{{counts.blocked}}",
      "{{progress.ratio}}",
    ],
    [, "#,##0", "#,##0", "#,##0", "#,##0", "#,##0", "#,##0", "0%"],
  );

  // 2. Trong kỳ.
  ws.getCell("A10").value = s.periodHeading;
  ws.getCell("A10").font = SECTION_FONT;
  headerRow(ws, 11, [
    "",
    s.periodCols.tasks,
    s.periodCols.created,
    s.periodCols.completed,
    s.periodCols.due,
  ]);
  valueRow(
    ws,
    12,
    [
      "",
      "{{period.task_count}}",
      "{{period.created_count}}",
      "{{period.completed_count}}",
      "{{period.due_count}}",
    ],
    [, "#,##0", "#,##0", "#,##0", "#,##0"],
  );

  // 3. Theo trạng thái: vùng lặp thứ nhất.
  ws.getCell("A14").value = s.statusHeading;
  ws.getCell("A14").font = SECTION_FONT;
  headerRow(ws, 15, [
    "#",
    s.statusCols.name,
    s.statusCols.group,
    s.statusCols.count,
    s.statusCols.ratio,
  ]);
  valueRow(
    ws,
    16,
    [
      "{{#statuses}}{{status.index}}",
      "{{status.name}}",
      "{{status.group}}",
      "{{status.count}}",
      "{{status.ratio}}",
    ],
    [, , , "#,##0", "0%"],
  );

  // 4. Danh sách task trong kỳ: vùng lặp thứ hai, có bộ lọc và dòng tổng bằng công thức.
  ws.getCell("A18").value = s.tasksHeading;
  ws.getCell("A18").font = SECTION_FONT;
  const taskHeader = 19;
  const taskRow = 20;
  headerRow(ws, taskHeader, [
    s.taskCols.index,
    s.taskCols.title,
    s.taskCols.status,
    s.taskCols.assignee,
    s.taskCols.priority,
    s.taskCols.due,
    s.taskCols.labels,
    s.taskCols.completed,
  ]);
  valueRow(
    ws,
    taskRow,
    [
      "{{#tasks}}{{task.index}}",
      "{{task.title}}",
      "{{task.status}}",
      "{{task.assignee}}",
      "{{task.priority}}",
      "{{task.due_date}}",
      "{{task.labels}}",
      "{{task.completed_at}}",
    ],
    [, , , , , "dd/mm/yyyy", , "dd/mm/yyyy hh:mm"],
  );
  ws.autoFilter = `A${taskHeader}:H${taskRow}`;
  // Hạn đã qua mà chưa hoàn thành: tô đỏ ô Hạn.
  ws.addConditionalFormatting({
    ref: `F${taskRow}:F${taskRow}`,
    rules: [
      {
        type: "expression",
        priority: 1,
        formulae: [
          `AND(F${taskRow}<>"",H${taskRow}="",F${taskRow}<INT(NOW()))`,
        ],
        style: {
          font: { color: { argb: "FFC81E1E" }, bold: true },
        },
      },
    ],
  });
  const totalRow = taskRow + 1;
  ws.getCell(`A${totalRow}`).value = s.total;
  ws.mergeCells(`A${totalRow}:E${totalRow}`);
  ws.getCell(`A${totalRow}`).font = { bold: true };
  ws.getCell(`A${totalRow}`).alignment = { horizontal: "right" };
  ws.getCell(`F${totalRow}`).value = {
    formula: `COUNTA(B${taskRow}:B${taskRow})`,
    result: 0,
  } as ExcelJS.CellFormulaValue;
  ws.getCell(`F${totalRow}`).font = { bold: true };

  // Chân trang ký tên: nằm dưới bảng, phải dời theo số dòng task.
  ws.mergeCells(`F${totalRow + 2}:H${totalRow + 2}`);
  ws.getCell(`F${totalRow + 2}`).value = s.signature;
  ws.getCell(`F${totalRow + 2}`).font = { bold: true };
  ws.getCell(`F${totalRow + 2}`).alignment = { horizontal: "center" };
  ws.mergeCells(`F${totalRow + 5}:H${totalRow + 5}`);
  ws.getCell(`F${totalRow + 5}`).value = "{{report.generated_by}}";
  ws.getCell(`F${totalRow + 5}`).alignment = { horizontal: "center" };

  ws.pageSetup.printArea = `A1:H${totalRow + 5}`;
  ws.views = [{ state: "normal", showGridLines: false }];

  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out as ArrayBuffer);
}
