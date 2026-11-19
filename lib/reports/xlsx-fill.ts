import ExcelJS from "exceljs";
import type { Locale } from "@/lib/i18n/config";
import {
  formatCalendarDate,
  formatDateInZone,
  formatNumber,
  formatTimeInZone,
} from "@/lib/i18n/format";
import { calendarDateValue, vnWallClock } from "./period";
import {
  type CellValue,
  type SectionName,
  type ValueMap,
} from "./placeholders";
import {
  insertMapper,
  mapFormulaRows,
  rangeOnRow,
  rangeRows,
  shiftRange,
  type RowShift,
} from "./xlsx-refs";

/**
 * Điền dữ liệu vào template xlsx bằng exceljs (Story E5-3, ADR-004). Quy ước template:
 * docs/03-design/report-template-xlsx.md.
 *
 * - `{{khóa}}` trong ô chữ (cả chữ định dạng nhiều kiểu) được thay bằng giá trị. Ô CHỈ chứa một ô
 *   giữ chỗ thì ghi đúng kiểu (số, ngày, ngày giờ, tỷ lệ) để Excel tính được; ô có chữ xung quanh
 *   thì ghi chữ đã định dạng theo ngôn ngữ.
 * - Dòng có `{{#tasks}}` (hoặc `{{#statuses}}`, `{{#assignees}}`) là dòng mẫu lặp: nhân thành một
 *   dòng mỗi phần tử, giữ kiểu ô, chiều cao, ô gộp trong dòng; các dòng phía dưới dời xuống cùng
 *   công thức, ô gộp, định dạng có điều kiện, kiểm dữ liệu, vùng in, bộ lọc, ngắt trang, ảnh.
 *   Công thức ở bất kỳ đâu có vùng chứa dòng mẫu (=SUM(E10:E10)) giãn ra phủ mọi dòng mới.
 * - Khóa không biết: giữ nguyên chữ để người soạn template thấy lỗi chính tả.
 * - Công thức của template giữ nguyên; tệp đặt "tính lại khi mở" để Excel cập nhật kết quả.
 * - Chuỗi người dùng nhập (tiêu đề task...) luôn ghi là ô CHỮ, không bao giờ thành công thức, nên
 *   tiêu đề bắt đầu bằng "=" không chạy được (không có lỗi chèn công thức như CSV).
 */

export interface FillOptions {
  locale: Locale;
  /** Chữ ở dòng mẫu khi vùng lặp không có phần tử nào. */
  emptyText: Record<SectionName, string>;
}

export interface FillInput {
  scalars: ValueMap;
  sections: Record<SectionName, ValueMap[]>;
}

