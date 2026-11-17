import type { RateLimitRule } from "./rate-limit";

/**
 * Nới giới hạn đăng nhập theo IP CHỈ khi chạy e2e trên stack cục bộ (QLDA-43).
 *
 * Vì sao: ngoài Vercel, máy chủ không tin header IP (xem clientIp), nên mọi lần đăng nhập của bộ
 * e2e rơi vào cùng nhóm `ip:unknown` với ngưỡng thật 50 lượt / 5 phút. Bộ e2e (~60 test, mỗi test
 * đăng nhập qua /login) vượt ngưỡng → trang báo "Bạn thử quá nhiều lần" và test đỏ hàng loạt.
 *
 * An toàn: chỉ bật khi ĐỦ cả ba điều kiện, thiếu một là dùng ngưỡng thật:
 *   1. E2E_RELAXED_LOGIN_RATE_LIMIT === "1" (chỉ `make test-e2e` đặt);
 *   2. không có dấu hiệu Vercel (VERCEL, VERCEL_ENV, VERCEL_URL): production, preview và mọi bản
 *      dựng trên Vercel không bao giờ bật được, kể cả khi ai đó lỡ đặt cờ ở đó;
 *   3. NEXT_PUBLIC_SUPABASE_URL trỏ tới Supabase cục bộ (http://127.0.0.1 hoặc http://localhost).
 * Chỉ nới loginIp; loginEmail (chống dò mật khẩu một tài khoản), acceptInviteIp và api giữ nguyên.
 */
export const E2E_RELAXED_LOGIN_ENV = "E2E_RELAXED_LOGIN_RATE_LIMIT";

/** Ngưỡng loginIp khi chạy e2e cục bộ: đủ rộng cho cả bộ, vẫn có giới hạn. */
export const E2E_LOGIN_IP_RULE: RateLimitRule = {
  limit: 1000,
  windowSeconds: 300,
};

const LOCAL_SUPABASE_URL =
  /^http:\/\/(127\.0\.0\.1|localhost)(:\d{1,5})?(\/|$)/;

export function isE2eRelaxedLoginRateLimit(
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (env[E2E_RELAXED_LOGIN_ENV] !== "1") return false;
  if (env.VERCEL || env.VERCEL_ENV || env.VERCEL_URL) return false;
  return LOCAL_SUPABASE_URL.test(env.NEXT_PUBLIC_SUPABASE_URL ?? "");
}
