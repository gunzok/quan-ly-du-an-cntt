import { describe, expect, it } from "vitest";
import {
  isTheme,
  readThemeCookie,
  themeAttribute,
  themeCookieString,
} from "./theme";

describe("giao diện sáng/tối (E1-7)", () => {
  it("chỉ nhận system, light, dark", () => {
    expect(isTheme("dark")).toBe(true);
    expect(isTheme("system")).toBe(true);
    expect(isTheme("blue")).toBe(false);
    expect(isTheme(null)).toBe(false);
  });

  it("data-theme chỉ đặt cho light/dark; giá trị lạ theo hệ thống", () => {
    expect(themeAttribute("light")).toBe("light");
    expect(themeAttribute("dark")).toBe("dark");
    expect(themeAttribute("system")).toBeUndefined();
    expect(themeAttribute('dark" onload="x')).toBeUndefined();
    expect(themeAttribute(undefined)).toBeUndefined();
  });

  it("cookie: một năm, SameSite=Lax; system xóa cookie", () => {
    expect(themeCookieString("dark", { secure: true })).toBe(
      "qlda_theme=dark; Path=/; Max-Age=31536000; SameSite=Lax; Secure",
    );
    expect(themeCookieString("system", { secure: false })).toBe(
      "qlda_theme=; Path=/; Max-Age=0; SameSite=Lax",
    );
    expect(() => themeCookieString("x" as "dark", { secure: false })).toThrow();
  });

  it("đọc lựa chọn từ document.cookie", () => {
    expect(readThemeCookie("a=1; qlda_theme=light; b=2")).toBe("light");
    expect(readThemeCookie("qlda_theme=evil")).toBe("system");
    expect(readThemeCookie("")).toBe("system");
  });
});
