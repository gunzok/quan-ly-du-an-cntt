/**
 * Test tích hợp Story E1-2 (QLDA-35) với Supabase cục bộ: đăng nhập Google, chặn đăng ký tự do.
 *
 * Không có tài khoản Google thật trong môi trường dev nên:
 * - Phần app -> Supabase Auth (URL authorize, code verifier PKCE httpOnly, provider google bật,
 *   redirect_uri, danh sách redirect cho phép) chạy với GoTrue cục bộ thật; dừng ở bước chuyển sang
 *   accounts.google.com.
 * - Bước đổi mã ở /auth/callback được kiểm bằng luồng PKCE THẬT của GoTrue cục bộ nhưng lấy mã
 *   từ magic link (email bắt ở Mailpit) thay cho Google: Route Handler gọi cùng
 *   exchangeCodeForSession, không phân biệt mã đến từ Google hay magic link.
 * - Chưa kiểm được: Google trả về đúng email đã xác minh và GoTrue gắn danh tính Google vào tài
 *   khoản đã mời / từ chối tài khoản lạ với signup_disabled. Cần OAuth client thật (staging).
 *
 * Chạy: make db-start && make test-integration (thiếu biến thì BỎ QUA có thông báo).
 */
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mapOAuthError, startGoogleSignIn } from "@/lib/auth/oauth";
import { signInWithPassword } from "@/lib/auth/sign-in";
import { missingIntegrationEnv } from "./env";
import {
  ANON_KEY,
  APP_ORIGIN,
  assertLocalSupabase,
  callProxy,
  CookieJar,
  SERVICE_ROLE_KEY,
  serverClient,
  SUPABASE_URL,
} from "./helpers";

// next/headers chỉ chạy trong request của Next.js; ở đây trỏ cookies() vào hũ cookie của test
// để gọi đúng Route Handler app/auth/callback/route.ts.
const cookieContext = vi.hoisted(() => ({
  jar: undefined as CookieJar | undefined,
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    getAll: () => cookieContext.jar?.getAll() ?? [],
    set: (name: string, value: string, options?: Record<string, unknown>) =>
      cookieContext.jar?.set({ name, value, options }),
  }),
}));

const { GET: callbackRoute } = await import("@/app/auth/callback/route");

const enabled = missingIntegrationEnv().length === 0;
// Mailpit của stack cục bộ ([inbucket] port trong supabase/config.toml).
const MAILPIT_URL = process.env.MAILPIT_URL ?? "http://127.0.0.1:54324";
const CALLBACK_URL = `${APP_ORIGIN}/auth/callback`;

