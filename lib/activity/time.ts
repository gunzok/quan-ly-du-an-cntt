/**
 * Ngày theo giờ Việt Nam cho nhật ký (Story E6-2). Asia/Ho_Chi_Minh là UTC+7 cố định (không có giờ
 * mùa hè) nên ranh giới ngày tính bằng phép cộng, chạy giống nhau ở máy chủ và trình duyệt bất kể
 * múi giờ của máy. Hiển thị giờ vẫn qua lib/i18n/format (DISPLAY_TIME_ZONE).
 */

/** Độ lệch của Asia/Ho_Chi_Minh so với UTC, tính bằng phút. */
const VN_OFFSET_MINUTES = 7 * 60;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Cộng `days` ngày vào ngày lịch YYYY-MM-DD (đã kiểm hợp lệ). */
export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Thời điểm bắt đầu ngày `isoDate` theo giờ Việt Nam, dạng ISO UTC.
 * Ví dụ 2026-11-17 → 2026-11-16T17:00:00.000Z.
 */
export function vnDayStartUtc(isoDate: string): string {
  const utcMidnight = Date.parse(`${isoDate}T00:00:00Z`);
  return new Date(utcMidnight - VN_OFFSET_MINUTES * 60 * 1000).toISOString();
}

/**
 * Khoảng [from, to] ngày lịch Việt Nam (tính cả hai đầu) → nửa khoảng UTC [gte, lt).
 * Thiếu đầu nào thì đầu đó null (không giới hạn).
 */
export function vnDateRangeToUtc(
  from: string | null,
  to: string | null,
): { gte: string | null; lt: string | null } {
  return {
    gte: from ? vnDayStartUtc(from) : null,
    lt: to ? vnDayStartUtc(addDays(to, 1)) : null,
  };
}

/** Ngày lịch Việt Nam (YYYY-MM-DD) của một thời điểm. */
export function vnDateOf(instant: Date | string): string {
  const ms =
    typeof instant === "string" ? Date.parse(instant) : instant.getTime();
  return new Date(ms + VN_OFFSET_MINUTES * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}

/** Số ngày giữa hai ngày lịch (b - a). */
export function daysBetween(a: string, b: string): number {
  return Math.round(
    (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS,
  );
}

/** Nhóm các phần tử (đã sắp mới nhất trước) theo ngày lịch Việt Nam, giữ thứ tự. */
export function groupByVnDay<T extends { created_at: string }>(
  items: readonly T[],
): { day: string; items: T[] }[] {
  const groups: { day: string; items: T[] }[] = [];
  for (const item of items) {
    const day = vnDateOf(item.created_at);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.items.push(item);
    else groups.push({ day, items: [item] });
  }
  return groups;
}
