import type { Messages } from "@/lib/i18n/messages";
import { writeZip } from "./zip-write";

/**
 * Template docx MẪU (Story E5-4, R-005: công ty chưa có template thật). Sinh bằng code (XML
 * WordprocessingML viết tay, nén bằng zip-write.ts), không chứa dữ liệu thật, ra cùng byte mỗi lần
 * sinh. Minh họa đủ quy ước ở docs/03-design/report-template-docx.md: ô giữ chỗ trong chữ, bảng số
 * liệu, ba bảng lặp `{{FOR ... IN ...}}`/`{{END-FOR ...}}` trên dòng riêng (theo trạng thái, task
 * trong kỳ, theo người phụ trách) có dòng tiêu đề lặp lại khi sang trang, `{{empty.*}}` khi vùng lặp rỗng, chân trang có ô giữ
 * chỗ và số trang, khối ký tên.
 *
 * Tải về: GET /api/v1/report-templates/sample?format=docx (Admin, PM).
 */

const W_NS =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

/** Ngày giờ cố định (không lộ giờ máy chủ, golden ổn định). */
const FIXED_ISO = "2026-11-01T00:00:00Z";

/** A4 ngang, lề 1,5 cm (đơn vị twip: 1 cm = 567). */
const PAGE_W = 16838;
const PAGE_H = 11906;
const MARGIN = 850;
const CONTENT_W = PAGE_W - 2 * MARGIN;

const HEADER_FILL = "0A0F1F";
const ACCENT = "2054F0";
const BORDER = "C9CED8";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

interface RunOpts {
  bold?: boolean;
  color?: string;
  size?: number;
}

