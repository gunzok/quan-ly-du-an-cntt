import { createHmac, randomUUID } from "node:crypto";
import { isIP } from "node:net";
import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { strings } from "@/lib/strings";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import { API_ERROR_STATUS, apiErrorBody } from "./errors";

/**
 * Giới hạn tần suất (Story E0-5, security.md STRIDE F1 "DoS", api-contract.md mục 5).
 *
 * Bộ đếm cửa sổ cố định nằm trong Postgres (migration *_rate_limit.sql, hàm public.rate_limit_hit
 * chỉ service_role gọi được); không dùng dịch vụ ngoài khi chưa có ADR. Mọi định danh (IP, email,
 * id người dùng) được băm HMAC trước khi thành khóa, nên CSDL không chứa IP hay email thô.
 */

export interface RateLimitRule {
  /** Số lượt tối đa trong một cửa sổ. */
  limit: number;
  /** Độ dài cửa sổ cố định, giây. */
  windowSeconds: number;
}

/**
 * NGƯỠNG: chỉnh ở đây, không rải ở nơi khác.
 *
 * - loginIp: mọi lần thử đăng nhập (mật khẩu và Google) từ một IP. Nới vì nhân viên một văn phòng
 *   có thể dùng chung một IP NAT.
 * - loginEmail: lần thử đăng nhập mật khẩu cho một email (mọi IP). Chặn dò mật khẩu một tài khoản.
 * - api: mọi request /api/v1/* của một người dùng đã đăng nhập.
 * - export: xuất báo cáo (Story sau), chặt hơn api; Route Handler xuất báo cáo gọi thêm
 *   `limitUser(userId, "export")` ngoài giới hạn api chung.
 */
export const RATE_LIMITS = {
  loginIp: { limit: 50, windowSeconds: 300 },
  loginEmail: { limit: 10, windowSeconds: 900 },
  api: { limit: 300, windowSeconds: 60 },
  export: { limit: 10, windowSeconds: 600 },
} as const satisfies Record<string, RateLimitRule>;

export type RateLimitName = keyof typeof RATE_LIMITS;

/** Thời gian chờ tối đa cho một lượt gọi bộ đếm (không để CSDL chậm kéo theo đăng nhập/API). */
export const RATE_LIMIT_TIMEOUT_MS = 2000;

