import { INTL_LOCALE, type Locale } from "./config";

/** Múi giờ hiển thị mặc định (người dùng nội bộ ở Việt Nam), dùng cho mọi ngôn ngữ. */
export const DISPLAY_TIME_ZONE = "Asia/Ho_Chi_Minh";

/**
 * Bộ định dạng Intl dùng lại theo (loại, ngôn ngữ, múi giờ). Tạo mới Intl.DateTimeFormat mỗi lần gọi
 * tốn thời gian và bộ nhớ ICU ngoài heap: xuất báo cáo docx 2.000 task gọi hàng chục nghìn lần (đo ở
 * QLDA-75: RSS tăng hàng trăm MB). Khóa chỉ gồm giá trị hữu hạn (2 ngôn ngữ, vài múi giờ); trần
 * MAX_CACHED phòng múi giờ lạ.
 */
const MAX_CACHED = 64;
const cache = new Map<string, Intl.DateTimeFormat | Intl.NumberFormat>();

function cached<T extends Intl.DateTimeFormat | Intl.NumberFormat>(
  key: string,
  create: () => T,
): T {
  const hit = cache.get(key);
  if (hit) return hit as T;
  const made = create();
  if (cache.size >= MAX_CACHED) cache.clear();
  cache.set(key, made);
  return made;
}

/**
 * Ngày lịch YYYY-MM-DD → chuỗi theo ngôn ngữ: vi "15/11/2026", en "15 Nov 2026". Không đổi múi
 * giờ (đây là ngày lịch, không phải thời điểm). Sai định dạng: null.
 */
export function formatCalendarDate(
  iso: string | null,
  locale: Locale,
): string | null {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  // Ngày không có thật (31/02) thì Date tự lăn sang tháng sau: coi là sai dạng.
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null;
  }
  return cached(
    `calendar|${locale}`,
    () =>
      new Intl.DateTimeFormat(INTL_LOCALE[locale], {
        timeZone: "UTC",
        day: "2-digit",
        month: locale === "vi" ? "2-digit" : "short",
        year: "numeric",
      }),
  ).format(date);
}

/** Thời điểm → ngày theo ngôn ngữ và múi giờ hiển thị (vi "02/11/2026", en "02 Nov 2026"). */
export function formatDateInZone(
  date: Date,
  locale: Locale,
  timeZone: string = DISPLAY_TIME_ZONE,
): string {
  return cached(
    `date|${locale}|${timeZone}`,
    () =>
      new Intl.DateTimeFormat(INTL_LOCALE[locale], {
        timeZone,
        day: "2-digit",
        month: locale === "vi" ? "2-digit" : "short",
        year: "numeric",
      }),
  ).format(date);
}

/** Giờ:phút 24 giờ theo ngôn ngữ và múi giờ hiển thị. */
export function formatTimeInZone(
  date: Date,
  locale: Locale,
  timeZone: string = DISPLAY_TIME_ZONE,
): string {
  return cached(
    `time|${locale}|${timeZone}`,
    () =>
      new Intl.DateTimeFormat(INTL_LOCALE[locale], {
        timeZone,
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }),
  ).format(date);
}

/** Số nguyên theo ngôn ngữ (vi "1.234", en "1,234"). */
export function formatNumber(value: number, locale: Locale): string {
  return cached(
    `number|${locale}`,
    () => new Intl.NumberFormat(INTL_LOCALE[locale]),
  ).format(value);
}
