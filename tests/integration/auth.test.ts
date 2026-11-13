/**
 * Test tích hợp Story E1-1 (QLDA-31) với Supabase cục bộ: đăng nhập đúng, sai mật khẩu,
 * đăng xuất, hết phiên, và proxy bảo vệ trang.
 *
 * Chạy: make db-start && make test-integration
 * Cần SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY (make test-integration tự lấy
 * từ `supabase status`). Thiếu biến thì cả nhóm test bị BỎ QUA có thông báo (CI chưa dựng Supabase).
 * Khóa service_role chỉ dùng ở đây để tạo/xóa một tài khoản tạm; chỉ chấp nhận URL localhost.
 */
import { randomUUID } from "node:crypto";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signInWithPassword } from "@/lib/auth/sign-in";
import { strings } from "@/lib/strings";
import { sessionCookieOptions } from "@/lib/supabase/cookie-options";
import { proxy } from "@/proxy";
import { missingIntegrationEnv } from "./env";

// Thiếu biến thì bỏ qua; thông báo in ở tests/integration/global-setup.ts.
const enabled = missingIntegrationEnv().length === 0;

const SUPABASE_URL = process.env.SUPABASE_URL ?? "";
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? "";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const APP_ORIGIN = "http://localhost:3000";

interface StoredCookie {
  name: string;
  value: string;
  options?: CookieOptions;
}

/** Hũ cookie trong bộ nhớ, đóng vai trình duyệt + next/headers. */
class CookieJar {
  readonly cookies = new Map<string, StoredCookie>();

  getAll() {
    return [...this.cookies.values()].map(({ name, value }) => ({
      name,
      value,
    }));
  }

  set(cookie: StoredCookie) {
    if (cookie.value === "" || cookie.options?.maxAge === 0) {
      this.cookies.delete(cookie.name);
    } else {
      this.cookies.set(cookie.name, cookie);
    }
  }

  authCookies() {
    return [...this.cookies.values()].filter((c) =>
      /^sb-.+-auth-token(\.\d+)?$/.test(c.name),
    );
  }

  header() {
    return this.getAll()
      .map((c) => `${c.name}=${c.value}`)
      .join("; ");
  }

  clone() {
    const copy = new CookieJar();
    for (const c of this.cookies.values()) copy.cookies.set(c.name, { ...c });
    return copy;
  }
}

/** Client máy chủ giống lib/supabase/server.ts nhưng đọc/ghi vào CookieJar. */
function serverClient(jar: CookieJar) {
  return createServerClient(SUPABASE_URL, ANON_KEY, {
    cookieOptions: sessionCookieOptions(),
    cookies: {
      getAll: () => jar.getAll(),
      setAll: (list) => list.forEach((c) => jar.set(c)),
    },
  });
}

function callProxy(path: string, jar?: CookieJar) {
  const headers = new Headers();
  if (jar && jar.cookies.size > 0) headers.set("cookie", jar.header());
  return proxy(new NextRequest(new URL(path, APP_ORIGIN), { headers }));
}

/** Giải mã phiên trong cookie (gộp các mảnh .0, .1 nếu có). */
function readSession(jar: CookieJar): {
  name: string;
  session: Record<string, unknown>;
} {
  const parts = jar.authCookies().sort((a, b) => a.name.localeCompare(b.name));
  expect(parts.length).toBeGreaterThan(0);
  const name = parts[0].name.replace(/\.\d+$/, "");
  const raw = parts.map((p) => p.value).join("");
  const json = raw.startsWith("base64-")
    ? Buffer.from(raw.slice("base64-".length), "base64url").toString("utf8")
    : raw;
  return { name, session: JSON.parse(json) as Record<string, unknown> };
}

/** Ghi đè phiên cho giống access token đã hết hạn (expires_at ở quá khứ). */
function expireSession(jar: CookieJar) {
  const { name, session } = readSession(jar);
  const expired = {
    ...session,
    expires_at: Math.floor(Date.now() / 1000) - 60,
  };
  for (const c of jar.authCookies()) jar.cookies.delete(c.name);
  jar.set({
    name,
    value:
      "base64-" + Buffer.from(JSON.stringify(expired)).toString("base64url"),
  });
}

function setCookieHeaders(response: Response) {
  return response.headers.getSetCookie();
}

