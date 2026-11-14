/**
 * Ghép tên class, bỏ giá trị rỗng. Không cài clsx/tailwind-merge (ADR-005: chỉ thêm gói thật sự
 * cần): class truyền thêm qua `className` được nối SAU class mặc định và không tự gộp xung đột,
 * nên khi cần ghi đè một thuộc tính hãy dùng utility khác nhóm hoặc tiền tố `!`.
 */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
