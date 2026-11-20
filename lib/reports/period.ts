/**
 * Kỳ báo cáo theo giờ Việt Nam (Story E5-3). Việt Nam không có giờ mùa hè: luôn UTC+7, nên ranh
 * giới ngày tính bằng phép cộng cố định, không cần thư viện múi giờ.
 */

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Ngày lịch hợp lệ dạng YYYY-MM-DD (không nhận 31/02). */
export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const m = DATE_RE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < 2000 || y > 2100) return false;
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

function utcMidnight(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

/** Số ngày của kỳ, tính cả hai đầu (01..30 = 30). */
export function periodDays(start: string, end: string): number {
  return Math.round((utcMidnight(end) - utcMidnight(start)) / DAY_MS) + 1;
}

/**
 * Khoảng thời điểm [from, to) của kỳ: từ 00:00 ngày đầu đến 00:00 ngày SAU ngày cuối, giờ Việt
 * Nam, đổi ra ISO UTC để so với cột timestamptz.
 */
export function periodBounds(
  start: string,
  end: string,
): { from: string; to: string } {
  return {
    from: new Date(utcMidnight(start) - VN_OFFSET_MS).toISOString(),
    to: new Date(utcMidnight(end) + DAY_MS - VN_OFFSET_MS).toISOString(),
  };
}

/** Ngày lịch YYYY-MM-DD theo giờ Việt Nam của một thời điểm. */
export function vnDate(at: Date): string {
  return new Date(at.getTime() + VN_OFFSET_MS).toISOString().slice(0, 10);
}

/** Kỳ mặc định của hộp thoại: tháng hiện tại theo giờ Việt Nam (ngày 1 đến ngày cuối tháng). */
export function currentMonthPeriod(now: Date = new Date()): {
  start: string;
  end: string;
} {
  const today = vnDate(now);
  const [y, m] = today.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const mm = String(m).padStart(2, "0");
  return {
    start: `${y}-${mm}-01`,
    end: `${y}-${mm}-${String(last).padStart(2, "0")}`,
  };
}

/**
 * Thời điểm → Date mà các trường UTC bằng giờ địa phương Việt Nam. Excel không có múi giờ: ô ngày
 * giờ lưu "giờ treo tường", nên ghi giờ Việt Nam để người đọc thấy đúng giờ.
 */
export function vnWallClock(at: Date): Date {
  return new Date(at.getTime() + VN_OFFSET_MS);
}

/** Ngày lịch YYYY-MM-DD → Date 00:00 UTC (ô ngày trong Excel). */
export function calendarDateValue(iso: string): Date {
  return new Date(utcMidnight(iso));
}
