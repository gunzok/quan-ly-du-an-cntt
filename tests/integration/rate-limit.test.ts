/**
 * Test tích hợp Story E0-5 (QLDA-44) với Supabase cục bộ: bộ đếm Postgres thật, proxy trả 429
 * kèm Retry-After cho /api/v1/* sau ngưỡng mà không ảnh hưởng người khác, giới hạn đăng nhập,
 * kiểm Origin (CSRF) cho mọi Route Handler ghi dữ liệu.
 *
 * Chạy: make db-start && make test-integration. Thiếu biến thì BỎ QUA có thông báo.
 * Stack cục bộ dùng chung giữa các worktree: mọi khóa đều ngẫu nhiên (khóa HMAC ngẫu nhiên hoặc
 * người dùng tạm), không đụng bộ đếm của ai khác.
 */
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  consumeRateLimits,
  RATE_LIMITS,
  rateLimitKey,
  rateLimitSecret,
  supabaseRateLimitStore,
} from "@/lib/api/rate-limit";
import { signInWithPassword } from "@/lib/auth/sign-in";
import { limitLoginAttempt } from "@/lib/auth/login-rate-limit";
import { proxy } from "@/proxy";
import { missingIntegrationEnv } from "./env";
import {
  ANON_KEY,
  APP_ORIGIN,
  assertLocalSupabase,
  CookieJar,
  SERVICE_ROLE_KEY,
  serverClient,
  SUPABASE_URL,
} from "./helpers";

const enabled = missingIntegrationEnv().length === 0;

function callProxyWith(
  path: string,
  init: { method?: string; origin?: string; jar?: CookieJar } = {},
) {
  const headers = new Headers();
  if (init.origin) headers.set("origin", init.origin);
  if (init.jar && init.jar.cookies.size > 0) {
    headers.set("cookie", init.jar.header());
  }
  return proxy(
    new NextRequest(new URL(path, APP_ORIGIN), {
      method: init.method ?? "GET",
      headers,
    }),
  );
}

/** Ca test có thể chờ qua mép cửa sổ (tối đa ~15 giây) nên cần timeout dài hơn mặc định 5 giây. */
const WINDOW_TEST_TIMEOUT_MS = 30_000;

/** Chờ nếu cửa sổ cố định sắp hết, để các lượt của một ca test nằm trọn trong một cửa sổ. */
async function awayFromWindowEdge(windowSeconds: number, marginSeconds = 15) {
  const left = windowSeconds - ((Date.now() / 1000) % windowSeconds);
  if (left < marginSeconds) {
    await new Promise((r) => setTimeout(r, left * 1000 + 200));
  }
}

