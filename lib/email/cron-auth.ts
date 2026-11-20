import { createHash, timingSafeEqual } from "node:crypto";

/** Độ dài tối thiểu của CRON_SECRET (ví dụ `openssl rand -hex 32` cho 64 ký tự). */
export const CRON_SECRET_MIN_LENGTH = 32;

export type CronAuth =
  { ok: true } | { ok: false; reason: "not_configured" | "unauthorized" };

/**
 * Xác thực lời gọi nội bộ (pg_cron/pg_net, Vercel Cron, `make email-dispatch`) bằng header
 * `Authorization: Bearer <CRON_SECRET>`. Không dùng phiên người dùng.
 * - Thiếu hoặc bí mật quá ngắn: `not_configured` (từ chối mọi lời gọi, kể cả không có header).
 * - So khớp thời gian hằng: so băm SHA-256 của hai chuỗi bằng timingSafeEqual (độ dài cố định nên
 *   không lộ độ dài bí mật qua thời gian phản hồi).
 */
export function verifyCronSecret(
  authorization: string | null,
  secret: string | undefined,
): CronAuth {
  if (!secret || secret.length < CRON_SECRET_MIN_LENGTH) {
    return { ok: false, reason: "not_configured" };
  }
  const match = /^Bearer (.+)$/.exec(authorization ?? "");
  const given = createHash("sha256")
    .update(match ? match[1] : "")
    .digest();
  const expected = createHash("sha256").update(secret).digest();
  const equal = timingSafeEqual(given, expected);
  return equal && match ? { ok: true } : { ok: false, reason: "unauthorized" };
}
