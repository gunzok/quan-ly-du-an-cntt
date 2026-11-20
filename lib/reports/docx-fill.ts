import { randomBytes } from "node:crypto";
import { createReport, listCommands } from "docx-templates";
import type { Locale } from "@/lib/i18n/config";
import { formatInline } from "./inline-format";
import { SECTIONS, type SectionName, type ValueMap } from "./placeholders";

/**
 * Điền dữ liệu vào template docx bằng docx-templates (Story E5-4, ADR-004). Quy ước template:
 * docs/03-design/report-template-docx.md.
 *
 * AN TOÀN (rủi ro chính: template do Admin tải lên). Mặc định docx-templates CHẠY JavaScript viết
 * trong template (`{{= ...}}`, `EXEC`, `IMAGE`, `HTML`, `LINK`...) bằng `node:vm`, mà `vm` không
 * phải ranh giới bảo mật: template có thể đọc tệp, biến môi trường (khóa service_role...). Ở đây
 * KHÔNG BAO GIỜ chạy mã của template:
 *   1. Duyệt trước mọi lệnh (`listCommands`): chỉ cho phép ô giữ chỗ (`{{khóa.con}}`, chèn chữ),
 *      `{{FOR x IN tasks|statuses|assignees}}` và `{{END-FOR x}}`. Lệnh khác (EXEC, `!`, IMAGE,
 *      LINK, HTML, ALIAS, `*`, QUERY, IF) hoặc biểu thức không phải đường dẫn khóa: từ chối cả
 *      template (UnsafeTemplateError), không xuất gì.
 *   2. Tùy chọn `runJs` thay hẳn bộ chạy JS của thư viện bằng bộ TRA KHÓA: chỉ nhận chuỗi dạng
 *      `a.b.c` (chữ thường, số, gạch dưới), tra trên đối tượng không prototype do ứng dụng dựng
 *      (`Object.hasOwn`), không gọi hàm, không đọc `process`, `globalThis`, `constructor`...
 *      Biểu thức khác vẫn bị từ chối (phòng khi bước 1 bị lách).
 *   3. Dấu chèn XML thô (`literalXmlDelimiter`, mặc định `||`) đổi thành chuỗi ngẫu nhiên mỗi lần
 *      xuất, nên chữ người dùng nhập (tiêu đề task có `||<w:...>||`) không chèn được XML.
 * Giá trị là chữ đã định dạng theo ngôn ngữ người xuất (Word không có ô có kiểu như Excel).
 */

export interface DocxFillOptions {
  locale: Locale;
  /** Chữ của `{{empty.tasks}}`... khi vùng lặp không có phần tử nào. */
  emptyText: Record<SectionName, string>;
}

export interface DocxFillInput {
  scalars: ValueMap;
  sections: Record<SectionName, ValueMap[]>;
}

export const DOCX_DELIMITERS: [string, string] = ["{{", "}}"];

/** Template dùng lệnh hoặc biểu thức không được phép (có thể là mã độc). */
export class UnsafeTemplateError extends Error {
  constructor(readonly command: string) {
    super(`unsafe template command: ${command.slice(0, 80)}`);
    this.name = "UnsafeTemplateError";
  }
}

/** Template sai cú pháp theo quy ước (không phải mã độc): FOR sai vùng, chèn cả vùng lặp... */
export class TemplateSyntaxError extends Error {
  constructor(readonly command: string) {
    super(`template syntax: ${command.slice(0, 80)}`);
    this.name = "TemplateSyntaxError";
  }
}

const SEGMENT = "[a-z_][a-z0-9_]*";
const PATH_RE = new RegExp(`^\\$?${SEGMENT}(?:\\.${SEGMENT})*$`);
const FOR_RE = new RegExp(`^(${SEGMENT})\\s+IN\\s+(${SEGMENT})$`, "i");
const FORBIDDEN_SEGMENTS = new Set(["__proto__", "constructor", "prototype"]);
const COLLECTIONS = Object.keys(SECTIONS) as SectionName[];

/** Đối tượng tra khóa: không prototype, chỉ có thuộc tính riêng. */
type Bag = { [key: string]: string | Bag | Bag[] };

function bag(): Bag {
  return Object.create(null) as Bag;
}

function setPath(root: Bag, path: string, value: string) {
  const parts = path.split(".");
  let cur = root;
  for (const part of parts.slice(0, -1)) {
    const next = Object.hasOwn(cur, part) ? cur[part] : undefined;
    if (next && typeof next === "object" && !Array.isArray(next)) cur = next;
    else {
      const created = bag();
      cur[part] = created;
      cur = created;
    }
  }
  cur[parts[parts.length - 1]] = value;
}

/** ValueMap dạng `{"task.title": ...}` → `{ title: "..." }` (bỏ tiền tố vùng). */
function itemBag(values: ValueMap, prefix: string, locale: Locale): Bag {
  const item = bag();
  for (const [key, v] of Object.entries(values)) {
    const field = key.startsWith(`${prefix}.`)
      ? key.slice(prefix.length + 1)
      : key;
    setPath(item, field, formatInline(v, locale));
  }
  return item;
}

