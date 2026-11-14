import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clientIp,
  consumeRateLimits,
  defaultRateLimitConfig,
  hashIdentifier,
  isRateLimitedApiPath,
  limitUser,
  RATE_LIMITS,
  rateLimitedResponse,
  rateLimitKey,
  rateLimitSecret,
  resetRateLimitConfigForTests,
  supabaseRateLimitStore,
  type RateLimitRule,
  type RateLimitStore,
} from "./rate-limit";

/** Bộ đếm cửa sổ cố định trong bộ nhớ, cùng ngữ nghĩa với hàm SQL. */
function memoryStore(): RateLimitStore & { keys: () => string[] } {
  const counts = new Map<string, number>();
  return {
    keys: () => [...counts.keys()],
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

const SECRET = "khoa-bi-mat-thu";

afterEach(() => {
  resetRateLimitConfigForTests();
  vi.restoreAllMocks();
});

describe("RATE_LIMITS", () => {
  it("ngưỡng hợp lệ với hàm SQL; xuất báo cáo chặt hơn API chung", () => {
    for (const rule of Object.values(RATE_LIMITS)) {
      expect(rule.limit).toBeGreaterThanOrEqual(1);
      expect(rule.windowSeconds).toBeGreaterThanOrEqual(1);
      expect(rule.windowSeconds).toBeLessThanOrEqual(86400);
    }
    const perSecond = (r: RateLimitRule) => r.limit / r.windowSeconds;
    expect(perSecond(RATE_LIMITS.export)).toBeLessThan(
      perSecond(RATE_LIMITS.api),
    );
  });
});

describe("hashIdentifier, rateLimitKey", () => {
  it("không chứa định danh thô, ổn định, phụ thuộc khóa bí mật", () => {
    const key = rateLimitKey("loginEmail", "email:a@example.com", SECRET);
    expect(key).toMatch(/^loginEmail:[A-Za-z0-9_-]{43}$/);
    expect(key).not.toContain("example");
    expect(rateLimitKey("loginEmail", "email:a@example.com", SECRET)).toBe(key);
    expect(hashIdentifier("x", SECRET)).not.toBe(hashIdentifier("x", "khac"));
    expect(rateLimitKey("loginIp", "email:a@example.com", SECRET)).not.toBe(
      key,
    );
  });
});

describe("rateLimitSecret", () => {
  it("ưu tiên RATE_LIMIT_SECRET, không thì khóa service_role, thiếu cả hai thì null", () => {
    expect(
      rateLimitSecret({
        RATE_LIMIT_SECRET: "a",
        SUPABASE_SERVICE_ROLE_KEY: "b",
      }),
    ).toBe("a");
    expect(rateLimitSecret({ SUPABASE_SERVICE_ROLE_KEY: "b" })).toBe("b");
    expect(rateLimitSecret({ RATE_LIMIT_SECRET: "" })).toBeNull();
  });
});

describe("clientIp", () => {
  const spoofed = new Headers({
    "x-forwarded-for": "1.2.3.4",
    "x-real-ip": "5.6.7.8",
  });

  it("ngoài Vercel: không tin header client tự đặt", () => {
    expect(clientIp(spoofed, {})).toBeNull();
    expect(clientIp(spoofed, { VERCEL: "0" })).toBeNull();
  });

  it("trên Vercel: ưu tiên x-real-ip, rồi phần tử đầu của x-forwarded-for", () => {
    expect(clientIp(spoofed, { VERCEL: "1" })).toBe("5.6.7.8");
    expect(
      clientIp(new Headers({ "x-forwarded-for": " 2001:DB8::1 , 10.0.0.1" }), {
        VERCEL: "1",
      }),
    ).toBe("2001:db8::1");
  });

  it("giá trị không phải IP thì bỏ", () => {
    expect(
      clientIp(new Headers({ "x-real-ip": "abc", "x-forwarded-for": "xyz" }), {
        VERCEL: "1",
      }),
    ).toBeNull();
  });
});

describe("consumeRateLimits", () => {
  it("cho qua tới ngưỡng, lượt kế tiếp bị chặn kèm thời gian chờ", async () => {
    const config = { store: memoryStore(), secret: SECRET };
    for (let i = 0; i < RATE_LIMITS.loginEmail.limit; i++) {
      expect(
        await consumeRateLimits(
          [{ name: "loginEmail", identifier: "email:a@x.vn" }],
          config,
        ),
      ).toEqual({ ok: true });
    }
    expect(
      await consumeRateLimits(
        [{ name: "loginEmail", identifier: "email:a@x.vn" }],
        config,
      ),
    ).toEqual({
      ok: false,
      reason: "limited",
      retryAfterSeconds: RATE_LIMITS.loginEmail.windowSeconds,
    });
  });

  it("người khác không bị ảnh hưởng", async () => {
    const config = { store: memoryStore(), secret: SECRET };
    for (let i = 0; i <= RATE_LIMITS.api.limit; i++) {
      await limitUser("u1", "api", config);
    }
    expect((await limitUser("u1", "api", config)).ok).toBe(false);
    expect(await limitUser("u2", "api", config)).toEqual({ ok: true });
  });

  it("nhiều mục: một mục vượt là chặn, lấy thời gian chờ dài nhất", async () => {
    const store: RateLimitStore = {
      hit: async (key) =>
        key.startsWith("loginIp:")
          ? { allowed: false, remaining: 0, retryAfterSeconds: 30 }
          : { allowed: false, remaining: 0, retryAfterSeconds: 90 },
    };
    expect(
      await consumeRateLimits(
        [
          { name: "loginIp", identifier: "ip:unknown" },
          { name: "loginEmail", identifier: "email:a@x.vn" },
        ],
        { store, secret: SECRET },
      ),
    ).toEqual({ ok: false, reason: "limited", retryAfterSeconds: 90 });
  });

  it("bộ đếm lỗi: unavailable (nơi gọi quyết fail-open/closed)", async () => {
    const store: RateLimitStore = {
      hit: async () => {
        throw new Error("boom");
      },
    };
    expect(
      await limitUser("u1", "api", { store, secret: SECRET }),
    ).toMatchObject({ ok: false, reason: "unavailable", detail: "unexpected" });
  });

  it("thiếu SUPABASE_SERVICE_ROLE_KEY: unavailable missing_config", async () => {
    expect(() => defaultRateLimitConfig({})).toThrow(/missing_config/);
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    expect(await limitUser("u1")).toMatchObject({
      ok: false,
      reason: "unavailable",
      detail: "missing_config",
    });
    vi.unstubAllEnvs();
  });
});

describe("supabaseRateLimitStore", () => {
  function fakeClient(result: { data: unknown; error: unknown }) {
    const rpc = vi.fn(() => ({
      abortSignal: () => Promise.resolve(result),
    }));
    return { client: { rpc } as unknown as SupabaseClient, rpc };
  }

  it("gọi RPC rate_limit_hit với khóa và ngưỡng, đọc dòng kết quả", async () => {
    const { client, rpc } = fakeClient({
      data: [{ allowed: false, remaining: 0, retry_after_seconds: 12.2 }],
      error: null,
    });
    const decision = await supabaseRateLimitStore(client).hit("k", {
      limit: 3,
      windowSeconds: 60,
    });
    expect(rpc).toHaveBeenCalledWith("rate_limit_hit", {
      p_key: "k",
      p_limit: 3,
      p_window_seconds: 60,
    });
    expect(decision).toEqual({
      allowed: false,
      remaining: 0,
      retryAfterSeconds: 13,
    });
  });

  it("lỗi CSDL hoặc dữ liệu lạ: ném RateLimitUnavailableError", async () => {
    await expect(
      supabaseRateLimitStore(
        fakeClient({ data: null, error: { code: "42501" } }).client,
      ).hit("k", { limit: 1, windowSeconds: 1 }),
    ).rejects.toMatchObject({ reason: "db_42501" });
    await expect(
      supabaseRateLimitStore(fakeClient({ data: [], error: null }).client).hit(
        "k",
        { limit: 1, windowSeconds: 1 },
      ),
    ).rejects.toMatchObject({ reason: "bad_response" });
  });
});

describe("rateLimitedResponse", () => {
  it("429 rate_limited theo api-contract.md mục 2, kèm Retry-After nguyên dương", async () => {
    const res = rateLimitedResponse(12.3, "req-1");
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("13");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({
      error: {
        code: "rate_limited",
        message: expect.any(String),
        request_id: "req-1",
      },
    });
    expect(rateLimitedResponse(0).headers.get("retry-after")).toBe("1");
  });
});

describe("isRateLimitedApiPath", () => {
  it("chỉ /api/v1 và con của nó", () => {
    expect(isRateLimitedApiPath("/api/v1")).toBe(true);
    expect(isRateLimitedApiPath("/api/v1/users")).toBe(true);
    expect(isRateLimitedApiPath("/api/v10")).toBe(false);
    expect(isRateLimitedApiPath("/login")).toBe(false);
  });
});