function anonClient() {
  return createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function runCallback(url: string, jar: CookieJar) {
  cookieContext.jar = jar;
  try {
    return await callbackRoute(new NextRequest(url));
  } finally {
    cookieContext.jar = undefined;
  }
}

function locationOf(response: Response) {
  return new URL(response.headers.get("location") ?? "", APP_ORIGIN);
}

/** Đợi email gửi tới địa chỉ này ở Mailpit, trả liên kết xác minh của GoTrue. */
async function waitForVerifyLink(email: string): Promise<string> {
  const query = encodeURIComponent(`to:"${email}"`);
  for (let i = 0; i < 40; i++) {
    const search = await fetch(`${MAILPIT_URL}/api/v1/search?query=${query}`);
    const { messages } = (await search.json()) as {
      messages?: { ID: string }[];
    };
    if (messages && messages.length > 0) {
      const message = await fetch(
        `${MAILPIT_URL}/api/v1/message/${messages[0].ID}`,
      );
      const { Text, HTML } = (await message.json()) as {
        Text?: string;
        HTML?: string;
      };
      const body = `${Text ?? ""} ${HTML ?? ""}`.replace(/&amp;/g, "&");
      const link = body.match(
        /https?:\/\/[^\s"'<>]+\/auth\/v1\/verify\?[^\s"'<>]+/,
      );
      if (link) return link[0];
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Không thấy email đăng nhập gửi tới ${email} ở Mailpit`);
}

describe.skipIf(!enabled)("Đăng nhập Google (Supabase cục bộ)", () => {
  let admin: SupabaseClient;
  const createdIds: string[] = [];
  const invitedEmail = `it-e1-2-${randomUUID()}@example.com`;
  const password = `It-${randomUUID()}`;

  beforeAll(async () => {
    assertLocalSupabase();
    assertLocalSupabase(MAILPIT_URL);
    admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    // Tài khoản "đã được mời": tạo bằng API admin như luồng mời/seed.
    const { data, error } = await admin.auth.admin.createUser({
      email: invitedEmail,
      password,
      email_confirm: true,
    });
    if (error) throw error;
    createdIds.push(data.user.id);
  });

  afterAll(async () => {
    for (const id of createdIds) await admin.auth.admin.deleteUser(id);
  });

  describe("chặn đăng ký tự do ở Supabase Auth (enable_signup = false)", () => {
    it("cấu hình Auth báo disable_signup và provider google đã bật", async () => {
      const res = await fetch(`${SUPABASE_URL}/auth/v1/settings`, {
        headers: { apikey: ANON_KEY },
      });
      const settings = (await res.json()) as {
        disable_signup: boolean;
        external: Record<string, boolean>;
      };
      expect(settings.disable_signup).toBe(true);
      expect(settings.external.google).toBe(true);
    });

    it("tự đăng ký bằng khóa anon bị từ chối với signup_disabled", async () => {
      const email = `it-e1-2-la-${randomUUID()}@example.com`;
      const signUp = await anonClient().auth.signUp({ email, password });
      expect(signUp.error?.code).toBe("signup_disabled");
      expect(signUp.data.user).toBeNull();

      const otp = await anonClient().auth.signInWithOtp({
        email,
        options: { shouldCreateUser: true },
      });
      expect(otp.error?.code).toBe("signup_disabled");
      expect(mapOAuthError(otp.error ?? {})).toBe("not_invited");

      const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
      expect(data.users.some((u) => u.email === email)).toBe(false);
    });

    it("người được tạo bằng API admin vẫn đăng nhập được", async () => {
      const jar = new CookieJar();
      const result = await signInWithPassword(serverClient(jar), {
        email: invitedEmail,
        password,
      });
      expect(result).toEqual({ ok: true, email: invitedEmail });
    });
  });

  describe("nút Google: app -> Supabase Auth -> Google", () => {
    it("tạo URL authorize PKCE, code verifier nằm trong cookie httpOnly, Auth chuyển sang Google", async () => {
      const jar = new CookieJar();
      const result = await startGoogleSignIn(serverClient(jar), APP_ORIGIN);
      if (!result.ok) throw new Error(`startGoogleSignIn lỗi: ${result.error}`);

      const authorize = new URL(result.url);
      expect(`${authorize.origin}${authorize.pathname}`).toBe(
        `${SUPABASE_URL}/auth/v1/authorize`,
      );
      expect(authorize.searchParams.get("provider")).toBe("google");
      expect(authorize.searchParams.get("redirect_to")).toBe(CALLBACK_URL);
      expect(authorize.searchParams.get("code_challenge")).toBeTruthy();
      expect(authorize.searchParams.get("code_challenge_method")).toBe("s256");

      const verifier = jar.codeVerifierCookies();
      expect(verifier.length).toBeGreaterThan(0);
      for (const c of verifier) {
        expect(c.options).toMatchObject({
          httpOnly: true,
          sameSite: "lax",
          path: "/",
        });
      }
      expect(jar.authCookies()).toEqual([]);

      const toGoogle = await fetch(result.url, { redirect: "manual" });
      expect(toGoogle.status).toBe(302);
      const google = new URL(toGoogle.headers.get("location") ?? "");
      expect(google.hostname).toBe("accounts.google.com");
      expect(google.searchParams.get("redirect_uri")).toBe(
        `${SUPABASE_URL}/auth/v1/callback`,
      );
      expect(google.searchParams.get("prompt")).toBe("select_account");
    });

    it("redirect_to ngoài danh sách cho phép: Auth không chuyển về đó (về site_url)", async () => {
      const jar = new CookieJar();
      const result = await startGoogleSignIn(
        serverClient(jar),
        "https://evil.example",
      );
      if (!result.ok) throw new Error("startGoogleSignIn lỗi");
      const state = await googleState(result.url);
      const back = await fetch(
        `${SUPABASE_URL}/auth/v1/callback?state=${state}&error=access_denied`,
        { redirect: "manual" },
      );
      const target = new URL(back.headers.get("location") ?? "");
      expect(target.hostname).not.toBe("evil.example");
      expect(target.hostname).toBe("127.0.0.1");
    });

    it("người dùng hủy ở Google: Auth chuyển về /auth/callback kèm lỗi, app về /login báo lỗi", async () => {
      const jar = new CookieJar();
      const result = await startGoogleSignIn(serverClient(jar), APP_ORIGIN);
      if (!result.ok) throw new Error("startGoogleSignIn lỗi");
      const state = await googleState(result.url);
      const back = await fetch(
        `${SUPABASE_URL}/auth/v1/callback?state=${state}&error=access_denied`,
        { redirect: "manual" },
      );
      const callback = back.headers.get("location") ?? "";
      expect(callback.startsWith(`${CALLBACK_URL}?`)).toBe(true);

      const res = await runCallback(callback, jar);
      expect(res.status).toBe(307);
      expect(locationOf(res).pathname).toBe("/login");
      expect(locationOf(res).searchParams.get("error")).toBe("oauth_failed");
      expect(jar.authCookies()).toEqual([]);
    });
  });

  describe("Route Handler /auth/callback đổi mã lấy phiên (PKCE thật, mã từ magic link)", () => {
    it("người đã được mời: có cookie phiên httpOnly, về / và vào được trang chủ", async () => {
      const jar = new CookieJar();
      const { error } = await serverClient(jar).auth.signInWithOtp({
        email: invitedEmail,
        options: { shouldCreateUser: false, emailRedirectTo: CALLBACK_URL },
      });
      expect(error).toBeNull();
      expect(jar.codeVerifierCookies().length).toBeGreaterThan(0);

      const verify = await fetch(await waitForVerifyLink(invitedEmail), {
        redirect: "manual",
      });
      const callback = verify.headers.get("location") ?? "";
      expect(callback.startsWith(`${CALLBACK_URL}?code=`)).toBe(true);

      // Thêm tham số next giả: Route Handler phải bỏ qua, vẫn về /.
      const res = await runCallback(
        `${callback}&next=${encodeURIComponent("https://evil.example")}`,
        jar,
      );
      expect(res.status).toBe(307);
      expect(locationOf(res).toString()).toBe(`${APP_ORIGIN}/`);
      expect(res.headers.get("cache-control")).toMatch(/no-store/);

      const cookies = jar.authCookies();
      expect(cookies.length).toBeGreaterThan(0);
      for (const c of cookies) {
        expect(c.options).toMatchObject({
          httpOnly: true,
          sameSite: "lax",
          path: "/",
        });
      }
      // Verifier chung đã dùng thì bị xóa. supabase-js 2.119 để lại bản theo luồng (`-flow-<id>-`,
      // `-flows-`) khi callback không có sb_flow_id; chúng vô dụng sau khi mã đã đổi và được
      // dọn khi đăng xuất.
      expect(
        jar
          .codeVerifierCookies()
          .filter((c) => /-auth-token-code-verifier(\.\d+)?$/.test(c.name)),
      ).toEqual([]);

      const { data } = await serverClient(jar).auth.getUser();
      expect(data.user?.email).toBe(invitedEmail);
      const home = await callProxy("/", jar);
      expect(home.status).toBe(200);

      // Dùng lại mã đã đổi: bị từ chối, không tạo phiên mới.
      const replayJar = new CookieJar();
      const replay = await runCallback(callback, replayJar);
      expect(locationOf(replay).pathname).toBe("/login");
      expect(replayJar.authCookies()).toEqual([]);
    });

    it("mã sai hoặc thiếu code verifier: về /login báo lỗi, không có cookie phiên", async () => {
      // Thiếu code verifier (trình duyệt khác, cookie đã mất): thư viện từ chối trước khi gọi Auth.
      const noVerifier = new CookieJar();
      const first = await runCallback(
        `${CALLBACK_URL}?code=${randomUUID()}`,
        noVerifier,
      );
      expect(locationOf(first).searchParams.get("error")).toBe("oauth_failed");
      expect(noVerifier.authCookies()).toEqual([]);

      // Có code verifier thật nhưng mã giả: GoTrue cục bộ từ chối.
      const jar = new CookieJar();
      const started = await startGoogleSignIn(serverClient(jar), APP_ORIGIN);
      expect(started.ok).toBe(true);
      const res = await runCallback(
        `${CALLBACK_URL}?code=${randomUUID()}`,
        jar,
      );
      expect(res.status).toBe(307);
      expect(locationOf(res).pathname).toBe("/login");
      expect(locationOf(res).searchParams.get("error")).toBe("oauth_failed");
      expect(jar.authCookies()).toEqual([]);
    });

    it("Auth từ chối tài khoản chưa mời (signup_disabled): về /login báo liên hệ Admin", async () => {
      // Dạng tham số GoTrue gắn vào redirect_to khi từ chối (mô phỏng; Google thật chưa thử).
      const jar = new CookieJar();
      const res = await runCallback(
        `${CALLBACK_URL}?error=access_denied&error_code=signup_disabled&error_description=Signups+not+allowed+for+this+instance`,
        jar,
      );
      expect(locationOf(res).pathname).toBe("/login");
      expect(locationOf(res).searchParams.get("error")).toBe("not_invited");
      expect(jar.authCookies()).toEqual([]);
    });

    it("proxy cho người chưa đăng nhập vào /auth/callback", async () => {
      const res = await callProxy("/auth/callback?code=x");
      expect(res.status).toBe(200);
    });
  });
});

/** Lấy state (id luồng PKCE) từ URL Google mà Supabase Auth chuyển tới. */
async function googleState(authorizeUrl: string): Promise<string> {
  const res = await fetch(authorizeUrl, { redirect: "manual" });
  const state = new URL(res.headers.get("location") ?? "").searchParams.get(
    "state",
  );
  if (!state) throw new Error("Không có state trong URL Google");
  return state;
}