/** Dữ liệu tra khóa cho template: chữ đã định dạng, mảng cho vùng lặp. */
export function buildDocxData(
  input: DocxFillInput,
  options: DocxFillOptions,
): Bag {
  const root = bag();
  for (const [key, v] of Object.entries(input.scalars)) {
    setPath(root, key, formatInline(v, options.locale));
  }
  for (const name of COLLECTIONS) {
    const items = input.sections[name];
    root[name] = items.map((values) =>
      itemBag(values, SECTIONS[name], options.locale),
    );
    setPath(
      root,
      `empty.${name}`,
      items.length === 0 ? options.emptyText[name] : "",
    );
  }
  return root;
}

function isPath(code: string): boolean {
  return (
    PATH_RE.test(code) &&
    !code
      .replace(/^\$/, "")
      .split(".")
      .some((s) => FORBIDDEN_SEGMENTS.has(s))
  );
}

/**
 * Duyệt mọi lệnh của template (thân, đầu trang, chân trang...) trước khi điền. Không chạy gì.
 * Ném UnsafeTemplateError (lệnh/biểu thức cấm) hoặc TemplateSyntaxError (sai quy ước).
 */
export async function checkDocxTemplateCommands(
  template: Uint8Array,
): Promise<void> {
  const commands = await listCommands(
    template as unknown as ArrayBuffer,
    DOCX_DELIMITERS,
  );
  for (const { type, code, raw } of commands) {
    const c = code.trim();
    switch (type) {
      case "INS":
        if (!isPath(c)) throw new UnsafeTemplateError(raw);
        if ((COLLECTIONS as string[]).includes(c)) {
          throw new TemplateSyntaxError(raw);
        }
        break;
      case "FOR": {
        const m = FOR_RE.exec(c);
        if (!m) throw new UnsafeTemplateError(raw);
        if (!(COLLECTIONS as string[]).includes(m[2])) {
          throw new TemplateSyntaxError(raw);
        }
        break;
      }
      case "END-FOR":
        if (!new RegExp(`^${SEGMENT}$`).test(c)) {
          throw new UnsafeTemplateError(raw);
        }
        break;
      default:
        throw new UnsafeTemplateError(raw);
    }
  }
}

/** Tra một đường dẫn khóa; null nếu không có. Biến vòng lặp `task` (hay `$task`) ưu tiên. */
function resolvePath(
  code: string,
  root: Bag,
  sandbox: Record<string, unknown>,
): string | Bag | Bag[] | null {
  const parts = code.replace(/^\$/, "").split(".");
  let cur: unknown;
  const loopKey = `$${parts[0]}`;
  if (Object.hasOwn(sandbox, loopKey)) {
    cur = sandbox[loopKey];
  } else if (code.startsWith("$")) {
    return null;
  } else {
    cur = Object.hasOwn(root, parts[0]) ? root[parts[0]] : null;
  }
  for (const part of parts.slice(1)) {
    if (
      cur === null ||
      typeof cur !== "object" ||
      Array.isArray(cur) ||
      Object.getPrototypeOf(cur) !== null ||
      !Object.hasOwn(cur, part)
    ) {
      return null;
    }
    cur = (cur as Bag)[part];
  }
  if (typeof cur === "string") return cur;
  if (Array.isArray(cur)) return cur as Bag[];
  if (cur && typeof cur === "object" && Object.getPrototypeOf(cur) === null) {
    return cur as Bag;
  }
  return null;
}

export async function fillDocxTemplate(
  template: Uint8Array,
  input: DocxFillInput,
  options: DocxFillOptions,
): Promise<Buffer> {
  await checkDocxTemplateCommands(template);
  const root = buildDocxData(input, options);
  let unsafe: string | null = null;
  const totalRows = COLLECTIONS.reduce(
    (n, name) => n + input.sections[name].length,
    0,
  );
  let out: Uint8Array;
  try {
    out = await createReport({
      template,
      data: {},
      cmdDelimiter: DOCX_DELIMITERS,
      literalXmlDelimiter: `␟${randomBytes(16).toString("hex")}␟`,
      processLineBreaks: true,
      noSandbox: false,
      failFast: true,
      rejectNullish: false,
      // Chống vòng lặp vô hạn: trần theo số dòng thật (mỗi dòng lặp duyệt vài trăm nút).
      maximumWalkingDepth: 1_000_000 + totalRows * 2_000,
      indentXml: false,
      runJs: ({ sandbox }) => {
        const code = String(sandbox.__code__ ?? "").trim();
        if (!isPath(code)) {
          unsafe = code;
          throw new UnsafeTemplateError(code);
        }
        const value = resolvePath(code, root, sandbox);
        let result: unknown;
        if (Array.isArray(value)) {
          // Chỉ vùng lặp (tên vùng ở gốc) trả mảng; FOR cần mảng.
          result = value;
        } else if (typeof value === "string") {
          result = value;
        } else {
          // Khóa sai chính tả: giữ nguyên trong tệp để người soạn thấy và sửa.
          result = `${DOCX_DELIMITERS[0]}${code}${DOCX_DELIMITERS[1]}`;
        }
        return {
          modifiedSandbox: { __code__: undefined, __result__: undefined },
          result,
        };
      },
    });
  } catch (error) {
    if (unsafe !== null) throw new UnsafeTemplateError(unsafe);
    throw error;
  }
  return Buffer.from(out);
}
