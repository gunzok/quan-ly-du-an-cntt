import type { Locale } from "@/lib/i18n/config";
import {
  formatCalendarDate,
  formatDateInZone,
  formatNumber,
  formatTimeInZone,
} from "@/lib/i18n/format";
import type { CellValue } from "./placeholders";

/**
 * Giá trị ô giữ chỗ → chữ đã định dạng theo ngôn ngữ người xuất (vi: `30/11/2026`, `1.234`;
 * en: `30 Nov 2026`, `1,234`). Dùng cho ô giữ chỗ lẫn trong chữ của xlsx (E5-3) và MỌI ô giữ chỗ
 * của docx (E5-4, Word không có ô có kiểu). Ngày giờ theo giờ Việt Nam.
 */
export function formatInline(v: CellValue | null, locale: Locale): string {
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
