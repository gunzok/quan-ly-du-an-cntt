import { describe, expect, it } from "vitest";
import {
  limitLoginAttempt,
  loginRateLimitChecks,
} from "@/lib/auth/login-rate-limit";
import {
  E2E_LOGIN_IP_RULE,
  E2E_RELAXED_LOGIN_ENV,
  isE2eRelaxedLoginRateLimit,
} from "./e2e-rate-limit";
import {
  RATE_LIMITS,
  consumeRateLimits,
  type RateLimitRule,
  type RateLimitStore,
} from "./rate-limit";

const LOCAL = "http://127.0.0.1:54321";
const relaxedEnv = {
  [E2E_RELAXED_LOGIN_ENV]: "1",
  NEXT_PUBLIC_SUPABASE_URL: LOCAL,
};

function memoryStore(): RateLimitStore {
  const counts = new Map<string, number>();
  return {
    async hit(key: string, rule: RateLimitRule) {
      const hits = (counts.get(key) ?? 0) + 1;
      counts.set(key, hits);
      return {
        allowed: hits <= rule.limit,
        remaining: Math.max(rule.limit - hits, 0),
        retryAfterSeconds: rule.windowSeconds,
      };
    },
  };
}

describe("isE2eRelaxedLoginRateLimit: chỉ e2e cục bộ, không bao giờ trên Vercel", () => {
  it("bật khi đủ: cờ đúng '1', không Vercel, Supabase cục bộ", () => {
    expect(isE2eRelaxedLoginRateLimit(relaxedEnv)).toBe(true);
    expect(
      isE2eRelaxedLoginRateLimit({
        ...relaxedEnv,
        NEXT_PUBLIC_SUPABASE_URL: "http://localhost:54321/",
      }),
    ).toBe(true);
  });

  it("thiếu cờ hoặc cờ khác '1': tắt", () => {
    expect(
      isE2eRelaxedLoginRateLimit({ NEXT_PUBLIC_SUPABASE_URL: LOCAL }),
    ).toBe(false);
    for (const value of ["true", "yes", "0", "", " 1", "1 "]) {
      expect(
        isE2eRelaxedLoginRateLimit({
          ...relaxedEnv,
          [E2E_RELAXED_LOGIN_ENV]: value,
        }),
        JSON.stringify(value),
      ).toBe(false);
    }
  });

  it("có bất kỳ dấu hiệu Vercel nào (production, preview, development): tắt dù có cờ", () => {
    for (const extra of [
      { VERCEL: "1" },
      { VERCEL_ENV: "production" },
      { VERCEL_ENV: "preview" },
      { VERCEL_ENV: "development" },
      { VERCEL_URL: "app-git-x.vercel.app" },
    ]) {
      expect(
        isE2eRelaxedLoginRateLimit({ ...relaxedEnv, ...extra }),
        JSON.stringify(extra),
      ).toBe(false);
    }
  });

  it("Supabase không phải cục bộ (hoặc giả dạng cục bộ): tắt dù có cờ", () => {
    for (const url of [
      undefined,
      "",
      "https://abcd.supabase.co",
      "https://127.0.0.1:54321",
      "http://localhost.evil.example",
      "http://127.0.0.1.nip.io",
      "http://evil.example/?http://127.0.0.1",
      "http://127.0.0.1@evil.example",
    ]) {
      expect(
        isE2eRelaxedLoginRateLimit({
          ...relaxedEnv,
          NEXT_PUBLIC_SUPABASE_URL: url,
        }),
        String(url),
      ).toBe(false);
    }
  });
});

describe("loginRateLimitChecks với chế độ e2e", () => {
  it("mặc định (production): loginIp dùng ngưỡng thật, không có ngưỡng thay", () => {
    const checks = loginRateLimitChecks(
      { ip: null, email: "a@example.com" },
      { VERCEL: "1", VERCEL_ENV: "production", [E2E_RELAXED_LOGIN_ENV]: "1" },
    );
    expect(checks.map((c) => c.rule)).toEqual([undefined, undefined]);
    expect(RATE_LIMITS.loginIp.limit).toBe(50);
  });

  it("e2e cục bộ: chỉ nới loginIp; loginEmail giữ ngưỡng thật", () => {
    const checks = loginRateLimitChecks(
      { ip: null, email: "a@example.com" },
      relaxedEnv,
    );
    expect(checks).toEqual([
      { name: "loginIp", identifier: "ip:unknown", rule: E2E_LOGIN_IP_RULE },
      { name: "loginEmail", identifier: "email:a@example.com" },
    ]);
    expect(E2E_LOGIN_IP_RULE.limit).toBeGreaterThan(RATE_LIMITS.loginIp.limit);
  });

  it("đếm thật: ngưỡng thật chặn lượt 51; e2e cục bộ cho qua, email vẫn chặn sau 10 lượt", async () => {
    const run = async (
      env: Record<string, string>,
      attempts: number,
      email: (i: number) => string,
    ) => {
      const config = { store: memoryStore(), secret: "k" };
      let last: Awaited<ReturnType<typeof limitLoginAttempt>> = { ok: true };
      for (let i = 0; i < attempts; i++) {
        last = await limitLoginAttempt(
          { ip: null, email: email(i) },
          (checks) =>
            consumeRateLimits(
              // Dựng lại checks theo env của ca test (limitLoginAttempt đọc process.env).
              loginRateLimitChecks({ ip: null, email: email(i) }, env).map(
                (c, k) => ({
                  ...c,
                  name: checks[k].name,
                }),
              ),
              config,
            ),
        );
      }
      return last;
    };
    const distinct = (i: number) => `u${i}@example.com`;
    expect((await run({}, 51, distinct)).ok).toBe(false);
    expect((await run(relaxedEnv, 51, distinct)).ok).toBe(true);
    expect((await run(relaxedEnv, 11, () => "same@example.com")).ok).toBe(
      false,
    );
  });
});
