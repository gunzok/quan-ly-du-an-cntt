import type { Locale } from "@/lib/i18n/config";
import {
  DISPLAY_TIME_ZONE,
  formatDateInZone,
  formatTimeInZone,
} from "@/lib/i18n/format";
import type { Messages } from "@/lib/i18n/messages";
import type { AdminUser } from "./model";

/** Múi giờ hiển thị mặc định (người dùng nội bộ ở Việt Nam). */
export { DISPLAY_TIME_ZONE };

type AdminUserStrings = Messages["adminUsers"];

function dayKey(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/**
 * vi: "Hôm nay 08:02", "Hôm qua 17:45", "02/11/2026", "Chưa đăng nhập";
 * en: "Today 08:02", "Yesterday 17:45", "02 Nov 2026", "Never signed in".
 */
export function formatLastSignIn(
  iso: string | null,
  i18n: { t: AdminUserStrings; locale: Locale },
  now: Date = new Date(),
  timeZone: string = DISPLAY_TIME_ZONE,
): string {
  const { t, locale } = i18n;
  if (!iso) {
    return t.lastSignInNever;
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return t.lastSignInNever;
  }
  const time = formatTimeInZone(date, locale, timeZone);
  const day = dayKey(date, timeZone);
  if (day === dayKey(now, timeZone)) {
    return t.lastSignInToday(time);
  }
  if (day === dayKey(new Date(now.getTime() - 86_400_000), timeZone)) {
    return t.lastSignInYesterday(time);
  }
  return formatDateInZone(date, locale, timeZone);
}

/** Tên hiển thị: họ tên, không có thì email. */
export function displayName(
  user: Pick<AdminUser, "full_name" | "email">,
  t: AdminUserStrings,
) {
  return user.full_name.trim() || user.email || t.noName;
}

/** Hai chữ cái đầu cho ảnh đại diện: "Nguyễn Minh Anh" → "MA" (họ ở đầu theo kiểu Việt). */
export function initials(user: Pick<AdminUser, "full_name" | "email">) {
  const words = user.full_name.trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    return (
      words[words.length - 2][0] + words[words.length - 1][0]
    ).toUpperCase();
  }
  const source = words[0] ?? user.email ?? "?";
  return source.slice(0, 2).toUpperCase();
}

export function projectSummary(
  user: Pick<AdminUser, "is_admin" | "project_count" | "pm_project_count">,
  t: AdminUserStrings,
) {
  if (user.is_admin) {
    return t.projectsAll;
  }
  if (user.project_count === 0) {
    return t.projectsNone;
  }
  return t.projectsCount(user.project_count, user.pm_project_count);
}
