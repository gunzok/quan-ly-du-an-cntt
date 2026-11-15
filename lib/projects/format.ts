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

/** YYYY-MM-DD → DD/MM/YYYY (không đổi múi giờ: đây là ngày lịch, không phải thời điểm). */
export function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : null;
}
