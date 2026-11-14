import type { ApiError } from "@/lib/api/errors";
import {
  consumeRateLimits,
  logRateLimitUnavailable,
  type RateLimitCheck,
  type RateLimitOutcome,
} from "@/lib/api/rate-limit";
import { strings } from "@/lib/strings";
import { EMAIL_MAX_LENGTH } from "./validate";

/**
 * Giới hạn số lần thử đăng nhập (Story E0-5), gọi ở Server Action signIn và signInWithGoogle
 * TRƯỚC khi gọi Supabase Auth. Mọi lần thử đều bị đếm (kể cả thành công), theo:
 *   - IP (cả đăng nhập mật khẩu và Google): RATE_LIMITS.loginIp;
 *   - email đã chuẩn hóa (chỉ đăng nhập mật khẩu): RATE_LIMITS.loginEmail.
 * Không xác định được IP (ngoài Vercel) thì dùng chung nhóm "unknown".
 *
 * FAIL-CLOSED: bộ đếm lỗi (CSDL lỗi, thiếu khóa service_role) thì TỪ CHỐI đăng nhập, vì
 * (1) nếu không, ai làm bộ đếm lỗi được là dò mật khẩu không giới hạn; (2) bộ đếm và Supabase Auth
 * dùng chung một dự án Supabase, CSDL lỗi thì đăng nhập thường cũng đã lỗi, mất ít khả dụng.
 */
export interface LoginAttempt {
  ip: string | null;
  /** Email thô từ form (password) hoặc null (Google). */
  email?: unknown;
}

/** Chuẩn hóa như validateLoginInput: cắt khoảng trắng, chữ thường. Rỗng hoặc quá dài: null. */
export function normalizeLoginEmail(email: unknown): string | null {
  if (typeof email !== "string") {
    return null;
  }
  const value = email.trim().toLowerCase();
  if (value.length === 0 || value.length > EMAIL_MAX_LENGTH) {
    return null;
  }
  return value;
}

export function loginRateLimitChecks(attempt: LoginAttempt): RateLimitCheck[] {
  const checks: RateLimitCheck[] = [
    { name: "loginIp", identifier: `ip:${attempt.ip ?? "unknown"}` },
  ];
  const email = normalizeLoginEmail(attempt.email);
  if (email) {
    checks.push({ name: "loginEmail", identifier: `email:${email}` });
  }
  return checks;
}

export type LoginGate = { ok: true } | { ok: false; error: ApiError };

/** Đổi kết quả bộ đếm thành lỗi hiển thị trên /login. */
export function loginGateFrom(outcome: RateLimitOutcome): LoginGate {
  if (outcome.ok) {
    return { ok: true };
  }
  if (outcome.reason === "limited") {
    return {
      ok: false,
      error: { code: "rate_limited", message: strings.errors.rateLimited },
    };
  }
  logRateLimitUnavailable("login", outcome.detail);
  return {
    ok: false,
    error: { code: "internal_error", message: strings.errors.internal },
  };
}

export async function limitLoginAttempt(
  attempt: LoginAttempt,
  consume: typeof consumeRateLimits = consumeRateLimits,
): Promise<LoginGate> {
  return loginGateFrom(await consume(loginRateLimitChecks(attempt)));
}
