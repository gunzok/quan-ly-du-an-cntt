import { strings } from "@/lib/strings";
import type { AdminUser } from "./model";

/** Múi giờ hiển thị mặc định (người dùng nội bộ ở Việt Nam). */
export const DISPLAY_TIME_ZONE = "Asia/Ho_Chi_Minh";

function dayKey(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/** "Hôm nay 08:02", "Hôm qua 17:45", "02/11/2026" hoặc "Chưa đăng nhập". */
export function formatLastSignIn(
  iso: string | null,
  now: Date = new Date(),
  timeZone: string = DISPLAY_TIME_ZONE,
): string {
  if (!iso) {
    return strings.adminUsers.lastSignInNever;
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return strings.adminUsers.lastSignInNever;
  }
  const time = new Intl.DateTimeFormat("vi-VN", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
  const day = dayKey(date, timeZone);
  if (day === dayKey(now, timeZone)) {
    return strings.adminUsers.lastSignInToday(time);
  }
  if (day === dayKey(new Date(now.getTime() - 86_400_000), timeZone)) {
    return strings.adminUsers.lastSignInYesterday(time);
  }
  return new Intl.DateTimeFormat("vi-VN", {
    timeZone,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

/** Tên hiển thị: họ tên, không có thì email. */
export function displayName(user: Pick<AdminUser, "full_name" | "email">) {
  return user.full_name.trim() || user.email || strings.adminUsers.noName;
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
) {
  if (user.is_admin) {
    return strings.adminUsers.projectsAll;
  }
  if (user.project_count === 0) {
    return strings.adminUsers.projectsNone;
  }
  return strings.adminUsers.projectsCount(
    user.project_count,
    user.pm_project_count,
  );
}
