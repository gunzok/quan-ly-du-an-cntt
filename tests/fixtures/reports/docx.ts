import { writeZip } from "@/lib/reports/zip-write";
import { readZipText } from "./report-data";

/**
 * Tiện ích test docx (Story E5-4): dựng template docx tối thiểu từ XML thân, và đọc lại tệp docx
 * thành danh sách dòng chữ có cấu trúc để so golden (không so byte: docx-templates đổi thứ tự
 * thuộc tính, nén khác nhau giữa các phiên bản).
 */

const W_NS =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Một đoạn văn một run. */
export function p(text: string): string {
  return `<w:p><w:r><w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:p>`;
}

/** Bảng: mỗi phần tử là một dòng, mỗi dòng là các ô chữ. */
export function tbl(rows: string[][]): string {
  return `<w:tbl><w:tblPr/><w:tblGrid>${rows[0]
    .map(() => '<w:gridCol w:w="2000"/>')
    .join("")}</w:tblGrid>${rows
    .map((r) => `<w:tr>${r.map((c) => `<w:tc>${p(c)}</w:tc>`).join("")}</w:tr>`)
    .join("")}</w:tbl>`;
}

/** Template docx tối thiểu với XML thân cho trước (có thể kèm chân trang). */
export function docxFromBody(bodyXml: string, footerXml?: string): Buffer {
  const footerRel = footerXml
    ? '<Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>'
    : "";
  const footerType = footerXml
    ? '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>'
    : "";
  const sect = footerXml
    ? '<w:sectPr><w:footerReference w:type="default" r:id="rId9"/></w:sectPr>'
    : "";
  return writeZip([
    {
      name: "[Content_Types].xml",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>${footerType}</Types>`,
    },
    {
      name: "_rels/.rels",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
    },
    {
      name: "word/_rels/document.xml.rels",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${footerRel}</Relationships>`,
    },
    {
      name: "word/document.xml",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${W_NS}><w:body>${bodyXml}${sect}</w:body></w:document>`,
    },
    ...(footerXml
      ? [
          {
            name: "word/footer1.xml",
            data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr ${W_NS}>${footerXml}</w:ftr>`,
          },
        ]
      : []),
  ]);
}

function decode(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

const TOKEN_RE =
  /<w:tbl>|<\/w:tbl>|<w:tr[ >]|<\/w:tr>|<w:tc>|<\/w:tc>|<w:p[ >]|<w:p\/>|<\/w:p>|<w:t(?: [^>]*)?>([^<]*)<\/w:t>|<w:br\/>|<w:tab\/>/g;

/**
 * XML WordprocessingML → dòng chữ: đoạn ngoài bảng `¶ chữ`, bảng `▦` rồi mỗi dòng
 * `| ô | ô |` (nhiều đoạn trong ô nối bằng " / "). Chữ đã giải mã thực thể XML.
 */
export function dumpWordXml(xml: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let row: string[] | null = null;
  let cellParas: string[] | null = null;
  let para: string | null = null;
  for (const m of xml.matchAll(TOKEN_RE)) {
    const tok = m[0];
    if (tok === "<w:tbl>") {
      depth++;
      out.push("▦");
    } else if (tok === "</w:tbl>") depth--;
    else if (tok.startsWith("<w:tr")) row = [];
    else if (tok === "</w:tr>") {
      out.push(`| ${(row ?? []).join(" | ")} |`);
      row = null;
    } else if (tok === "<w:tc>") cellParas = [];
    else if (tok === "</w:tc>") {
      row?.push((cellParas ?? []).filter((x) => x !== "").join(" / "));
      cellParas = null;
    } else if (tok === "<w:p/>") {
      if (depth === 0) out.push("¶");
    } else if (tok.startsWith("<w:p")) para = "";
    else if (tok === "</w:p>") {
      if (cellParas) cellParas.push(para ?? "");
      else if (depth === 0) out.push(para ? `¶ ${para}` : "¶");
      para = null;
    } else if (tok === "<w:br/>") para = `${para ?? ""}⏎`;
    else if (tok === "<w:tab/>") para = `${para ?? ""}⇥`;
    else para = `${para ?? ""}${decode(m[1] ?? "")}`;
  }
  return out;
}

/** Tệp docx → `{ "word/document.xml": [...dòng], "word/footer1.xml": [...] }`. */
export function dumpDocx(bytes: Uint8Array): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const part of ["word/document.xml", "word/footer1.xml"]) {
    const xml = readZipText(bytes, part);
    if (xml !== null) out[part] = dumpWordXml(xml);
  }
  return out;
}
