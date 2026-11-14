/**
 * Chữ cái đầu cho Avatar: tên tiếng Việt "Nguyễn Văn An" -> "NA" (họ + tên gọi), một từ -> 1 chữ.
 * Giữ dấu tiếng Việt, viết hoa theo locale vi.
 */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return "?";
  }
  const first = Array.from(words[0])[0] ?? "";
  if (words.length === 1) {
    return first.toLocaleUpperCase("vi");
  }
  const last = Array.from(words[words.length - 1])[0] ?? "";
  return `${first}${last}`.toLocaleUpperCase("vi");
}
