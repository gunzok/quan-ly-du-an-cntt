/**
 * Giao diện sáng/tối (Story E1-7, FR-17). Lưu ở trình duyệt (cookie), KHÔNG thêm cột vào profiles:
 * đây là tùy chọn theo thiết bị (máy tính bàn sáng, điện thoại tối), không có dữ liệu nhạy cảm.
 * Dùng cookie thay vì localStorage để máy chủ đặt sẵn `<html data-theme>` khi render: không nháy
 * màu lúc tải và không cần script inline (CSP nonce). Vắng cookie = theo hệ thống
 * (prefers-color-scheme, app/globals.css).
 */
export const THEMES = ["system", "light", "dark"] as const;

export type Theme = (typeof THEMES)[number];

export const THEME_COOKIE = "qlda_theme";

/** Một năm (giây), như cookie ngôn ngữ. */
export const THEME_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function isTheme(value: unknown): value is Theme {
  return (
    typeof value === "string" && (THEMES as readonly string[]).includes(value)
  );
}

/** Giá trị cho thuộc tính `data-theme` của `<html>`; undefined = theo hệ thống. */
export function themeAttribute(
  cookieValue: string | undefined | null,
): "light" | "dark" | undefined {
  return cookieValue === "light" || cookieValue === "dark"
    ? cookieValue
    : undefined;
}

/** Chuỗi cookie: "system" xóa cookie (Max-Age=0). */
export function themeCookieString(
  theme: Theme,
  options: { secure: boolean },
): string {
  if (!isTheme(theme)) throw new Error("theme không hợp lệ");
  const keep = theme !== "system";
  return [
    `${THEME_COOKIE}=${keep ? theme : ""}`,
    "Path=/",
    `Max-Age=${keep ? THEME_COOKIE_MAX_AGE : 0}`,
    "SameSite=Lax",
    ...(options.secure ? ["Secure"] : []),
  ].join("; ");
}

/** Đọc lựa chọn hiện tại từ document.cookie (trình duyệt). */
export function readThemeCookie(cookieHeader: string): Theme {
  for (const part of cookieHeader.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === THEME_COOKIE) {
      const value = rest.join("=");
      return value === "light" || value === "dark" ? value : "system";
    }
  }
  return "system";
}

/** Lưu và áp dụng ngay trên trang hiện tại (trình duyệt). */
export function applyTheme(theme: Theme): void {
  document.cookie = themeCookieString(theme, {
    secure: window.location.protocol === "https:",
  });
  const root = document.documentElement;
  const attr = themeAttribute(theme);
  if (attr) root.dataset.theme = attr;
  else delete root.dataset.theme;
}
