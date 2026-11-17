import { INTL_LOCALE, type Locale } from "@/lib/i18n/config";
import {
  DISPLAY_TIME_ZONE,
  formatDateInZone,
  formatTimeInZone,
} from "@/lib/i18n/format";
import type { Messages } from "@/lib/i18n/messages";
import type { Notification } from "./model";

/** Ngày lịch YYYY-MM-DD của một thời điểm theo múi giờ hiển thị. */
function dayKey(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/**
 * Thời điểm thông báo như mockup S16: "Hôm nay 09:12", "Hôm qua 17:45", "12/11 11:00" (cùng năm),
 * "02/11/2025" (năm khác). Tính theo giờ Việt Nam (DISPLAY_TIME_ZONE).
 */
export function formatNotificationTime(
  iso: string,
  now: Date,
  locale: Locale,
  t: Messages["notifications"],
  timeZone: string = DISPLAY_TIME_ZONE,
): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const time = formatTimeInZone(date, locale, timeZone);
  const day = dayKey(date, timeZone);
  if (day === dayKey(now, timeZone)) return t.today(time);
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  if (day === dayKey(yesterday, timeZone)) return t.yesterday(time);
  if (day.slice(0, 4) === dayKey(now, timeZone).slice(0, 4)) {
    // Tự ghép từ các phần: vi-VN chỉ có ngày/tháng thì Intl in "12-11", mockup dùng "12/11".
    const parts = new Intl.DateTimeFormat(INTL_LOCALE[locale], {
      timeZone,
      day: "2-digit",
      month: locale === "vi" ? "2-digit" : "short",
    }).formatToParts(date);
    const part = (type: string) =>
      parts.find((x) => x.type === type)?.value ?? "";
    const dm =
      locale === "vi"
        ? `${part("day")}/${part("month")}`
        : `${part("day")} ${part("month")}`;
    return `${dm} ${time}`;
  }
  return formatDateInZone(date, locale, timeZone);
}

/** Câu hiển thị của một thông báo; bản trung tính khi người nhận không còn đọc được task. */
export function notificationText(
  n: Pick<
    Notification,
    "type" | "task_visible" | "title" | "status_name" | "actor"
  >,
  t: Messages["notifications"],
): string {
  if (!n.task_visible || !n.title) {
    return n.type === "task_assigned"
      ? t.hiddenAssigned
      : t.hiddenStatusChanged;
  }
  const actor = n.actor ? n.actor.full_name || t.someone : null;
  if (n.type === "task_assigned") {
    return actor ? t.assigned(actor, n.title) : t.assignedNoActor(n.title);
  }
  const status = n.status_name ?? "";
  return actor
    ? t.statusChanged(actor, n.title, status)
    : t.statusChangedNoActor(n.title, status);
}

/** Nhãn huy hiệu chuông: 1..99, trên 99 là "99+"; 0 thì không hiện. */
export function badgeLabel(count: number, overflow: string): string | null {
  if (count <= 0) return null;
  return count > 99 ? overflow : String(count);
}