describe.skipIf(!enabled)("Giới hạn tần suất (Supabase cục bộ)", () => {
  let service: SupabaseClient;
  const users: { id: string; email: string; password: string }[] = [];

  beforeAll(async () => {
    assertLocalSupabase();
    service = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    for (let i = 0; i < 2; i++) {
      const email = `it-e0-5-${randomUUID()}@example.com`;
      const password = `It-${randomUUID()}`;
      const { data, error } = await service.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
      if (error) throw error;
      users.push({ id: data.user.id, email, password });
    }
  });

  afterAll(async () => {
    for (const u of users) await service.auth.admin.deleteUser(u.id);
  });

  async function signedInJar(u: { email: string; password: string }) {
    const jar = new CookieJar();
    const result = await signInWithPassword(serverClient(jar), u);
    expect(result.ok).toBe(true);
    return jar;
  }

  it("RPC chỉ service_role gọi được; khóa anon bị từ chối", async () => {
    const anon = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error } = await anon.rpc("rate_limit_hit", {
      p_key: `it:${randomUUID()}`,
      p_limit: 5,
      p_window_seconds: 60,
    });
    expect(error).not.toBeNull();
  });

  it(
    "bộ đếm Postgres: cho qua tới ngưỡng rồi chặn, khóa khác không bị ảnh hưởng",
    async () => {
      await awayFromWindowEdge(RATE_LIMITS.loginEmail.windowSeconds);
      const config = {
        store: supabaseRateLimitStore(service),
        secret: randomUUID(),
      };
      const check = (identifier: string) =>
        consumeRateLimits([{ name: "loginEmail", identifier }], config);

      for (let i = 0; i < RATE_LIMITS.loginEmail.limit; i++) {
        expect(await check("email:a@x.vn")).toEqual({ ok: true });
      }
      const blocked = await check("email:a@x.vn");
      expect(blocked).toMatchObject({ ok: false, reason: "limited" });
      if (!blocked.ok && blocked.reason === "limited") {
        expect(blocked.retryAfterSeconds).toBeGreaterThanOrEqual(1);
        expect(blocked.retryAfterSeconds).toBeLessThanOrEqual(
          RATE_LIMITS.loginEmail.windowSeconds,
        );
      }
      expect(await check("email:b@x.vn")).toEqual({ ok: true });
    },
    WINDOW_TEST_TIMEOUT_MS,
  );

  it(
    "đăng nhập: lần thử thứ (ngưỡng + 1) cho một email bị rate_limited",
    async () => {
      await awayFromWindowEdge(RATE_LIMITS.loginEmail.windowSeconds);
      const config = {
        store: supabaseRateLimitStore(service),
        secret: randomUUID(),
      };
      const consume: typeof consumeRateLimits = (checks) =>
        consumeRateLimits(checks, config);
      const attempt = { ip: "203.0.113.7", email: "Nguoi.Dung@Example.com" };
      for (let i = 0; i < RATE_LIMITS.loginEmail.limit; i++) {
        expect(await limitLoginAttempt(attempt, consume)).toEqual({ ok: true });
      }
      // Viết hoa/khoảng trắng khác vẫn cùng một email.
      expect(
        await limitLoginAttempt(
          { ...attempt, email: " nguoi.dung@example.com " },
          consume,
        ),
      ).toMatchObject({ ok: false, error: { code: "rate_limited" } });
      // Email khác cùng IP vẫn đăng nhập được (ngưỡng IP cao hơn).
      expect(
        await limitLoginAttempt(
          { ...attempt, email: "khac@example.com" },
          consume,
        ),
      ).toEqual({ ok: true });
    },
    WINDOW_TEST_TIMEOUT_MS,
  );

  it(
    "proxy: /api/v1/* quá ngưỡng trả 429 rate_limited kèm Retry-After, người khác vẫn qua",
    async () => {
      const [a, b] = users;
      const jarA = await signedInJar(a);
      const jarB = await signedInJar(b);
      await awayFromWindowEdge(RATE_LIMITS.api.windowSeconds);

      // Đốt hết hạn mức của A bằng đúng khóa proxy dùng (nhanh hơn gọi proxy 300 lần).
      const key = rateLimitKey("api", `user:${a.id}`, rateLimitSecret() ?? "");
      const store = supabaseRateLimitStore(service);
      const batch = 50;
      for (let i = 0; i < RATE_LIMITS.api.limit; i += batch) {
        await Promise.all(
          Array.from(
            { length: Math.min(batch, RATE_LIMITS.api.limit - i) },
            () => store.hit(key, RATE_LIMITS.api),
          ),
        );
      }

      const limited = await callProxyWith("/api/v1/projects", { jar: jarA });
      expect(limited.status).toBe(429);
      const retryAfter = Number(limited.headers.get("retry-after"));
      expect(Number.isInteger(retryAfter)).toBe(true);
      expect(retryAfter).toBeGreaterThanOrEqual(1);
      expect(retryAfter).toBeLessThanOrEqual(RATE_LIMITS.api.windowSeconds);
      expect(limited.headers.get("content-security-policy")).toContain(
        "frame-ancestors 'none'",
      );
      const body = await limited.json();
      expect(body).toEqual({
        error: {
          code: "rate_limited",
          message: expect.any(String),
          request_id: expect.stringMatching(/^[0-9a-f-]{36}$/),
        },
      });

      const other = await callProxyWith("/api/v1/projects", { jar: jarB });
      expect(other.status).not.toBe(429);
      expect(other.headers.get("x-middleware-next")).toBe("1");

      // Trang (không phải /api/v1) không bị giới hạn API.
      const home = await callProxyWith("/", { jar: jarA });
      expect(home.status).toBe(200);
    },
    WINDOW_TEST_TIMEOUT_MS,
  );

  it("CSRF: ghi dữ liệu /api/* khác origin hoặc thiếu Origin trả 403, trước cả kiểm phiên", async () => {
    const jar = await signedInJar(users[1]);
    for (const method of ["POST", "PATCH", "PUT", "DELETE"]) {
      const evil = await callProxyWith("/api/v1/users/invitations", {
        method,
        origin: "https://evil.example",
        jar,
      });
      expect(evil.status).toBe(403);
      expect((await evil.json()).error.code).toBe("forbidden");

      const missing = await callProxyWith("/api/v1/users/invitations", {
        method,
        jar,
      });
      expect(missing.status).toBe(403);
    }
    // Chưa đăng nhập nhưng khác origin: vẫn 403 (không cần hỏi Auth).
    const anonEvil = await callProxyWith("/api/v1/users", {
      method: "POST",
      origin: "https://evil.example",
    });
    expect(anonEvil.status).toBe(403);

    // Cùng origin: qua lớp CSRF (tới cổng phiên).
    const same = await callProxyWith("/api/v1/users", {
      method: "POST",
      origin: APP_ORIGIN,
      jar,
    });
    expect(same.headers.get("x-middleware-next")).toBe("1");
    const sameAnon = await callProxyWith("/api/v1/users", {
      method: "POST",
      origin: APP_ORIGIN,
    });
    expect(sameAnon.status).toBe(401);

    // GET khác origin không bị kiểm CSRF.
    const get = await callProxyWith("/api/v1/users", {
      origin: "https://evil.example",
      jar,
    });
    expect(get.status).not.toBe(403);
  });

  it("mọi phản hồi của proxy có CSP với nonce mới và header an toàn", async () => {
    const r1 = await callProxyWith("/login");
    const r2 = await callProxyWith("/login");
    const csp1 = r1.headers.get("content-security-policy") ?? "";
    const csp2 = r2.headers.get("content-security-policy") ?? "";
    expect(csp1).toMatch(/script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);
    expect(csp1).not.toBe(csp2);
    expect(csp1).toContain(new URL(SUPABASE_URL).origin);
    expect(r1.headers.get("x-content-type-options")).toBe("nosniff");
    expect(r1.headers.get("referrer-policy")).toBe(
      "strict-origin-when-cross-origin",
    );
    expect(r1.headers.get("permissions-policy")).toContain("camera=()");

    const redirect = await callProxyWith("/");
    expect(redirect.status).toBe(307);
    expect(redirect.headers.get("content-security-policy")).toBeTruthy();
  });
});
