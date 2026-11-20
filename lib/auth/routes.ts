export const LOGIN_PATH = "/login";
export const HOME_PATH = "/";
/** Route Handler đổi mã đăng nhập Google (xem lib/auth/oauth.ts). */
export const AUTH_CALLBACK_PATH = "/auth/callback";
/** Trang nhận lời mời và đặt mật khẩu (Story E1-7, lib/auth/accept-invite.ts). */
export const ACCEPT_INVITE_PATH = "/auth/accept-invite";

const PUBLIC_PATHS: readonly string[] = [
  LOGIN_PATH,
  AUTH_CALLBACK_PATH,
  ACCEPT_INVITE_PATH,
];

/**
 * Trang công khai, không cần đăng nhập: /login, /auth/callback (người dùng chưa có phiên khi
 * Supabase Auth chuyển về sau đăng nhập Google) và /auth/accept-invite (người được mời chưa có
 * phiên). So khớp chính xác, không nhận tiền tố.
 */
export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.includes(pathname);
}

export function isApiPath(pathname: string): boolean {
  return pathname === "/api" || pathname.startsWith("/api/");
}

/**
 * Route Handler nội bộ do máy gọi (pg_cron/pg_net, Vercel Cron), ví dụ /api/internal/email/dispatch
 * (Story E4-2). Không có cookie phiên nên proxy không kiểm Origin hay phiên; handler TỰ xác thực bằng
 * bí mật CRON_SECRET (lib/email/cron-auth.ts) và từ chối khi thiếu cấu hình.
 */
export function isInternalApiPath(pathname: string): boolean {
  return pathname.startsWith("/api/internal/");
}

export type AuthGateDecision =
  | { action: "next" }
  | { action: "redirect"; to: string }
  | { action: "unauthorized" };

/**
 * Quyết định của proxy theo đường dẫn và trạng thái đăng nhập:
 * - chưa đăng nhập, vào trang khác /login: chuyển về /login;
 * - chưa đăng nhập, gọi /api/*: trả 401 (không chuyển hướng API);
 * - đã đăng nhập, vào trang công khai (/login, /auth/callback, /auth/accept-invite): chuyển về /.
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
