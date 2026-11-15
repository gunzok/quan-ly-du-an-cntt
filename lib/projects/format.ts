import { DEFAULT_LOCALE, type Locale } from "@/lib/i18n/config";
import { formatCalendarDate } from "@/lib/i18n/format";

/** Định dạng ngày cho dự án. Ranh giới ngày theo giờ Việt Nam (người dùng nội bộ ở Việt Nam). */
export const PROJECT_TIME_ZONE = "Asia/Ho_Chi_Minh";

/** Ngày hôm nay dạng YYYY-MM-DD theo múi giờ cho trước (mặc định giờ Việt Nam). */
export function todayIso(
  now: Date = new Date(),
  timeZone: string = PROJECT_TIME_ZONE,
): string {
  // en-CA cho dạng YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/**
 * YYYY-MM-DD → ngày theo ngôn ngữ: vi "15/01/2027", en "15 Jan 2027" (không đổi múi giờ: đây là
 * ngày lịch, không phải thời điểm). Sai dạng: null.
 */
export function formatDate(
  iso: string | null,
  locale: Locale = DEFAULT_LOCALE,
): string | null {
  return formatCalendarDate(iso, locale);
}
