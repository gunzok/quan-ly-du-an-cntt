/**
 * Test tích hợp Story E1-7 (QLDA-80) với Supabase cục bộ: nhận lời mời và đặt mật khẩu.
 *
 * Mời bằng API admin (như POST /api/v1/users/invitations) → lấy link từ email ở Mailpit (mẫu
 * supabase/templates/invite.html) → gọi Server Action THẬT submitAcceptInvite (verifyOtp +
 * updateUser, giới hạn tần suất Postgres thật) → proxy cho vào ứng dụng bằng cookie phiên httpOnly
 * → đăng nhập lại bằng mật khẩu mới. Link dùng lần hai, link giả, link cũ sau khi Admin gửi lại
 * đều bị từ chối với cùng một trạng thái.
 *
 * Chạy: make db-start && make test-integration (thiếu biến thì BỎ QUA có thông báo).
 * Mẫu email chỉ áp dụng sau khi stack khởi động lại với supabase/config.toml mới.
 */
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AcceptInviteState } from "@/lib/auth/accept-invite-action";
import { signInWithPassword } from "@/lib/auth/sign-in";
import { missingIntegrationEnv } from "./env";
import {
  assertLocalSupabase,
  callProxy,
  CookieJar,
  SERVICE_ROLE_KEY,
  serverClient,
  SUPABASE_URL,
} from "./helpers";

// next/headers và redirect chỉ chạy trong request của Next.js; ở đây trỏ cookies() vào hũ cookie
// của test và biến redirect() thành lỗi mang đích chuyển hướng.
const ctx = vi.hoisted(() => ({
  jar: undefined as CookieJar | undefined,
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    getAll: () => ctx.jar?.getAll() ?? [],
    set: (name: string, value: string, options?: Record<string, unknown>) =>
      ctx.jar?.set({ name, value, options }),
  }),
  headers: async () => new Headers(),
}));
class RedirectSignal extends Error {
  constructor(readonly to: string) {
    super(`redirect ${to}`);
  }
}
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new RedirectSignal(to);
  },
}));

const { submitAcceptInvite } = await import("@/lib/auth/accept-invite-action");

const enabled = missingIntegrationEnv().length === 0;
const MAILPIT_URL = process.env.MAILPIT_URL ?? "http://127.0.0.1:54324";

