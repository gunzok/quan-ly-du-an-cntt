/**
 * Làm sạch dữ liệu đưa vào email (security.md: chống chèn header và HTML). Tên task, tên dự án, tên
 * người là dữ liệu người dùng nhập: luôn đi qua `singleLine` (bỏ ký tự điều khiển, xuống dòng) và
 * `escapeHtml` trước khi vào HTML; không bao giờ ghép thô vào HTML hay tiêu đề.
 */

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch]);
}

// Ký tự điều khiển C0/C1, DEL, phân cách dòng/đoạn Unicode, ký tự định hướng (bidi) dễ dùng để
// đánh lừa hiển thị.
const CONTROL_CLASS =
  "[\\u0000-\\u001f\\u007f-\\u009f\\u2028\\u2029\\u202a-\\u202e\\u2066-\\u2069]";
const CONTROL_ALL = new RegExp(CONTROL_CLASS, "g");
const HAS_CONTROL = new RegExp(CONTROL_CLASS);

/**
 * Một dòng an toàn cho tiêu đề và nội dung: ký tự điều khiển (kể cả CR, LF) thành khoảng trắng, gộp
 * khoảng trắng, cắt tối đa `max` ký tự (kể cả "…").
 */
export function singleLine(value: string, max: number): string {
  const clean = value.replace(CONTROL_ALL, " ").replace(/\s+/g, " ").trim();
  const chars = Array.from(clean);
  if (chars.length <= max) return clean;
  return `${chars
    .slice(0, Math.max(max - 1, 0))
    .join("")
    .trimEnd()}…`;
}

const EMAIL_PATTERN =
  /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]+$/;

/** Địa chỉ email đơn giản, không khoảng trắng, không ký tự điều khiển, ≤ 254 ký tự. */
export function isSafeEmailAddress(value: string): boolean {
  return (
    value.length <= 254 && !HAS_CONTROL.test(value) && EMAIL_PATTERN.test(value)
  );
}

/**
 * Đọc "Tên <dia-chi@mien>" hoặc "dia-chi@mien" (biến EMAIL_FROM). Sai định dạng, có xuống dòng hay
 * ký tự điều khiển: null.
 */
export function parseMailbox(
  value: string,
): { address: string; name?: string } | null {
  if (HAS_CONTROL.test(value)) {
    return null;
  }
  const trimmed = value.trim();
  const match = /^(.*)<([^<>]+)>$/.exec(trimmed);
  if (match) {
    const name = match[1].trim().replace(/^"(.*)"$/, "$1");
    const address = match[2].trim();
    if (!isSafeEmailAddress(address) || /[<>"]/.test(name)) return null;
    return name ? { address, name } : { address };
  }
  return isSafeEmailAddress(trimmed) ? { address: trimmed } : null;
}
