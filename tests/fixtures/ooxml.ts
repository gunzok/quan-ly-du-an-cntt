/**
 * Sinh tệp xlsx/docx GIẢ tối giản cho test template báo cáo (Story E5-2, R-005: chưa có template
 * thật của công ty). Không có dữ liệu thật. Tự ghép ZIP bằng node:zlib, không thêm thư viện, để test
 * dựng được cả tệp hợp lệ lẫn tệp hỏng/độc hại (macro, ZIP bomb, sai chữ ký...).
 *
 * Dùng chung cho unit test (lib/report-templates), test tích hợp và e2e.
 */
import { crc32, deflateRawSync } from "node:zlib";

export interface ZipEntryInput {
  name: string;
  data: Buffer | string;
  /** Mặc định nén deflate. */
  store?: boolean;
  /** Ghi đè kích thước giải nén khai trong ZIP (giả lập khai man). */
  declaredSize?: number;
}

/** Ghép một tệp ZIP (không ZIP64, không mã hóa). */
export function buildZip(entries: ZipEntryInput[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const raw = Buffer.isBuffer(entry.data)
      ? entry.data
      : Buffer.from(entry.data, "utf8");
    const method = entry.store ? 0 : 8;
    const body = entry.store ? raw : deflateRawSync(raw);
    const name = Buffer.from(entry.name, "utf8");
    const crc = crc32(raw);
    const size = entry.declaredSize ?? raw.length;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // tên UTF-8
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, body);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);

    offset += local.length + name.length + body.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

const RELS_ROOT = (target: string) =>
  `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
  `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="${target}"/>` +
  `</Relationships>`;

export const DOCX_MAIN =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml";
export const DOCM_MAIN =
  "application/vnd.ms-word.document.macroEnabled.main+xml";
export const XLSX_MAIN =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml";
export const XLSM_MAIN = "application/vnd.ms-excel.sheet.macroEnabled.main+xml";

function contentTypes(overrides: Record<string, string>, extra = "") {
  return (
    `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    Object.entries(overrides)
      .map(
        ([part, type]) =>
          `<Override PartName="${part}" ContentType="${type}"/>`,
      )
      .join("") +
    extra +
    `</Types>`
  );
}

/** Các mục của một docx tối giản (mở được bằng Word/LibreOffice). */
export function docxEntries(
  options: { mainType?: string; text?: string } = {},
): ZipEntryInput[] {
  const text = options.text ?? "Báo cáo tiến độ (mẫu giả để kiểm thử)";
  return [
    {
      name: "[Content_Types].xml",
      data: contentTypes({
        "/word/document.xml": options.mainType ?? DOCX_MAIN,
      }),
    },
    { name: "_rels/.rels", data: RELS_ROOT("word/document.xml") },
    {
      name: "word/document.xml",
      data:
        `${XML}<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
        `<w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`,
    },
  ];
}

/** Các mục của một xlsx tối giản (mở được bằng Excel/LibreOffice). */
export function xlsxEntries(
  options: { mainType?: string } = {},
): ZipEntryInput[] {
  return [
    {
      name: "[Content_Types].xml",
      data: contentTypes({
        "/xl/workbook.xml": options.mainType ?? XLSX_MAIN,
        "/xl/worksheets/sheet1.xml":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml",
      }),
    },
    { name: "_rels/.rels", data: RELS_ROOT("xl/workbook.xml") },
    {
      name: "xl/workbook.xml",
      data:
        `${XML}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
        `<sheets><sheet name="Tiến độ" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      data:
        `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>` +
        `</Relationships>`,
    },
    {
      name: "xl/worksheets/sheet1.xml",
      data:
        `${XML}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
        `<sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Mẫu giả</t></is></c></row></sheetData></worksheet>`,
    },
  ];
}

export const sampleDocx = () => buildZip(docxEntries());
export const sampleXlsx = () => buildZip(xlsxEntries());

/** docx đổi đuôi nhưng thực chất có macro (vbaProject.bin, content type macroEnabled). */
export function macroDocx(): Buffer {
  return buildZip([
    ...docxEntries({ mainType: DOCM_MAIN }),
    { name: "word/vbaProject.bin", data: Buffer.from("giả lập macro") },
  ]);
}

/** xlsx có vbaProject.bin nhưng [Content_Types].xml vẫn khai như xlsx thường. */
export function hiddenMacroXlsx(): Buffer {
  return buildZip([
    ...xlsxEntries(),
    { name: "xl/vbaProject.bin", data: Buffer.from("giả lập macro") },
  ]);
}

/** ZIP bomb đơn giản: một mục toàn số 0 rất lớn, nén còn vài chục KB. */
export function zipBombDocx(uncompressedBytes = 80 * 1024 * 1024): Buffer {
  return buildZip([
    ...docxEntries(),
    { name: "word/media/padding.bin", data: Buffer.alloc(uncompressedBytes) },
  ]);
}

/** Khai kích thước giải nén nhỏ nhưng thực tế lớn hơn (khai man để lách kiểm tra). */
export function lyingSizeDocx(): Buffer {
  return buildZip([
    ...docxEntries(),
    {
      name: "word/media/padding.bin",
      data: Buffer.alloc(2 * 1024 * 1024),
      declaredSize: 10,
    },
  ]);
}

/** ZIP có quá nhiều mục. */
export function manyEntriesDocx(count = 3000): Buffer {
  const extra: ZipEntryInput[] = [];
  for (let i = 0; i < count; i++) {
    extra.push({ name: `word/media/x${i}.xml`, data: "<a/>", store: true });
  }
  return buildZip([...docxEntries(), ...extra]);
}

/** ZIP có mục tên trèo thư mục (zip slip). */
export function zipSlipDocx(): Buffer {
  return buildZip([
    ...docxEntries(),
    { name: "../../etc/evil.xml", data: "<a/>" },
  ]);
}

export const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