describe.skipIf(!enabled)("Đăng nhập email/mật khẩu (Supabase cục bộ)", () => {
  let admin: SupabaseClient;
  let userId: string;
  const email = `it-e1-1-${randomUUID()}@example.com`;
  const password = `It-${randomUUID()}`;

  beforeAll(async () => {
    const host = new URL(SUPABASE_URL).hostname;
    if (!["127.0.0.1", "localhost", "::1"].includes(host)) {
      throw new Error(
        `Test tích hợp chỉ chạy với Supabase cục bộ, từ chối ${host}`,
      );
    }
    process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE_URL;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = ANON_KEY;

    admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (error) throw error;
    userId = data.user.id;
  });

  afterAll(async () => {
    if (userId) await admin.auth.admin.deleteUser(userId);
  });

  async function signedInJar() {
    const jar = new CookieJar();
    const result = await signInWithPassword(serverClient(jar), {
      email,
      password,
    });
    expect(result).toEqual({ ok: true, email });
    return jar;
  }

  it("đăng nhập đúng: có cookie phiên httpOnly, SameSite=Lax và vào được trang chủ", async () => {
    const jar = await signedInJar();

    const cookies = jar.authCookies();
    expect(cookies.length).toBeGreaterThan(0);
    for (const c of cookies) {
      expect(c.options).toMatchObject({
        httpOnly: true,
        sameSite: "lax",
        path: "/",
      });
    }

    const { data } = await serverClient(jar).auth.getUser();
    expect(data.user?.email).toBe(email);

    const home = await callProxy("/", jar);
    expect(home.status).toBe(200);
    expect(home.headers.get("location")).toBeNull();

    const login = await callProxy("/login", jar);
    expect(login.status).toBe(307);
    expect(new URL(login.headers.get("location") ?? "").pathname).toBe("/");
  });

  it("sai mật khẩu và email không tồn tại trả CÙNG lỗi chung, không tạo phiên", async () => {
    const jarWrong = new CookieJar();
    const wrong = await signInWithPassword(serverClient(jarWrong), {
      email,
      password: "mat-khau-sai",
    });
    const jarUnknown = new CookieJar();
    const unknown = await signInWithPassword(serverClient(jarUnknown), {
      email: `khong-ton-tai-${randomUUID()}@example.com`,
      password: "mat-khau-sai",
    });

    expect(wrong).toMatchObject({
      ok: false,
      error: {
        code: "unauthenticated",
        message: strings.errors.invalidCredentials,
      },
    });
    expect(!wrong.ok && wrong.error).toEqual(!unknown.ok && unknown.error);
    expect(jarWrong.authCookies()).toEqual([]);
    expect(jarUnknown.authCookies()).toEqual([]);
  });

  it("chưa đăng nhập: trang bị chuyển về /login, API trả 401 theo cấu trúc lỗi", async () => {
    const home = await callProxy("/");
    expect(home.status).toBe(307);
    expect(new URL(home.headers.get("location") ?? "").pathname).toBe("/login");

    const login = await callProxy("/login");
    expect(login.status).toBe(200);

    const api = await callProxy("/api/v1/me");
    expect(api.status).toBe(401);
    expect(await api.json()).toEqual({
      error: {
        code: "unauthenticated",
        message: strings.errors.unauthenticated,
      },
    });
  });

  it("đăng xuất: xóa cookie phiên và thu hồi refresh token", async () => {
    const jar = await signedInJar();
    const before = jar.clone();
    const refreshToken = readSession(jar).session.refresh_token as string;

    const { error } = await serverClient(jar).auth.signOut({ scope: "local" });
    expect(error).toBeNull();
    expect(jar.authCookies()).toEqual([]);

    // Sau đăng xuất, cookie đã xóa: proxy chuyển về /login.
    const home = await callProxy("/", jar);
    expect(home.status).toBe(307);

    // Refresh token của phiên cũ không dùng lại được (kể cả nếu ai đó giữ bản sao cookie).
    const anon = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const refreshed = await anon.auth.refreshSession({
      refresh_token: refreshToken,
    });
    expect(refreshed.error).not.toBeNull();
    expect(refreshed.data.session).toBeNull();

    // getUser với phiên cũ bị máy chủ Auth từ chối.
    const { data } = await serverClient(before).auth.getUser();
    expect(data.user).toBeNull();
  });

  it("hết phiên, refresh token còn hiệu lực: proxy tự làm mới, cookie mới vẫn httpOnly", async () => {
    const jar = await signedInJar();
    const oldAccess = readSession(jar).session.access_token;
    expireSession(jar);

    const res = await callProxy("/", jar);
    expect(res.status).toBe(200);
    const setCookies = setCookieHeaders(res).filter((c) =>
      /^sb-.+-auth-token/.test(c),
    );
    expect(setCookies.length).toBeGreaterThan(0);
    for (const c of setCookies) {
      expect(c).toMatch(/HttpOnly/i);
      expect(c).toMatch(/SameSite=lax/i);
    }
    expect(setCookies.join(";")).not.toContain(String(oldAccess));
    expect(res.headers.get("cache-control")).toMatch(/no-store|private/);
  });

  it("hết phiên sau khi đã đăng xuất (refresh token bị thu hồi): chuyển về /login và xóa cookie", async () => {
    const jar = await signedInJar();
    const stale = jar.clone();
    await serverClient(jar).auth.signOut({ scope: "local" });
    expireSession(stale);

    const res = await callProxy("/", stale);
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get("location") ?? "").pathname).toBe("/login");
    const cleared = setCookieHeaders(res).filter((c) =>
      /^sb-.+-auth-token/.test(c),
    );
    expect(cleared.length).toBeGreaterThan(0);
    for (const c of cleared) expect(c).toMatch(/Max-Age=0/i);
  });

  it("người dùng bị xóa khi cookie còn hạn: chuyển về /login, xóa cookie, không lặp chuyển hướng", async () => {
    const tmpEmail = `it-e1-1-xoa-${randomUUID()}@example.com`;
    const created = await admin.auth.admin.createUser({
      email: tmpEmail,
      password,
      email_confirm: true,
    });
    if (created.error) throw created.error;
    const jar = new CookieJar();
    const result = await signInWithPassword(serverClient(jar), {
      email: tmpEmail,
      password,
    });
    expect(result.ok).toBe(true);
    await admin.auth.admin.deleteUser(created.data.user.id);

    const home = await callProxy("/", jar);
    expect(home.status).toBe(307);
    expect(new URL(home.headers.get("location") ?? "").pathname).toBe("/login");
    const cleared = setCookieHeaders(home).filter((c) =>
      /^sb-.+-auth-token/.test(c),
    );
    expect(cleared.length).toBeGreaterThan(0);
    for (const c of cleared) expect(c).toMatch(/Max-Age=0/i);

    // Kể cả khi trình duyệt chưa xóa cookie, /login không đẩy ngược về /.
    const login = await callProxy("/login", jar);
    expect(login.status).toBe(200);
  });
});