/** Đợi email mời mới nhất (sau `after`) tới địa chỉ này, trả URL /auth/accept-invite trong email. */
async function waitForInviteLink(email: string, after = 0): Promise<URL> {
  const query = encodeURIComponent(`to:"${email}"`);
  for (let i = 0; i < 40; i++) {
    const search = await fetch(`${MAILPIT_URL}/api/v1/search?query=${query}`);
    const { messages } = (await search.json()) as {
      messages?: { ID: string; Created: string }[];
    };
    const latest = messages?.find((m) => Date.parse(m.Created) > after);
    if (latest) {
      const message = await fetch(`${MAILPIT_URL}/api/v1/message/${latest.ID}`);
      const { HTML } = (await message.json()) as { HTML?: string };
      const link = (HTML ?? "")
        .replace(/&amp;/g, "&")
        .match(/href="([^"]*\/auth\/accept-invite\?[^"]+)"/);
      if (!link) {
        throw new Error(
          "Email mời không có link /auth/accept-invite. Mẫu supabase/templates/invite.html chưa được áp: khởi động lại stack (supabase stop && supabase start).",
        );
      }
      return new URL(link[1]);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Không thấy email mời gửi tới ${email} ở Mailpit`);
}

async function submit(
  jar: CookieJar,
  fields: Record<string, string>,
): Promise<{ state?: AcceptInviteState; redirectedTo?: string }> {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  ctx.jar = jar;
  try {
    return { state: await submitAcceptInvite({}, form) };
  } catch (error) {
    if (error instanceof RedirectSignal) return { redirectedTo: error.to };
    throw error;
  } finally {
    ctx.jar = undefined;
  }
}

describe.skipIf(!enabled)(
  "Nhận lời mời và đặt mật khẩu (Supabase cục bộ)",
  () => {
    let admin: SupabaseClient;
    const createdIds: string[] = [];
    const password = `Moi-${randomUUID()}`;

    async function invite(email: string) {
      const { data, error } = await admin.auth.admin.inviteUserByEmail(email);
      if (error) throw error;
      if (!createdIds.includes(data.user.id)) createdIds.push(data.user.id);
      return data.user;
    }

    beforeAll(() => {
      assertLocalSupabase();
      assertLocalSupabase(MAILPIT_URL);
      // Server Action gọi bộ đếm Postgres bằng khóa service_role (fail-closed nếu thiếu).
      process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_ROLE_KEY;
      process.env.RATE_LIMIT_SECRET = `it-e1-7-${randomUUID()}`;
      admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
    });

    afterAll(async () => {
      for (const id of createdIds) await admin.auth.admin.deleteUser(id);
    });

    it("mời → link trong email → đặt mật khẩu → vào ứng dụng → đăng nhập lại bằng mật khẩu mới; link dùng lần hai bị từ chối", async () => {
      const email = `it-e1-7-${randomUUID()}@example.com`;
      const user = await invite(email);

      const link = await waitForInviteLink(email);
      expect(link.pathname).toBe("/auth/accept-invite");
      expect(link.searchParams.get("type")).toBe("invite");
      expect(link.searchParams.has("redirect_to")).toBe(false);
      const tokenHash = link.searchParams.get("token_hash") ?? "";
      expect(tokenHash).toMatch(/^[A-Za-z0-9_-]{16,128}$/);

      // GET trang (chưa đăng nhập) được proxy cho qua và KHÔNG tiêu token.
      const page = await callProxy(`/auth/accept-invite${link.search}`);
      expect(page.headers.get("location")).toBeNull();

      // Lỗi trường không gọi Auth, token vẫn còn dùng được.
      const jar = new CookieJar();
      expect(
        await submit(jar, {
          token_hash: tokenHash,
          password: "ngan",
          confirm_password: "khac",
        }),
      ).toEqual({
        state: { fieldErrors: { password: "too_short", confirm: "mismatch" } },
      });
      expect(jar.authCookies()).toHaveLength(0);

      expect(
        await submit(jar, {
          token_hash: tokenHash,
          password,
          confirm_password: password,
        }),
      ).toEqual({ redirectedTo: "/" });

      // Cookie phiên httpOnly, proxy cho vào trang chủ, /auth/accept-invite thì về /.
      const session = jar.authCookies();
      expect(session.length).toBeGreaterThan(0);
      for (const c of session) expect(c.options?.httpOnly).toBe(true);
      const home = await callProxy("/", jar);
      expect(home.headers.get("location")).toBeNull();
      const again = await callProxy(`/auth/accept-invite${link.search}`, jar);
      expect(new URL(again.headers.get("location") ?? "").pathname).toBe("/");

      const { data: after } = await admin.auth.admin.getUserById(user.id);
      expect(after.user?.email_confirmed_at).toBeTruthy();

      // Đăng nhập lại bằng mật khẩu mới (phiên mới, hũ cookie mới).
      const relogin = await signInWithPassword(serverClient(new CookieJar()), {
        email,
        password,
      });
      expect(relogin).toEqual({ ok: true, email });

      // Link dùng lần hai: cùng trạng thái "link không dùng được", không có phiên.
      const second = new CookieJar();
      expect(
        await submit(second, {
          token_hash: tokenHash,
          password: `Khac-${randomUUID()}`,
          confirm_password: "",
        }),
      ).toEqual({ state: { fieldErrors: { confirm: "required" } } });
      const other = `Khac-${randomUUID()}`;
      expect(
        await submit(second, {
          token_hash: tokenHash,
          password: other,
          confirm_password: other,
        }),
      ).toEqual({ state: { linkInvalid: true } });
      expect(second.authCookies()).toHaveLength(0);
      // Mật khẩu không bị đổi bởi lần thử thứ hai.
      expect(
        (
          await signInWithPassword(serverClient(new CookieJar()), {
            email,
            password: other,
          })
        ).ok,
      ).toBe(false);
    });

    it("link giả và link sai hình dạng bị từ chối giống hệt link hết hạn, không tạo phiên", async () => {
      const jar = new CookieJar();
      const pw = `Moi-${randomUUID()}`;
      for (const tokenHash of [
        "0".repeat(56),
        randomUUID().replace(/-/g, ""),
        "x",
        "",
      ]) {
        expect(
          await submit(jar, {
            token_hash: tokenHash,
            password: pw,
            confirm_password: pw,
          }),
        ).toEqual({ state: { linkInvalid: true } });
      }
      expect(jar.authCookies()).toHaveLength(0);
    });

    it("Admin gửi lại lời mời: link cũ bị từ chối, link mới dùng được", async () => {
      const email = `it-e1-7-gui-lai-${randomUUID()}@example.com`;
      await invite(email);
      const oldLink = await waitForInviteLink(email);
      const sentAt = Date.now();
      // GoTrue chặn gửi lại quá nhanh (auth.email.max_frequency = 1s).
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await invite(email);
      const newLink = await waitForInviteLink(email, sentAt);
      expect(newLink.searchParams.get("token_hash")).not.toBe(
        oldLink.searchParams.get("token_hash"),
      );

      const pw = `Moi-${randomUUID()}`;
      expect(
        await submit(new CookieJar(), {
          token_hash: oldLink.searchParams.get("token_hash") ?? "",
          password: pw,
          confirm_password: pw,
        }),
      ).toEqual({ state: { linkInvalid: true } });
      expect(
        await submit(new CookieJar(), {
          token_hash: newLink.searchParams.get("token_hash") ?? "",
          password: pw,
          confirm_password: pw,
        }),
      ).toEqual({ redirectedTo: "/" });
    });

    it("Auth cũng chặn mật khẩu dưới 12 ký tự khi gọi thẳng API (minimum_password_length)", async () => {
      const email = `it-e1-7-ngan-${randomUUID()}@example.com`;
      const { error } = await admin.auth.admin.createUser({
        email,
        password: "short-11-ch",
        email_confirm: true,
      });
      expect(error?.code).toBe("weak_password");
    });
  },
);
