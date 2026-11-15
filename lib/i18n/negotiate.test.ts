import { describe, expect, it } from "vitest";
import { isLocale } from "./config";
import { localeCookieHeader } from "./cookie";
import { formatCalendarDate, formatNumber } from "./format";
import { matchAcceptLanguage, resolveLocale } from "./negotiate";

describe("matchAcceptLanguage", () => {
  it("xếp theo q, so ngôn ngữ chính, bỏ ngôn ngữ không hỗ trợ", () => {
    expect(matchAcceptLanguage("en-US,en;q=0.9")).toBe("en");
    expect(matchAcceptLanguage("vi-VN,vi;q=0.9,en;q=0.8")).toBe("vi");
    expect(matchAcceptLanguage("fr-FR,fr;q=0.9,en;q=0.5,vi;q=0.7")).toBe("vi");
    expect(matchAcceptLanguage("vi;q=0.2, EN-gb;q=0.8")).toBe("en");
    expect(matchAcceptLanguage("fr,de")).toBeNull();
    expect(matchAcceptLanguage("en;q=0")).toBeNull();
    expect(matchAcceptLanguage("*")).toBe("vi");
    expect(matchAcceptLanguage("")).toBeNull();
    expect(matchAcceptLanguage(null)).toBeNull();
    expect(matchAcceptLanguage("en;q=abc, vi")).toBe("vi");
  });
});

describe("resolveLocale: hồ sơ > cookie > Accept-Language > vi", () => {
  it("hồ sơ thắng cookie và header", () => {
    expect(
      resolveLocale({
        profileLocale: "en",
        cookieLocale: "vi",
        acceptLanguage: "vi",
      }),
    ).toEqual({ locale: "en", source: "profile" });
    expect(resolveLocale({ profileLocale: "vi", cookieLocale: "en" })).toEqual({
      locale: "vi",
      source: "profile",
    });
  });

  it("khách: cookie thắng header; không có cookie thì theo header; không gì cả thì vi", () => {
    expect(
      resolveLocale({ cookieLocale: "en", acceptLanguage: "vi-VN" }),
    ).toEqual({ locale: "en", source: "cookie" });
    expect(resolveLocale({ acceptLanguage: "en-US" })).toEqual({
      locale: "en",
      source: "header",
    });
    expect(resolveLocale({ acceptLanguage: "ja" })).toEqual({
      locale: "vi",
      source: "default",
    });
    expect(resolveLocale({})).toEqual({ locale: "vi", source: "default" });
  });

  it("giá trị lạ ở hồ sơ, cookie bị bỏ qua", () => {
    expect(
      resolveLocale({
        profileLocale: "fr",
        cookieLocale: "<script>",
        acceptLanguage: "en",
      }),
    ).toEqual({ locale: "en", source: "header" });
    expect(isLocale("EN")).toBe(false);
  });
});

describe("cookie và định dạng theo ngôn ngữ", () => {
  it("cookie chỉ chứa mã ngôn ngữ, SameSite=Lax, Secure khi HTTPS", () => {
    expect(localeCookieHeader("en", { secure: false })).toBe(
      "qlda_locale=en; Path=/; Max-Age=31536000; SameSite=Lax",
    );
    expect(localeCookieHeader("vi", { secure: true })).toMatch(/; Secure$/);
    expect(() => localeCookieHeader("fr" as "vi", { secure: false })).toThrow();
  });

  it("ngày lịch và số theo Intl", () => {
    expect(formatCalendarDate("2026-11-05", "vi")).toBe("05/11/2026");
    expect(formatCalendarDate("2026-11-05", "en")).toBe("05 Nov 2026");
    expect(formatCalendarDate("2026-13-05", "en")).toBeNull();
    expect(formatNumber(1234567, "vi")).toBe("1.234.567");
    expect(formatNumber(1234567, "en")).toBe("1,234,567");
  });
});