export interface RateLimitDecision {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export interface RateLimitStore {
  hit(key: string, rule: RateLimitRule): Promise<RateLimitDecision>;
}

/** Bộ đếm không dùng được (thiếu cấu hình, CSDL lỗi, quá thời gian). Không mang dữ liệu nhạy cảm. */
export class RateLimitUnavailableError extends Error {
  constructor(readonly reason: string) {
    super(`rate limit unavailable: ${reason}`);
    this.name = "RateLimitUnavailableError";
  }
}

function toDecision(data: unknown): RateLimitDecision {
  const row = (Array.isArray(data) ? data[0] : data) as
    Record<string, unknown> | undefined;
  if (
    !row ||
    typeof row.allowed !== "boolean" ||
    typeof row.remaining !== "number" ||
    typeof row.retry_after_seconds !== "number"
  ) {
    throw new RateLimitUnavailableError("bad_response");
  }
  return {
    allowed: row.allowed,
    remaining: row.remaining,
    retryAfterSeconds: Math.max(1, Math.ceil(row.retry_after_seconds)),
  };
}

/** Bộ đếm qua RPC public.rate_limit_hit. Client PHẢI dùng khóa service_role. */
export function supabaseRateLimitStore(client: SupabaseClient): RateLimitStore {
  return {
    async hit(key, rule) {
      let result: { data: unknown; error: { code?: string } | null };
      try {
        result = await client
          .rpc("rate_limit_hit", {
            p_key: key,
            p_limit: rule.limit,
            p_window_seconds: rule.windowSeconds,
          })
          .abortSignal(AbortSignal.timeout(RATE_LIMIT_TIMEOUT_MS));
      } catch {
        throw new RateLimitUnavailableError("network");
      }
      if (result.error) {
        throw new RateLimitUnavailableError(
          `db_${result.error.code ?? "error"}`,
        );
      }
      return toDecision(result.data);
    },
  };
}

interface RateLimitConfig {
  store: RateLimitStore;
  /** Khóa bí mật cho HMAC định danh (xem rateLimitSecret), chỉ có ở máy chủ. */
  secret: string;
}

let cachedConfig: RateLimitConfig | null = null;

/**
 * Khóa HMAC cho định danh: RATE_LIMIT_SECRET nếu có (nên đặt riêng ở production), không thì khóa
 * service_role. Đổi khóa thì mọi bộ đếm bắt đầu lại từ 0 (vô hại). `make test-e2e` đặt giá trị ngẫu
 * nhiên mỗi lần chạy để bộ đếm của các lần chạy (và các worktree dùng chung stack) không cộng dồn.
 */
export function rateLimitSecret(
  env: Record<string, string | undefined> = process.env,
): string | null {
  return env.RATE_LIMIT_SECRET || env.SUPABASE_SERVICE_ROLE_KEY || null;
}

/**
 * Cấu hình mặc định từ biến môi trường máy chủ. Thiếu SUPABASE_SERVICE_ROLE_KEY thì ném
 * RateLimitUnavailableError: đăng nhập bị chặn (fail-closed), API vẫn chạy (fail-open, có log).
 */
export function defaultRateLimitConfig(
  env: Record<string, string | undefined> = process.env,
): RateLimitConfig {
  if (cachedConfig) {
    return cachedConfig;
  }
  const secret = rateLimitSecret(env);
  if (!env.SUPABASE_SERVICE_ROLE_KEY || !secret) {
    throw new RateLimitUnavailableError("missing_config");
  }
  let client: SupabaseClient;
  try {
    client = createServiceRoleClient();
  } catch {
    throw new RateLimitUnavailableError("missing_config");
  }
  cachedConfig = { store: supabaseRateLimitStore(client), secret };
  return cachedConfig;
}

/** HMAC-SHA256 của định danh, base64url (43 ký tự). Không đảo ngược được nếu không có khóa. */
export function hashIdentifier(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

export function rateLimitKey(
  name: RateLimitName,
  identifier: string,
  secret: string,
): string {
  return `${name}:${hashIdentifier(identifier, secret)}`;
}

/**
 * IP của người dùng, hoặc null khi không xác định được một cách đáng tin.
 *
 * Chỉ tin header khi chạy trên Vercel (VERCEL=1): proxy biên của Vercel GHI ĐÈ `x-real-ip` và
 * `x-forwarded-for` bằng IP thật của client, nên client không giả được. Chạy nơi khác (cục bộ, CI,
 * tự host không có proxy tin cậy) thì không tin header nào: trả null và mọi request dùng chung
 * nhóm "unknown" (an toàn, chỉ kém chính xác).
 */
export function clientIp(
  headers: Headers,
  env: Record<string, string | undefined> = process.env,
): string | null {
  if (env.VERCEL !== "1") {
    return null;
  }
  const candidates = [
    headers.get("x-real-ip"),
    headers.get("x-forwarded-for")?.split(",")[0],
  ];
  for (const raw of candidates) {
    const value = raw?.trim();
    if (value && isIP(value)) {
      return value.toLowerCase();
    }
  }
  return null;
}

export interface RateLimitCheck {
  name: RateLimitName;
  identifier: string;
}

export type RateLimitOutcome =
  | { ok: true }
  | { ok: false; reason: "limited"; retryAfterSeconds: number }
  | { ok: false; reason: "unavailable"; detail: string };

/**
 * Đếm một lượt cho từng mục (song song). Vượt bất kỳ mục nào thì "limited" với thời gian chờ dài
 * nhất; bộ đếm lỗi thì "unavailable" (nơi gọi tự quyết fail-open hay fail-closed).
 */
export async function consumeRateLimits(
  checks: RateLimitCheck[],
  config?: RateLimitConfig,
): Promise<RateLimitOutcome> {
  try {
    const { store, secret } = config ?? defaultRateLimitConfig();
    const decisions = await Promise.all(
      checks.map((c) =>
        store.hit(
          rateLimitKey(c.name, c.identifier, secret),
          RATE_LIMITS[c.name],
        ),
      ),
    );
    const blocked = decisions.filter((d) => !d.allowed);
    if (blocked.length > 0) {
      return {
        ok: false,
        reason: "limited",
        retryAfterSeconds: Math.max(...blocked.map((d) => d.retryAfterSeconds)),
      };
    }
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      reason: "unavailable",
      detail:
        error instanceof RateLimitUnavailableError
          ? error.reason
          : "unexpected",
    };
  }
}

/** Đường dẫn API có giới hạn tần suất theo người dùng (RATE_LIMITS.api), áp ở proxy.ts. */
export function isRateLimitedApiPath(pathname: string): boolean {
  return pathname === "/api/v1" || pathname.startsWith("/api/v1/");
}

/** Giới hạn theo người dùng đã đăng nhập (API chung, xuất báo cáo...). */
export function limitUser(
  userId: string,
  name: RateLimitName = "api",
  config?: RateLimitConfig,
): Promise<RateLimitOutcome> {
  return consumeRateLimits([{ name, identifier: `user:${userId}` }], config);
}

/** Ghi log một dòng JSON khi bộ đếm không dùng được; không ghi IP, email, id người dùng. */
export function logRateLimitUnavailable(
  where: string,
  detail: string,
  requestId?: string,
) {
  console.error(
    JSON.stringify({
      level: "error",
      event: "rate_limit_unavailable",
      where,
      detail,
      ...(requestId ? { request_id: requestId } : {}),
    }),
  );
}

/** 429 `rate_limited` theo api-contract.md mục 2, kèm Retry-After (giây). */
export function rateLimitedResponse(
  retryAfterSeconds: number,
  requestId: string = randomUUID(),
): NextResponse {
  return NextResponse.json(
    apiErrorBody({
      code: "rate_limited",
      message: strings.security.rateLimited,
      request_id: requestId,
    }),
    {
      status: API_ERROR_STATUS.rate_limited,
      headers: {
        "cache-control": "no-store",
        "retry-after": String(Math.max(1, Math.ceil(retryAfterSeconds))),
      },
    },
  );
}

/** Chỉ dùng trong test: bỏ cấu hình đã nhớ để đọc lại biến môi trường. */
export function resetRateLimitConfigForTests() {
  cachedConfig = null;
}
