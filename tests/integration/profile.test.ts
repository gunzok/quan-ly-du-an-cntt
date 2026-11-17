/**
 * Test tích hợp Story E1-7 (QLDA-77) với Supabase cục bộ: GET/PATCH /api/v1/me (lõi Route Handler,
 * client phiên tạo từ hũ cookie) cho tên hiển thị, số điện thoại, ngôn ngữ và vai trò theo dự án;
 * lớp chặn RLS/quyền cột: người khác không sửa được hồ sơ của mình, không tự nâng is_admin.
 *
 * Chạy: make db-start && make test-integration. Tài khoản, dự án tạo tạm với tên ngẫu nhiên, xóa ở
 * afterAll.
 */
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signInWithPassword } from "@/lib/auth/sign-in";
import { handleGetMe, handlePatchMe } from "@/lib/me/handlers";
import type { MeProfile } from "@/lib/me/load";
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
  error: { code: string; details?: { field: string; issue: string }[] };
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

function getMe(jar: CookieJar) {
  return handleGetMe(new Request(new URL("/api/v1/me", APP_ORIGIN)), {
    session: sessionClient(jar),
  });
}

describe.skipIf(!enabled)("Hồ sơ cá nhân /api/v1/me (Supabase cục bộ)", () => {
  const tag = randomUUID().slice(0, 8);
  const password = `It-${randomUUID()}`;
  const createdUsers: string[] = [];
  const createdProjects: string[] = [];
  let service: SupabaseClient;
  const users: Record<string, { id: string; email: string }> = {};
  const jars: Record<string, CookieJar> = {};

  async function createUser(label: string) {
    const email = `it-e1-7-${label}-${tag}@example.com`;
    const { data, error } = await service.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: `IT E1-7 ${label} ${tag}` },
    });
    if (error) throw error;
    createdUsers.push(data.user.id);
    users[label] = { id: data.user.id, email };
  }

  async function signIn(label: string) {
    const jar = new CookieJar();
    const result = await signInWithPassword(sessionClient(jar), {
      email: users[label].email,
      password,
    });
    expect(result.ok).toBe(true);
    jars[label] = jar;
  }

  async function row(label: string) {
    const [{ data: profile, error }, { data: contact }] = await Promise.all([
      service
        .from("profiles")
        .select("full_name, locale, is_admin, is_active, email, department_id")
        .eq("id", users[label].id)
        .single(),
      service
        .from("profile_contacts")
        .select("phone")
        .eq("user_id", users[label].id)
        .maybeSingle(),
    ]);
    if (error) throw error;
    return { ...profile, phone: contact?.phone ?? null };
  }

  beforeAll(async () => {
    assertLocalSupabase();
    service = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    for (const label of ["pm", "member", "viewer", "outsider", "locked"]) {
      await createUser(label);
    }
    const projectA = randomUUID();
    const projectB = randomUUID();
    createdProjects.push(projectA, projectB);
    const projects = await service.from("projects").insert([
      {
        id: projectA,
        name: `IT E1-7 Bê ${tag}`,
        created_by: users.pm.id,
        status: "active",
      },
      {
        id: projectB,
        name: `IT E1-7 An ${tag}`,
        created_by: users.pm.id,
        status: "archived",
      },
    ]);
    if (projects.error) throw projects.error;
    const members = await service.from("project_members").insert([
      { project_id: projectA, user_id: users.member.id, role: "member" },
      { project_id: projectA, user_id: users.viewer.id, role: "viewer" },
      { project_id: projectB, user_id: users.member.id, role: "viewer" },
    ]);
    if (members.error) throw members.error;
    for (const label of Object.keys(users)) await signIn(label);
    const { error } = await service
      .from("profiles")
      .update({ is_active: false })
      .eq("id", users.locked.id);
    if (error) throw error;
  });

  afterAll(async () => {
    if (!service) return;
    for (const id of createdProjects) {
      await service.from("projects").delete().eq("id", id);
    }
    for (const id of createdUsers) await service.auth.admin.deleteUser(id);
  });

  it("GET: hồ sơ của mình, số điện thoại, vai trò theo từng dự án (sắp theo tên)", async () => {
    const res = await getMe(jars.member);
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as { data: MeProfile };
    expect(data).toMatchObject({
      id: users.member.id,
      email: users.member.email,
      full_name: `IT E1-7 member ${tag}`,
      phone: null,
      locale: "vi",
      is_admin: false,
      department: null,
    });
    expect(data.projects).toEqual([
      {
        project_id: createdProjects[1],
        name: `IT E1-7 An ${tag}`,
        status: "archived",
        role: "viewer",
      },
      {
        project_id: createdProjects[0],
        name: `IT E1-7 Bê ${tag}`,
        status: "active",
        role: "member",
      },
    ]);
    const outsider = (await (await getMe(jars.outsider)).json()) as {
      data: MeProfile;
    };
    expect(outsider.data.projects).toEqual([]);
  });

  it("GET: chưa đăng nhập 401, bị khóa 403", async () => {
    expect((await getMe(new CookieJar())).status).toBe(401);
    expect((await getMe(jars.locked)).status).toBe(403);
  });

  it("tiêu chí 1: đổi tên hiển thị được lưu (bỏ khoảng trắng hai đầu)", async () => {
    const res = await patchMe(jars.member, {
      full_name: `  Tên mới ${tag}  `,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      data: { full_name: `Tên mới ${tag}` },
    });
    // Chỉ đổi tên: không ghi cookie ngôn ngữ.
    expect(res.headers.get("set-cookie")).toBeNull();
    expect((await row("member")).full_name).toBe(`Tên mới ${tag}`);
  });

  it("số điện thoại: thêm, sửa, xóa bằng null; sai định dạng 400 không ghi gì", async () => {
    const add = await patchMe(jars.member, { phone: "0900 000 001" });
    expect(add.status).toBe(200);
    expect(await add.json()).toEqual({ data: { phone: "0900 000 001" } });
    expect((await row("member")).phone).toBe("0900 000 001");

    const edit = await patchMe(jars.member, { phone: "+84 900 000 002" });
    expect(edit.status).toBe(200);
    expect((await row("member")).phone).toBe("+84 900 000 002");

    const bad = await patchMe(jars.member, {
      full_name: "Không được ghi",
      phone: "abc",
    });
    expect(bad.status).toBe(400);
    const body = (await bad.json()) as ErrorBody;
    expect(body.error.code).toBe("validation_failed");
    expect(body.error.details).toEqual([
      { field: "phone", issue: "invalid_format" },
    ]);
    const after = await row("member");
    expect(after.phone).toBe("+84 900 000 002");
    expect(after.full_name).toBe(`Tên mới ${tag}`);

    const remove = await patchMe(jars.member, { phone: null });
    expect(remove.status).toBe(200);
    expect(await remove.json()).toEqual({ data: { phone: null } });
    expect((await row("member")).phone).toBeNull();

    // Xóa khi chưa có số: vẫn 200 (idempotent).
    expect((await patchMe(jars.member, { phone: null })).status).toBe(200);
  });

  it("đổi cả tên, số, ngôn ngữ trong một request; đổi ngôn ngữ thì kèm cookie", async () => {
    const res = await patchMe(jars.viewer, {
      full_name: `Người xem ${tag}`,
      phone: "0911 222 333",
      locale: "en",
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      data: {
        full_name: `Người xem ${tag}`,
        phone: "0911 222 333",
        locale: "en",
      },
    });
    expect(res.headers.get("set-cookie")).toMatch(/^qlda_locale=en;/);
    expect(await row("viewer")).toMatchObject({
      full_name: `Người xem ${tag}`,
      phone: "0911 222 333",
      locale: "en",
    });
  });

  it("schema: trường lạ (is_admin, email, is_active, department_id) 400, không ghi gì", async () => {
    for (const extra of [
      { is_admin: true },
      { email: "x@example.com" },
      { is_active: false },
      { department_id: null },
    ]) {
      const res = await patchMe(jars.outsider, {
        full_name: "Thử nâng quyền",
        ...extra,
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as ErrorBody;
      expect(body.error.details).toEqual([
        { field: Object.keys(extra)[0], issue: "unknown_field" },
      ]);
    }
    expect(await row("outsider")).toMatchObject({
      full_name: `IT E1-7 outsider ${tag}`,
      is_admin: false,
      is_active: true,
      email: users.outsider.email,
      department_id: null,
    });
    const empty = await patchMe(jars.outsider, {});
    expect(empty.status).toBe(400);
    const tooLong = await patchMe(jars.outsider, {
      full_name: "a".repeat(101),
    });
    expect(tooLong.status).toBe(400);
  });

  it("chưa đăng nhập 401, khác origin 403, bị khóa 403: không ghi gì", async () => {
    expect((await patchMe(new CookieJar(), { full_name: "x" })).status).toBe(
      401,
    );
    expect(
      (await patchMe(jars.outsider, { full_name: "x" }, "https://evil.example"))
        .status,
    ).toBe(403);
    expect(
      (await patchMe(jars.locked, { full_name: "x", phone: "0900000009" }))
        .status,
    ).toBe(403);
    expect(await row("locked")).toMatchObject({
      full_name: `IT E1-7 locked ${tag}`,
      phone: null,
    });
    expect((await row("outsider")).full_name).toBe(`IT E1-7 outsider ${tag}`);
  });

  it("RLS: người khác (kể cả PM của dự án chung) không sửa được tên, số của mình", async () => {
    const pm = sessionClient(jars.pm);
    const name = await pm
      .from("profiles")
      .update({ full_name: "PM đổi tên hộ" })
      .eq("id", users.member.id)
      .select("id");
    expect(name.error).toBeNull();
    expect(name.data).toEqual([]);
    const phone = await pm
      .from("profile_contacts")
      .update({ phone: "0999 999 999" })
      .eq("user_id", users.viewer.id)
      .select("user_id");
    expect(phone.error).toBeNull();
    expect(phone.data).toEqual([]);
    const insert = await pm
      .from("profile_contacts")
      .insert({ user_id: users.outsider.id, phone: "0999 999 999" });
    expect(insert.error?.code).toBe("42501");
    expect((await row("member")).full_name).toBe(`Tên mới ${tag}`);
    expect((await row("viewer")).phone).toBe("0911 222 333");
    expect((await row("outsider")).phone).toBeNull();
  });

  it("quyền cột: không tự nâng is_admin, không đổi email qua PostgREST", async () => {
    const self = sessionClient(jars.member);
    const admin = await self
      .from("profiles")
      .update({ full_name: "x", is_admin: true })
      .eq("id", users.member.id);
    expect(admin.error?.code).toBe("42501");
    const email = await self
      .from("profiles")
      .update({ email: "khac@example.com" })
      .eq("id", users.member.id);
    expect(email.error?.code).toBe("42501");
    expect(await row("member")).toMatchObject({
      full_name: `Tên mới ${tag}`,
      is_admin: false,
      email: users.member.email,
    });
  });
});
