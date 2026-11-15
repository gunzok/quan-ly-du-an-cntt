import {
  isLocale,
  LOCALE_COOKIE,
  LOCALE_COOKIE_MAX_AGE,
  type Locale,
} from "./config";

/**
 * Cookie ngôn ngữ: chỉ "vi"/"en", Path=/, SameSite=Lax, một năm; Secure khi chạy HTTPS. Không
 * httpOnly: khách (chưa đăng nhập) đổi ngôn ngữ ngay trên trình duyệt, cookie không chứa gì nhạy cảm.
 */
export function localeCookieHeader(
  locale: Locale,
  options: { secure: boolean },
): string {
  if (!isLocale(locale)) throw new Error("locale không hợp lệ");
  return [
    `${LOCALE_COOKIE}=${locale}`,
    "Path=/",
    `Max-Age=${LOCALE_COOKIE_MAX_AGE}`,
    "SameSite=Lax",
    ...(options.secure ? ["Secure"] : []),
  ].join("; ");
}

/** Ghi cookie ngôn ngữ từ trình duyệt (khách). */
export function writeLocaleCookie(locale: Locale): void {
  document.cookie = localeCookieHeader(locale, {
    secure: window.location.protocol === "https:",
  });
}
