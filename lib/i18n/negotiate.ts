import { DEFAULT_LOCALE, isLocale, type Locale } from "./config";

/** Nguồn quyết định ngôn ngữ của request (để bộ chọn biết lưu vào đâu). */
export type LocaleSource = "profile" | "cookie" | "header" | "default";

export interface LocaleInputs {
  /** profiles.locale của người đang đăng nhập; null khi là khách. */
  profileLocale?: string | null;
  /** Giá trị cookie LOCALE_COOKIE. */
  cookieLocale?: string | null;
  /** Header Accept-Language của trình duyệt. */
  acceptLanguage?: string | null;
}

/**
 * Chọn ngôn ngữ giao diện từ Accept-Language (RFC 9110 mục 12.5.4): xếp theo q giảm dần,
 * so phần ngôn ngữ chính (en-US → en). Không khớp ngôn ngữ nào hỗ trợ: null.
 */
export function matchAcceptLanguage(
  header: string | null | undefined,
): Locale | null {
  if (!header) return null;
  const ranges = header
    .slice(0, 1024)
    .split(",")
    .map((part, index) => {
      const [tag, ...params] = part.trim().split(";");
      let q = 1;
      for (const param of params) {
        const [key, value] = param.trim().split("=");
        if (key === "q") {
          const parsed = Number(value);
          q = Number.isFinite(parsed) ? parsed : 0;
        }
      }
      return { tag: tag.trim().toLowerCase(), q, index };
    })
    .filter((r) => r.tag !== "" && r.q > 0)
    .sort((a, b) => b.q - a.q || a.index - b.index);
  for (const { tag } of ranges) {
    const primary = tag.split("-")[0];
    if (isLocale(primary)) return primary;
    if (tag === "*") return DEFAULT_LOCALE;
  }
  return null;
}

/** Thứ tự ưu tiên: hồ sơ > cookie > Accept-Language > tiếng Việt. Giá trị lạ bị bỏ qua. */
export function resolveLocale(inputs: LocaleInputs): {
  locale: Locale;
  source: LocaleSource;
} {
  if (isLocale(inputs.profileLocale)) {
    return { locale: inputs.profileLocale, source: "profile" };
  }
  if (isLocale(inputs.cookieLocale)) {
    return { locale: inputs.cookieLocale, source: "cookie" };
  }
  const fromHeader = matchAcceptLanguage(inputs.acceptLanguage);
  if (fromHeader) return { locale: fromHeader, source: "header" };
  return { locale: DEFAULT_LOCALE, source: "default" };
}
