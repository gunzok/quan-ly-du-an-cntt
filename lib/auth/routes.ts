export const LOGIN_PATH = "/login";
export const HOME_PATH = "/";
/** Route Handler đổi mã đăng nhập Google (xem lib/auth/oauth.ts). */
export const AUTH_CALLBACK_PATH = "/auth/callback";

/**
 * Trang công khai, không cần đăng nhập: /login và /auth/callback (người dùng chưa có phiên
 * khi Supabase Auth chuyển về sau đăng nhập Google).
 */
export function isPublicPath(pathname: string): boolean {
  return pathname === LOGIN_PATH || pathname === AUTH_CALLBACK_PATH;
}

export function isApiPath(pathname: string): boolean {
  return pathname === "/api" || pathname.startsWith("/api/");
}

export type AuthGateDecision =
  | { action: "next" }
  | { action: "redirect"; to: string }
  | { action: "unauthorized" };

/**
 * Quyết định của proxy theo đường dẫn và trạng thái đăng nhập:
 * - chưa đăng nhập, vào trang khác /login: chuyển về /login;
 * - chưa đăng nhập, gọi /api/*: trả 401 (không chuyển hướng API);
 * - đã đăng nhập, vào /login hoặc /auth/callback: chuyển về /.
 */
export function decideAuthGate(
  pathname: string,
  isAuthenticated: boolean,
): AuthGateDecision {
  if (isAuthenticated) {
    return isPublicPath(pathname)
      ? { action: "redirect", to: HOME_PATH }
      : { action: "next" };
  }
  if (isPublicPath(pathname)) {
    return { action: "next" };
  }
  if (isApiPath(pathname)) {
    return { action: "unauthorized" };
  }
  return { action: "redirect", to: LOGIN_PATH };
}