function run(text: string, o: RunOpts = {}): string {
  const props = [
    o.bold ? "<w:b/>" : "",
    o.color ? `<w:color w:val="${o.color}"/>` : "",
    o.size ? `<w:sz w:val="${o.size}"/><w:szCs w:val="${o.size}"/>` : "",
  ].join("");
  return `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ""}<w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;
}

interface ParaOpts extends RunOpts {
  style?: string;
  align?: "left" | "center" | "right";
  keepNext?: boolean;
  spaceAfter?: number;
}

function para(content: string | string[], o: ParaOpts = {}): string {
  const runs = Array.isArray(content)
    ? content.join("")
    : content
      ? run(content, o)
      : "";
  const props = [
    o.style ? `<w:pStyle w:val="${o.style}"/>` : "",
    o.keepNext ? "<w:keepNext/>" : "",
    o.spaceAfter !== undefined ? `<w:spacing w:after="${o.spaceAfter}"/>` : "",
    o.align ? `<w:jc w:val="${o.align}"/>` : "",
  ].join("");
  return `<w:p>${props ? `<w:pPr>${props}</w:pPr>` : ""}${runs}</w:p>`;
}

function cell(
  text: string,
  width: number,
  o: { header?: boolean; align?: "left" | "center" | "right" } = {},
): string {
  const shade = o.header
    ? `<w:shd w:val="clear" w:color="auto" w:fill="${HEADER_FILL}"/>`
    : "";
  return `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>${shade}</w:tcPr>${para(
    text,
    {
      bold: o.header,
      color: o.header ? "FFFFFF" : undefined,
      align: o.align,
      spaceAfter: 0,
    },
  )}</w:tc>`;
}

/** Bảng: dòng tiêu đề (lặp lại khi sang trang) + các dòng; `nums` là cột căn phải. */
function table(
  widths: number[],
  header: string[],
  rows: string[][],
  nums: number[] = [],
): string {
  const grid = widths.map((w) => `<w:gridCol w:w="${w}"/>`).join("");
  const b = `w:val="single" w:sz="4" w:space="0" w:color="${BORDER}"`;
  const head = `<w:tr><w:trPr><w:tblHeader/><w:cantSplit/></w:trPr>${header
    .map((h, i) => cell(h, widths[i], { header: true }))
    .join("")}</w:tr>`;
  const body = rows
    .map(
      (r) =>
        `<w:tr><w:trPr><w:cantSplit/></w:trPr>${r
          .map((c, i) =>
            cell(c, widths[i], {
              align: nums.includes(i) ? "right" : undefined,
            }),
          )
          .join("")}</w:tr>`,
    )
    .join("");
  const total = widths.reduce((a, w) => a + w, 0);
  return `<w:tbl><w:tblPr><w:tblW w:w="${total}" w:type="dxa"/><w:tblBorders><w:top ${b}/><w:left ${b}/><w:bottom ${b}/><w:right ${b}/><w:insideH ${b}/><w:insideV ${b}/></w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar><w:left w:w="80" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${grid}</w:tblGrid>${head}${body}</w:tbl>`;
}

/**
 * Ba dòng của một bảng lặp: dòng `{{FOR v IN vùng}}`, dòng mẫu, dòng `{{END-FOR v}}`. docx-templates
 * chỉ nhân DÒNG khi FOR và END-FOR nằm ở dòng riêng (hai dòng dấu này bị xóa khi xuất); đặt chung
 * một dòng thì nó nhân Ô.
 */
function loopRows(
  item: string,
  collection: string,
  cells: string[],
): string[][] {
  const blank = cells.slice(1).map(() => "");
  return [
    [`{{FOR ${item} IN ${collection}}}`, ...blank],
    cells,
    [`{{END-FOR ${item}}}`, ...blank],
  ];
}

/** Chia đều chiều rộng nội dung theo tỷ lệ. */
function widthsOf(ratios: number[]): number[] {
  const sum = ratios.reduce((a, r) => a + r, 0);
  return ratios.map((r) => Math.floor((CONTENT_W * r) / sum));
}

function heading(text: string): string {
  return para(text, { style: "Heading1", keepNext: true });
}

function documentXml(t: Messages): string {
  const s = t.reports.sample;
  const d = t.reportsDocx.sample;
  const body: string[] = [];

  body.push(para(s.title, { style: "Title" }));
  body.push(para(s.projectLine, { bold: true, spaceAfter: 40 }));
  body.push(para(s.periodLine, { spaceAfter: 40 }));
  body.push(para(s.generatedLine));

  // 1. Tổng quan (toàn dự án tại lúc xuất).
  body.push(heading(s.overviewHeading));
  body.push(
    table(
      widthsOf([1, 1, 1, 1, 1, 1, 1]),
      [
        s.overview.total,
        s.overview.done,
        s.overview.open,
        s.overview.overdue,
        s.overview.noDue,
        s.overview.blocked,
        s.overview.progress,
      ],
      [
        [
          "{{counts.total}}",
          "{{counts.done}}",
          "{{counts.open}}",
          "{{counts.overdue}}",
          "{{counts.open_no_due}}",
          "{{counts.blocked}}",
          "{{progress.ratio}}",
        ],
      ],
      [0, 1, 2, 3, 4, 5, 6],
    ),
  );

  // 2. Trong kỳ.
  body.push(heading(s.periodHeading));
  body.push(
    table(
      widthsOf([1, 1, 1, 1]),
      [
        s.periodCols.tasks,
        s.periodCols.created,
        s.periodCols.completed,
        s.periodCols.due,
      ],
      [
        [
          "{{period.task_count}}",
          "{{period.created_count}}",
          "{{period.completed_count}}",
          "{{period.due_count}}",
        ],
      ],
      [0, 1, 2, 3],
    ),
  );

  // 3. Theo trạng thái: bảng lặp thứ nhất.
  body.push(heading(s.statusHeading));
  body.push(
    table(
      widthsOf([1, 6, 4, 2, 2]),
      [
        "#",
        s.statusCols.name,
        s.statusCols.group,
        s.statusCols.count,
        s.statusCols.ratio,
      ],
      loopRows("status", "statuses", [
        "{{status.index}}",
        "{{status.name}}",
        "{{status.group}}",
        "{{status.count}}",
        "{{status.ratio}}",
      ]),
      [0, 3, 4],
    ),
  );
  body.push(para("{{empty.statuses}}"));

  // 4. Danh sách task trong kỳ: bảng lặp thứ hai.
  body.push(heading(s.tasksHeading));
  body.push(
    table(
      widthsOf([2, 12, 5, 6, 4, 4, 5, 5]),
      [
        s.taskCols.index,
        s.taskCols.title,
        s.taskCols.status,
        s.taskCols.assignee,
        s.taskCols.priority,
        s.taskCols.due,
        s.taskCols.labels,
        s.taskCols.completed,
      ],
      loopRows("task", "tasks", [
        "{{task.index}}",
        "{{task.title}}",
        "{{task.status}}",
        "{{task.assignee}}",
        "{{task.priority}}",
        "{{task.due_date}}",
        "{{task.labels}}",
        "{{task.completed_at}}",
      ]),
      [0],
    ),
  );
  body.push(para("{{empty.tasks}}"));
  body.push(para(`${s.total}: {{period.task_count}}`, { bold: true }));

  // 5. Theo người phụ trách: bảng lặp thứ ba.
  body.push(heading(d.assigneesHeading));
  body.push(
    table(
      widthsOf([1, 7, 2, 2, 2, 2]),
      [
        "#",
        d.assigneeCols.name,
        d.assigneeCols.total,
        d.assigneeCols.done,
        d.assigneeCols.open,
        d.assigneeCols.overdue,
      ],
      loopRows("assignee", "assignees", [
        "{{assignee.index}}",
        "{{assignee.name}}",
        "{{assignee.total}}",
        "{{assignee.done}}",
        "{{assignee.open}}",
        "{{assignee.overdue}}",
      ]),
      [0, 2, 3, 4, 5],
    ),
  );
  body.push(para("{{empty.assignees}}"));

  // Khối ký tên.
  body.push(para(""));
  body.push(para(d.dateLine, { align: "right", spaceAfter: 40 }));
  body.push(para(s.signature, { align: "right", bold: true, spaceAfter: 900 }));
  body.push(para("{{report.generated_by}}", { align: "right" }));

  const sect = `<w:sectPr><w:footerReference w:type="default" r:id="rId3"/><w:pgSz w:w="${PAGE_W}" w:h="${PAGE_H}" w:orient="landscape"/><w:pgMar w:top="${MARGIN}" w:right="${MARGIN}" w:bottom="${MARGIN}" w:left="${MARGIN}" w:header="425" w:footer="425" w:gutter="0"/></w:sectPr>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document ${W_NS}><w:body>${body.join("")}${sect}</w:body></w:document>`;
}

function footerXml(t: Messages): string {
  const field = (instr: string) =>
    `<w:fldSimple w:instr=" ${instr} "><w:r><w:t>1</w:t></w:r></w:fldSimple>`;
  const p = para(
    [
      run(`{{project.name}} · ${t.reportsDocx.sample.page} `, {
        size: 16,
        color: "5B6170",
      }),
      field("PAGE"),
      run("/", { size: 16, color: "5B6170" }),
      field("NUMPAGES"),
    ],
    { align: "right" },
  );
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:ftr ${W_NS}>${p}</w:ftr>`;
}

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="Arial" w:cs="Arial"/><w:sz w:val="20"/><w:szCs w:val="20"/><w:lang w:val="vi-VN"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="264" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="160"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/><w:szCs w:val="32"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="80"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:color w:val="${ACCENT}"/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr></w:style><w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style></w:styles>`;

const SETTINGS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:defaultTabStop w:val="720"/><w:characterSpacingControl w:val="doNotCompress"/><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>`;

const CONTENT_TYPES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`;

const ROOT_RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`;

const DOC_RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/></Relationships>`;

const APP_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>QLDA</Application></Properties>`;

function coreXml(title: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(title)}</dc:title><dc:creator>QLDA</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${FIXED_ISO}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${FIXED_ISO}</dcterms:modified></cp:coreProperties>`;
}

export function buildSampleDocxTemplate(t: Messages): Buffer {
  return writeZip([
    { name: "[Content_Types].xml", data: CONTENT_TYPES_XML },
    { name: "_rels/.rels", data: ROOT_RELS_XML },
    {
      name: "docProps/core.xml",
      data: coreXml(t.reportsDocx.sample.coreTitle),
    },
    { name: "docProps/app.xml", data: APP_XML },
    { name: "word/document.xml", data: documentXml(t) },
    { name: "word/_rels/document.xml.rels", data: DOC_RELS_XML },
    { name: "word/styles.xml", data: STYLES_XML },
    { name: "word/settings.xml", data: SETTINGS_XML },
    { name: "word/footer1.xml", data: footerXml(t) },
  ]);
}
