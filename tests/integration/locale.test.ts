/**
 * Test tích hợp Story E10-2 (QLDA-65) với Supabase cục bộ: lưu ngôn ngữ vào hồ sơ qua
 * PATCH /api/v1/me (lõi Route Handler, client phiên tạo từ hũ cookie) và lớp chặn RLS/quyền cột:
 * người khác không đổi được locale của mình.
 *
 * Chạy: make db-start && make test-integration. Tài khoản tạo tạm với email ngẫu nhiên, xóa ở afterAll.
 */
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signInWithPassword } from "@/lib/auth/sign-in";
import { handlePatchMe } from "@/lib/me/handlers";
import { missingIntegrationEnv } from "./env";
import {
  APP_ORIGIN,
  CookieJar,
  SERVICE_ROLE_KEY,
  SUPABASE_URL,
  assertLocalSupabase,
  serverClient as sessionClient,
} from "./helpers";

const enabled = missingIntegrationEnv().length === 0;

interface ErrorBody {
  error: {
    code: string;
    message: string;
    message_key?: string;
    details?: { field: string; issue: string }[];
  };
}

function patchMe(
  jar: CookieJar,
  body: unknown,
  origin: string | null = APP_ORIGIN,
) {
  const headers = new Headers({ "content-type": "application/json" });
  if (origin) headers.set("origin", origin);
  return handlePatchMe(
    new Request(new URL("/api/v1/me", APP_ORIGIN), {
      method: "PATCH",
      headers,
      body: JSON.stringify(body),
    }),
    { session: sessionClient(jar), isProduction: false },
  );
}

describe.skipIf(!enabled)("Lưu ngôn ngữ vào hồ sơ (Supabase cục bộ)", () => {
  const tag = randomUUID().slice(0, 8);
  const password = `It-${randomUUID()}`;
  const createdUsers: string[] = [];
  let service: SupabaseClient;
  let alice: { id: string; email: string };
  let bob: { id: string; email: string };
  let locked: { id: string; email: string };
  let aliceJar: CookieJar;
  let bobJar: CookieJar;
  let lockedJar: CookieJar;

  async function createUser(label: string) {
    const email = `it-e10-2-${label}-${tag}@example.com`;
    const { data, error } = await service.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: `IT E10-2 ${label} ${tag}` },
    });
    if (error) throw error;
    createdUsers.push(data.user.id);
    return { id: data.user.id, email };
  }

  async function signedIn(user: { email: string }) {
    const jar = new CookieJar();
    const result = await signInWithPassword(sessionClient(jar), {
      email: user.email,
      password,
    });
    expect(result.ok).toBe(true);
    return jar;
  }

  async function localeOf(id: string) {
    const { data, error } = await service
      .from("profiles")
      .select("locale")
      .eq("id", id)
      .single();
    if (error) throw error;
    return data.locale as string;
  }

  beforeAll(async () => {
    assertLocalSupabase();
    service = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    alice = await createUser("alice");
    bob = await createUser("bob");
    locked = await createUser("locked");
    aliceJar = await signedIn(alice);
    bobJar = await signedIn(bob);
    lockedJar = await signedIn(locked);
    const { error } = await service
      .from("profiles")
      .update({ is_active: false })
      .eq("id", locked.id);
    if (error) throw error;
  });

  afterAll(async () => {
    if (!service) return;
    for (const id of createdUsers) await service.auth.admin.deleteUser(id);
  });

  it("mặc định hồ sơ mới là vi", async () => {
    expect(await localeOf(alice.id)).toBe("vi");
  });

  it("tiêu chí 1: chọn English được lưu vào profiles.locale, phản hồi kèm cookie ngôn ngữ", async () => {
    const res = await patchMe(aliceJar, { locale: "en" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { locale: "en" } });
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toMatch(
      /^qlda_locale=en; Path=\/; Max-Age=\d+; SameSite=Lax$/,
    );
    expect(await localeOf(alice.id)).toBe("en");
    // Người khác không bị ảnh hưởng.
    expect(await localeOf(bob.id)).toBe("vi");

    const back = await patchMe(aliceJar, { locale: "vi" });
    expect(back.status).toBe(200);
    expect(await localeOf(alice.id)).toBe("vi");
  });

  it("chưa đăng nhập: 401; khác origin: 403; không ghi gì", async () => {
    const anon = await patchMe(new CookieJar(), { locale: "en" });
    expect(anon.status).toBe(401);
    const cross = await patchMe(
      bobJar,
      { locale: "en" },
      "https://evil.example",
    );
    expect(cross.status).toBe(403);
    expect(await localeOf(bob.id)).toBe("vi");
  });

  it("schema: trường lạ (is_admin) hay giá trị lạ bị 400, kèm message_key để giao diện dịch", async () => {
    const extra = await patchMe(bobJar, { locale: "en", is_admin: true });
    expect(extra.status).toBe(400);
    const body = (await extra.json()) as ErrorBody;
    expect(body.error.code).toBe("validation_failed");
    expect(body.error.message_key).toBe("api.validationFailed");
    expect(body.error.details).toEqual([
      { field: "is_admin", issue: "unknown_field" },
    ]);
    const bad = await patchMe(bobJar, { locale: "fr" });
    expect(bad.status).toBe(400);
    const { data } = await service
      .from("profiles")
      .select("locale, is_admin")
      .eq("id", bob.id)
      .single();
    expect(data).toEqual({ locale: "vi", is_admin: false });
  });

  it("tài khoản bị khóa: 403, không đổi được", async () => {
    const res = await patchMe(lockedJar, { locale: "en" });
    expect(res.status).toBe(403);
    expect(await localeOf(locked.id)).toBe("vi");
  });

  it("RLS: người khác không đổi được locale của mình kể cả gọi thẳng PostgREST bằng phiên của họ", async () => {
    const { data, error } = await sessionClient(aliceJar)
      .from("profiles")
      .update({ locale: "en" })
      .eq("id", bob.id)
      .select("id");
    // profiles_update_self chỉ cho dòng id = auth.uid(): không dòng nào được cập nhật.
    expect(error).toBeNull();
    expect(data).toEqual([]);
    expect(await localeOf(bob.id)).toBe("vi");
  });

  it("quyền cột: tự sửa locale được nhưng không kèm được cột khác (is_admin)", async () => {
    const { error } = await sessionClient(aliceJar)
      .from("profiles")
      .update({ locale: "en", is_admin: true })
      .eq("id", alice.id);
    expect(error?.code).toBe("42501");
    const { data } = await service
      .from("profiles")
      .select("locale, is_admin")
      .eq("id", alice.id)
      .single();
    expect(data).toEqual({ locale: "vi", is_admin: false });
  });
});