const TOKEN_RE = /\{\{\s*([#/]?)([a-z_]+(?:\.[a-z_]+)*)\s*\}\}/g;
const WHOLE_RE = /^\s*\{\{\s*([a-z_]+(?:\.[a-z_]+)*)\s*\}\}\s*$/;
const MARKER_RE = /\{\{\s*[#/](tasks|statuses|assignees)\s*\}\}/g;

const DEFAULT_NUMFMT: Record<
  Exclude<CellValue["kind"], "text" | "number">,
  string
> = {
  date: "dd/mm/yyyy",
  datetime: "dd/mm/yyyy hh:mm",
  ratio: "0%",
};

type CellSnapshot = {
  col: number;
  value: ExcelJS.CellValue;
  style: Partial<ExcelJS.Style>;
  note?: ExcelJS.Comment | string;
};

/** Thuộc tính exceljs có lúc chạy nhưng thiếu trong index.d.ts. */
type StyledRow = ExcelJS.Row & { style: Partial<ExcelJS.Style> };
type SheetInternals = {
  conditionalFormattings?: {
    ref: string;
    rules?: { formulae?: unknown[] }[];
  }[];
  dataValidations?: { model: Record<string, ExcelJS.DataValidation> };
};

type RowSnapshot = {
  height?: number;
  hidden: boolean;
  outlineLevel?: number;
  style: Partial<ExcelJS.Style>;
  cells: CellSnapshot[];
};

function formatInline(v: CellValue | null, locale: Locale): string {
  if (!v) return "";
  switch (v.kind) {
    case "text":
      return v.value;
    case "number":
      return formatNumber(v.value, locale);
    case "ratio":
      return `${formatNumber(Math.round(v.value * 100), locale)}%`;
    case "date":
      return formatCalendarDate(v.value, locale) ?? v.value;
    case "datetime":
      return `${formatDateInZone(v.value, locale)} ${formatTimeInZone(v.value, locale)}`;
  }
}

/** Thay mọi `{{khóa}}` đã biết trong một chuỗi; khóa lạ giữ nguyên. */
function replaceInline(s: string, values: ValueMap, locale: Locale): string {
  return s.replace(TOKEN_RE, (match, sigil: string, key: string) => {
    if (sigil) return match;
    return Object.prototype.hasOwnProperty.call(values, key)
      ? formatInline(values[key], locale)
      : match;
  });
}

function hasToken(s: string): boolean {
  return s.includes("{{");
}

/** Ghi giá trị có kiểu vào ô; kiểu ngày/tỷ lệ thêm định dạng số nếu ô template chưa có. */
function writeTyped(cell: ExcelJS.Cell, v: CellValue | null) {
  if (!v) {
    cell.value = null;
    return;
  }
  switch (v.kind) {
    case "text":
      cell.value = v.value;
      return;
    case "number":
      cell.value = v.value;
      return;
    case "ratio":
    case "date":
    case "datetime": {
      cell.value =
        v.kind === "ratio"
          ? v.value
          : v.kind === "date"
            ? calendarDateValue(v.value)
            : vnWallClock(v.value);
      const current = cell.style?.numFmt;
      if (!current || current === "General") {
        // Gán đối tượng style MỚI: style của ô có thể dùng chung với ô khác.
        cell.style = { ...cell.style, numFmt: DEFAULT_NUMFMT[v.kind] };
      }
      return;
    }
  }
}

function richTextOf(
  value: ExcelJS.CellValue,
): ExcelJS.CellRichTextValue | null {
  return value &&
    typeof value === "object" &&
    "richText" in value &&
    Array.isArray(value.richText)
    ? value
    : null;
}

/** Thay ô giữ chỗ trong một ô (chữ hoặc chữ nhiều kiểu). Ô công thức, siêu liên kết: bỏ qua. */
function fillCell(cell: ExcelJS.Cell, values: ValueMap, locale: Locale) {
  const value = cell.value;
  if (typeof value === "string") {
    if (!hasToken(value)) return;
    const whole = WHOLE_RE.exec(value);
    if (whole && Object.prototype.hasOwnProperty.call(values, whole[1])) {
      writeTyped(cell, values[whole[1]]);
      return;
    }
    const next = replaceInline(value, values, locale);
    if (next !== value) cell.value = next;
    return;
  }
  const rich = richTextOf(value);
  if (rich && rich.richText.some((r) => hasToken(r.text))) {
    const plain = rich.richText.map((r) => r.text).join("");
    const whole = WHOLE_RE.exec(plain);
    if (whole && Object.prototype.hasOwnProperty.call(values, whole[1])) {
      writeTyped(cell, values[whole[1]]);
      return;
    }
    cell.value = {
      richText: rich.richText.map((r) => ({
        ...r,
        text: replaceInline(r.text, values, locale),
      })),
    };
  }
}

function cellText(value: ExcelJS.CellValue): string {
  if (typeof value === "string") return value;
  const rich = richTextOf(value);
  return rich ? rich.richText.map((r) => r.text).join("") : "";
}

/** Bỏ dấu vùng lặp `{{#tasks}}`/`{{/tasks}}` khỏi ô. */
function stripMarkers(value: ExcelJS.CellValue): ExcelJS.CellValue {
  if (typeof value === "string") {
    const next = value.replace(MARKER_RE, "");
    return next.trim() === "" && value.trim() !== "" ? null : next;
  }
  const rich = richTextOf(value);
  if (rich) {
    const runs = rich.richText.map((r) => ({
      ...r,
      text: r.text.replace(MARKER_RE, ""),
    }));
    return runs.every((r) => r.text.trim() === "")
      ? null
      : { richText: runs.filter((r) => r.text !== "") };
  }
  return value;
}

/** Giá trị để chép: công thức dùng chung (shared formula) đổi thành công thức riêng của ô. */
function snapshotValue(cell: ExcelJS.Cell): ExcelJS.CellValue {
  if (cell.type === ExcelJS.ValueType.Formula) {
    const v = cell.value as ExcelJS.CellFormulaValue;
    return { formula: cell.formula, result: v?.result } as ExcelJS.CellValue;
  }
  if (cell.type === ExcelJS.ValueType.Merge) return null;
  return cell.value;
}

function snapshotRow(row: ExcelJS.Row): RowSnapshot {
  const cells: CellSnapshot[] = [];
  row.eachCell({ includeEmpty: true }, (cell, col) => {
    const value = snapshotValue(cell);
    const note = cell.note;
    if (value === null && !cell.style && !note) return;
    cells.push({
      col,
      value,
      style: cell.style ?? {},
      ...(note ? { note } : {}),
    });
  });
  return {
    height: row.height,
    hidden: row.hidden,
    outlineLevel: row.outlineLevel,
    style: (row as StyledRow).style ?? {},
    cells,
  };
}

function clearRow(row: ExcelJS.Row) {
  row.eachCell({ includeEmpty: true }, (cell) => {
    cell.value = null;
    cell.style = {};
    if (cell.note) cell.note = undefined as unknown as string;
  });
  (row as StyledRow).style = {};
  row.hidden = false;
  (row as { height?: number }).height = undefined;
}

function writeRow(
  row: ExcelJS.Row,
  snap: RowSnapshot,
  mapValue: (v: ExcelJS.CellValue) => ExcelJS.CellValue,
) {
  if (snap.height !== undefined) row.height = snap.height;
  row.hidden = snap.hidden;
  if (snap.outlineLevel) row.outlineLevel = snap.outlineLevel;
  (row as StyledRow).style = snap.style;
  for (const c of snap.cells) {
    const cell = row.getCell(c.col);
    cell.style = c.style;
    cell.value = mapValue(c.value);
    if (c.note) cell.note = c.note;
  }
}

function mapFormulaValue(
  value: ExcelJS.CellValue,
  fn: (f: string) => string,
): ExcelJS.CellValue {
  if (value && typeof value === "object" && "formula" in value) {
    const f = value as ExcelJS.CellFormulaValue;
    return { ...f, formula: fn(f.formula) };
  }
  return value;
}

interface MergeInfo {
  range: string;
  top: number;
  bottom: number;
}

function sheetMerges(ws: ExcelJS.Worksheet): MergeInfo[] {
  // exceljs không có API công khai liệt kê ô gộp ngoài ws.model (dựng lại cả trang, chậm).
  const internal = (
    ws as unknown as { _merges?: Record<string, { range: string }> }
  )._merges;
  const merges = Object.values(internal ?? {}).map((m) => m.range);
  return merges.flatMap((range) => {
    const rows = rangeRows(range);
    return rows ? [{ range, top: rows[0], bottom: rows[1] }] : [];
  });
}

/** Dời công thức của MỌI trang tham chiếu tới `ws` (trừ các dòng đã xử lý riêng). */
function shiftFormulasEverywhere(
  wb: ExcelJS.Workbook,
  ws: ExcelJS.Worksheet,
  shift: RowShift,
  skipFromRow: number,
) {
  const map = insertMapper(shift);
  wb.eachSheet((sheet) => {
    sheet.eachRow((row, rowNumber) => {
      if (sheet === ws && rowNumber >= skipFromRow) return;
      row.eachCell((cell) => {
        if (cell.type !== ExcelJS.ValueType.Formula) return;
        const formula = cell.formula;
        const next = mapFormulaRows(
          formula,
          { formulaSheet: sheet.name, targetSheet: ws.name },
          map,
        );
        if (next !== formula) {
          const v = cell.value as ExcelJS.CellFormulaValue;
          cell.value = { formula: next, result: v?.result };
        }
      });
    });
  });
}

/** Dời các thành phần cấp trang (định dạng có điều kiện, kiểm dữ liệu, in, lọc, ảnh, tên). */
function shiftSheetFeatures(
  wb: ExcelJS.Workbook,
  ws: ExcelJS.Worksheet,
  shift: RowShift,
) {
  const { row: r, delta } = shift;
  const sheet = ws as unknown as SheetInternals;
  const formulaMap = (f: string) =>
    mapFormulaRows(
      f,
      { formulaSheet: ws.name, targetSheet: ws.name },
      insertMapper(shift),
    );
  for (const cf of sheet.conditionalFormattings ?? []) {
    cf.ref = shiftRange(cf.ref, shift);
    // Công thức của quy tắc tương đối với ô đầu vùng: dời cùng vùng.
    for (const rule of cf.rules ?? []) {
      if (Array.isArray(rule.formulae)) {
        rule.formulae = rule.formulae.map((f) =>
          typeof f === "string" ? formulaMap(f) : f,
        );
      }
    }
  }
  // Kiểm dữ liệu: exceljs lưu theo từng ô.
  const dv = sheet.dataValidations;
  if (dv?.model) {
    const next: Record<string, ExcelJS.DataValidation> = {};
    for (const [address, rule] of Object.entries(dv.model)) {
      const rows = rangeRows(address);
      if (!rows) {
        next[address] = rule;
        continue;
      }
      const row = rows[0];
      if (row === r) {
        for (let i = 0; i <= delta; i++) {
          next[rangeOnRow(address, r + i)] = rule;
        }
      } else {
        next[row > r ? rangeOnRow(address, row + delta) : address] = rule;
      }
    }
    dv.model = next;
  }
  if (typeof ws.autoFilter === "string") {
    ws.autoFilter = shiftRange(ws.autoFilter, shift);
  }
  if (ws.pageSetup?.printArea) {
    ws.pageSetup.printArea = ws.pageSetup.printArea
      .split("&&")
      .map((area) => shiftRange(area, shift))
      .join("&&");
  }
  const breaks = (ws as unknown as { rowBreaks?: { id: number }[] }).rowBreaks;
  if (Array.isArray(breaks)) {
    for (const b of breaks) if (b.id > r) b.id += delta;
  }
  for (const image of ws.getImages()) {
    const range = image.range as unknown as {
      tl?: { nativeRow: number };
      br?: { nativeRow: number };
    };
    // nativeRow tính từ 0: dòng 1-based r+1 là nativeRow r.
    if (range.tl && range.tl.nativeRow >= r) range.tl.nativeRow += delta;
    if (range.br && range.br.nativeRow >= r) range.br.nativeRow += delta;
  }
  const names = wb.definedNames as unknown as {
    spliceRows?: (
      sheet: string,
      start: number,
      count: number,
      inserts: number,
    ) => void;
  };
  names.spliceRows?.(ws.name, r + 1, 0, delta);
}

/**
 * Nhân dòng mẫu `r` của trang `ws` thành một dòng cho mỗi phần tử. Không có phần tử nào: giữ một
 * dòng, ghi chữ "không có dữ liệu" vào ô đầu tiên có ô giữ chỗ, xóa các ô giữ chỗ còn lại.
 */
function expandSection(
  wb: ExcelJS.Workbook,
  ws: ExcelJS.Worksheet,
  r: number,
  section: SectionName,
  items: ValueMap[],
  opts: FillOptions,
) {
  const delta = Math.max(items.length, 1) - 1;
  const lastRow = Math.max(ws.rowCount, r);
  const shift: RowShift = { row: r, delta };

  // 1. Ô gộp chạm dòng mẫu hoặc nằm dưới: gỡ ra rồi gộp lại ở vị trí mới.
  const merges = sheetMerges(ws).filter((m) => m.bottom >= r);
  for (const m of merges) ws.unMergeCells(m.range);

  // 2. Chụp dòng mẫu và các dòng phía dưới, rồi xóa sạch chúng.
  const template = snapshotRow(ws.getRow(r));
  const below: RowSnapshot[] = [];
  for (let n = r + 1; n <= lastRow; n++) below.push(snapshotRow(ws.getRow(n)));
  for (let n = r; n <= lastRow; n++) clearRow(ws.getRow(n));

  // 3. Công thức ở chỗ khác (phía trên, trang khác) trỏ vào vùng bị dời.
  if (delta > 0) shiftFormulasEverywhere(wb, ws, shift, r);

  const sheetCtx = { formulaSheet: ws.name, targetSheet: ws.name };
  const belowMapper = insertMapper(shift);

  // 4. Ghi lại các dòng phía dưới ở vị trí mới (từ dưới lên).
  for (let i = below.length - 1; i >= 0; i--) {
    writeRow(ws.getRow(r + 1 + i + delta), below[i], (v) =>
      mapFormulaValue(v, (f) => mapFormulaRows(f, sheetCtx, belowMapper)),
    );
  }

  // 5. Các dòng dữ liệu từ dòng mẫu.
  const firstTokenCol = template.cells.find((c) =>
    hasToken(cellText(c.value)),
  )?.col;
  const count = Math.max(items.length, 1);
  for (let i = 0; i < count; i++) {
    const rowNumber = r + i;
    // Tham chiếu tương đối tới chính dòng mẫu trỏ sang dòng của phần tử (=E10*F10 → =E11*F11).
    const itemMapper = (
      row: number,
      part: "cell" | "start" | "end",
      abs: boolean,
    ) => (!abs && row === r ? rowNumber : belowMapper(row, part, abs));
    const values: ValueMap = items[i] ?? {};
    const row = ws.getRow(rowNumber);
    writeRow(row, template, (v) =>
      mapFormulaValue(stripMarkers(v), (f) =>
        mapFormulaRows(f, sheetCtx, itemMapper),
      ),
    );
    for (const c of template.cells) {
      const cell = row.getCell(c.col);
      if (items.length === 0) {
        if (!hasToken(cellText(cell.value))) continue;
        cell.value = c.col === firstTokenCol ? opts.emptyText[section] : null;
        continue;
      }
      // Trường lạ: giữ nguyên chữ cho người soạn thấy.
      fillCell(cell, values, opts.locale);
    }
  }
  if (items.length === 0 && firstTokenCol === undefined) {
    ws.getRow(r).getCell(1).value = opts.emptyText[section];
  }

  // 6. Gộp lại ô.
  for (const m of merges) {
    if (m.top === r && m.bottom === r) {
      for (let i = 0; i <= delta; i++) {
        ws.mergeCellsWithoutStyle(rangeOnRow(m.range, r + i));
      }
    } else {
      ws.mergeCellsWithoutStyle(shiftRange(m.range, shift));
    }
  }

  // 7. Thành phần cấp trang.
  if (delta > 0) shiftSheetFeatures(wb, ws, shift);
}

/** Tìm các dòng mẫu lặp của một trang (theo thứ tự từ dưới lên để chèn không làm lệch nhau). */
function findSectionRows(
  ws: ExcelJS.Worksheet,
): { row: number; section: SectionName }[] {
  const found: { row: number; section: SectionName }[] = [];
  ws.eachRow((row, rowNumber) => {
    let section: SectionName | null = null;
    row.eachCell((cell) => {
      if (section) return;
      const m = /\{\{\s*#(tasks|statuses|assignees)\s*\}\}/.exec(
        cellText(cell.value),
      );
      if (m) section = m[1] as SectionName;
    });
    if (section) found.push({ row: rowNumber, section });
  });
  return found.sort((a, b) => b.row - a.row);
}

function fillHeaderFooter(
  ws: ExcelJS.Worksheet,
  values: ValueMap,
  locale: Locale,
) {
  const hf = ws.headerFooter as unknown as Record<string, unknown> | undefined;
  if (!hf) return;
  for (const key of Object.keys(hf)) {
    const v = hf[key];
    if (typeof v === "string" && hasToken(v)) {
      hf[key] = replaceInline(v, values, locale);
    }
  }
}

/** Mở template, điền dữ liệu, trả nội dung tệp xlsx. */
export async function fillXlsxTemplate(
  template: Uint8Array,
  input: FillInput,
  opts: FillOptions,
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(template as unknown as ArrayBuffer);
  wb.eachSheet((ws) => {
    for (const { row, section } of findSectionRows(ws)) {
      expandSection(wb, ws, row, section, input.sections[section], opts);
    }
  });
  wb.eachSheet((ws) => {
    ws.eachRow((row) => {
      row.eachCell((cell) => fillCell(cell, input.scalars, opts.locale));
    });
    fillHeaderFooter(ws, input.scalars, opts.locale);
  });
  wb.calcProperties = { ...wb.calcProperties, fullCalcOnLoad: true };
  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out as ArrayBuffer);
}
