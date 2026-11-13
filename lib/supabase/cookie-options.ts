import type { CookieOptionsWithName } from "@supabase/ssr";

/**
 * Tùy chọn cookie phiên (STRIDE F1, Story E1-1 tiêu chí 1).
 * @supabase/ssr mặc định httpOnly=false để client trình duyệt đọc được phiên; dự án đăng nhập,
 * làm mới và đăng xuất hoàn toàn ở máy chủ (Server Action, proxy) nên bật httpOnly để
 * JavaScript trên trang không đọc được token. Secure khi chạy production (HTTPS).
 * Mọi client phía máy chủ PHẢI dùng chung tùy chọn này, kể cả khi làm mới phiên.
 */
export function sessionCookieOptions(
  nodeEnv: string | undefined = process.env.NODE_ENV,
): CookieOptionsWithName {
  return {
    path: "/",
    sameSite: "lax",
    httpOnly: true,
    secure: nodeEnv === "production",
  };
}
