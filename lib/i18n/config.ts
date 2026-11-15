/**
 * Cấu hình đa ngôn ngữ (Story E10-2, FR-17, NFR-11). Không đổi URL: ngôn ngữ không nằm trong đường
 * dẫn mà lấy theo thứ tự hồ sơ (profiles.locale) > cookie > Accept-Language > tiếng Việt.
 */
export const LOCALES = ["vi", "en"] as const;

export type Locale = (typeof LOCALES)[number];

/** Ngôn ngữ gốc: từ điển vi là nguồn, en phải có cùng tập khóa. */
export const DEFAULT_LOCALE: Locale = "vi";

/**
 * Cookie lưu lựa chọn của khách (trang /login, /auth/accept-invite) và bản sao lựa chọn của người
 * đã đăng nhập. Chỉ chứa "vi" hoặc "en", không có dữ liệu nhạy cảm; SameSite=Lax.
 */
export const LOCALE_COOKIE = "qlda_locale";

/** Một năm (giây). */
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/** Thẻ BCP 47 cho Intl (định dạng ngày, số). */
export const INTL_LOCALE: Record<Locale, string> = {
  vi: "vi-VN",
  en: "en-GB",
};

export function isLocale(value: unknown): value is Locale {
  return (
    typeof value === "string" && (LOCALES as readonly string[]).includes(value)
  );
}
