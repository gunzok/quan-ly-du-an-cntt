/**
 * Test tích hợp Story E1-4 (QLDA-36) với Supabase cục bộ: API quản trị người dùng.
 * Gọi thẳng lõi Route Handler (lib/admin/users/handlers.ts) với client phiên tạo từ hũ cookie
 * (giống trình duyệt) và client service_role, nên đi qua đủ: kiểm Origin, getUser, đọc is_admin
 * qua RLS, schema, hàm CSDL, Supabase Auth (mời, ban), Mailpit.
 *
 * Chạy: make db-start && make test-integration. Thiếu SUPABASE_URL... thì cả nhóm BỎ QUA có
 * thông báo (tests/integration/global-setup.ts). Chỉ chấp nhận URL localhost.
 * Tài khoản, phòng ban, dự án tạo tạm với email ngẫu nhiên và xóa ở afterAll; không đụng seed.
 *
 * Ca "không thu quyền Admin cuối cùng" cần hệ thống chỉ có đúng một Admin, không dựng được trên
 * stack dùng chung (tài khoản seed admin@example.com là Admin): kiểm ở pgTAP
 * supabase/tests/database/admin-users.test.sql (trong giao dịch, rollback).
 */
import { randomUUID } from "node:crypto";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  handleInviteUser,
  handleListUsers,
  handlePatchUser,
  type AdminDeps,
} from "@/lib/admin/users/handlers";
import type { AdminUser, UserListResponse } from "@/lib/admin/users/model";
import { signInWithPassword } from "@/lib/auth/sign-in";
import { strings } from "@/lib/strings";
import { sessionCookieOptions } from "@/lib/supabase/cookie-options";
import { missingIntegrationEnv } from "./env";

const enabled = missingIntegrationEnv().length === 0;

const SUPABASE_URL = process.env.SUPABASE_URL ?? "";
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? "";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const MAILPIT_URL = process.env.MAILPIT_URL ?? "";
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
}

function sessionClient(jar: CookieJar) {
  return createServerClient(SUPABASE_URL, ANON_KEY, {
    cookieOptions: sessionCookieOptions(),
    cookies: {
      getAll: () => jar.getAll(),
      setAll: (list) => list.forEach((c) => jar.set(c)),
    },
  });
}

let service: SupabaseClient;

function deps(jar: CookieJar): AdminDeps {
  return { session: sessionClient(jar), service: () => service };
}

function get(path: string) {
  return new Request(new URL(path, APP_ORIGIN));
}

function send(
  method: "POST" | "PATCH",
  path: string,
  body: unknown,
  origin: string | null = APP_ORIGIN,
) {
  const headers = new Headers({ "content-type": "application/json" });
  if (origin) headers.set("origin", origin);
  return new Request(new URL(path, APP_ORIGIN), {
    method,
    headers,
    body: JSON.stringify(body),
  });
}

async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

interface TempUser {
  id: string;
  email: string;
  password: string;
}

describe.skipIf(!enabled)("Admin quản trị người dùng (Supabase cục bộ)", () => {
  const tag = randomUUID().slice(0, 8);
  const password = `It-${randomUUID()}`;
  const created: string[] = [];
  let adminA: TempUser;
  let adminB: TempUser;
  let member: TempUser;
  let departmentId: string;
  let projectId: string;
  let adminJar: CookieJar;
  let memberJar: CookieJar;

  async function createUser(
    label: string,
    fullName: string,
  ): Promise<TempUser> {
    const email = `it-e1-4-${label}-${tag}@example.com`;
    const { data, error } = await service.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    });
    if (error) throw error;
    created.push(data.user.id);
    return { id: data.user.id, email, password };
  }

  async function signIn(user: TempUser) {
    const jar = new CookieJar();
    const result = await signInWithPassword(sessionClient(jar), {
      email: user.email,
      password: user.password,
    });
    return { jar, result };
  }

  async function signedIn(user: TempUser) {
    const { jar, result } = await signIn(user);
    expect(result.ok).toBe(true);
    return jar;
  }

  async function patch(jar: CookieJar, id: string, body: unknown) {
    return handlePatchUser(
      send("PATCH", `/api/v1/users/${id}`, body),
      id,
      deps(jar),
    );
  }

  async function profileOf(id: string) {
    const { data, error } = await service
      .from("profiles")
      .select("is_admin, is_active, department_id")
      .eq("id", id)
      .single();
    if (error) throw error;
    return data;
  }

  beforeAll(async () => {
    const host = new URL(SUPABASE_URL).hostname;
    if (!["127.0.0.1", "localhost", "::1"].includes(host)) {
      throw new Error(
        `Test tích hợp chỉ chạy với Supabase cục bộ, từ chối ${host}`,
      );
    }
    process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE_URL;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = ANON_KEY;
    service = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    adminA = await createUser("admin-a", `IT Admin A ${tag}`);
    adminB = await createUser("admin-b", `IT Admin B ${tag}`);
    member = await createUser("member", `IT Thành viên ${tag}`);
    const { error: adminError } = await service
      .from("profiles")
      .update({ is_admin: true })
      .in("id", [adminA.id, adminB.id]);
    if (adminError) throw adminError;

    const dept = await service
      .from("departments")
      .insert({ name: `IT Phòng ${tag}` })
      .select("id")
      .single();
    if (dept.error) throw dept.error;
    departmentId = dept.data.id as string;

    projectId = randomUUID();
    const project = await service
      .from("projects")
      .insert({
        id: projectId,
        name: `IT Dự án ${tag}`,
        created_by: member.id,
      });
    if (project.error) throw project.error;

    adminJar = await signedIn(adminA);
    memberJar = await signedIn(member);
  });

  afterAll(async () => {
    if (!service) return;
    if (projectId) await service.from("projects").delete().eq("id", projectId);
    for (const id of created) await service.auth.admin.deleteUser(id);
    if (departmentId)
      await service.from("departments").delete().eq("id", departmentId);
  });

  it("chưa đăng nhập: 401 ở mọi endpoint, theo cấu trúc lỗi", async () => {
    const anon = new CookieJar();
    const responses = [
      await handleListUsers(get("/api/v1/users"), deps(anon)),
      await handleInviteUser(
        send("POST", "/api/v1/users/invitations", {
          email: `x-${tag}@example.com`,
        }),
        deps(anon),
      ),
      await patch(anon, member.id, { is_active: false }),
    ];
    for (const res of responses) {
      expect(res.status).toBe(401);
      const body = await json<{ error: Record<string, unknown> }>(res);
      expect(body.error).toMatchObject({
        code: "unauthenticated",
        message: strings.api.unauthenticated,
      });
      expect(typeof body.error.request_id).toBe("string");
    }
  });

  it("người không phải Admin: 403 ở mọi endpoint và không có tác dụng phụ", async () => {
    const inviteEmail = `it-e1-4-khong-duoc-${tag}@example.com`;
    const responses = [
      await handleListUsers(get("/api/v1/users"), deps(memberJar)),
      await handleInviteUser(
        send("POST", "/api/v1/users/invitations", { email: inviteEmail }),
        deps(memberJar),
      ),
      await patch(memberJar, adminA.id, { is_active: false }),
      await patch(memberJar, member.id, { is_admin: true }),
    ];
    for (const res of responses) {
      expect(res.status).toBe(403);
      expect((await json<{ error: { code: string } }>(res)).error.code).toBe(
        "forbidden",
      );
    }
    expect(await profileOf(adminA.id)).toMatchObject({ is_active: true });
    expect(await profileOf(member.id)).toMatchObject({ is_admin: false });
    const { data } = await service
      .from("profiles")
      .select("id")
      .eq("email", inviteEmail);
    expect(data).toEqual([]);
  });

  it("Origin lạ hoặc thiếu: 403 trước cả khi kiểm phiên", async () => {
    for (const origin of ["https://evil.example", null]) {
      const res = await handleInviteUser(
        send(
          "POST",
          "/api/v1/users/invitations",
          { email: `o-${tag}@example.com` },
          origin,
        ),
        deps(adminJar),
      );
      expect(res.status).toBe(403);
      const res2 = await handlePatchUser(
        send(
          "PATCH",
          `/api/v1/users/${member.id}`,
          { is_active: false },
          origin,
        ),
        member.id,
        deps(adminJar),
      );
      expect(res2.status).toBe(403);
    }
    expect(await profileOf(member.id)).toMatchObject({ is_active: true });
  });

  it("Admin liệt kê: có phòng ban, số dự án, tìm theo tên/email, phân trang cursor", async () => {
    await patch(adminJar, member.id, { department_id: departmentId });

    const res = await handleListUsers(
      get(`/api/v1/users?q=${tag}`),
      deps(adminJar),
    );
    expect(res.status).toBe(200);
    const body = await json<UserListResponse>(res);
    expect(body.data.map((u) => u.email).sort()).toEqual(
      [adminA.email, adminB.email, member.email].sort(),
    );
    const m = body.data.find((u) => u.id === member.id);
    expect(m).toMatchObject({
      department: { id: departmentId, name: `IT Phòng ${tag}` },
      project_count: 1,
      pm_project_count: 1,
      is_admin: false,
      status: "active",
    });
    expect(m?.last_sign_in_at).not.toBeNull();

    const byName = await json<UserListResponse>(
      await handleListUsers(
        get(`/api/v1/users?q=${encodeURIComponent(`thành viên ${tag}`)}`),
        deps(adminJar),
      ),
    );
    expect(byName.data.map((u) => u.id)).toEqual([member.id]);

    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const qs: string = `q=${tag}&limit=1${cursor ? `&cursor=${cursor}` : ""}`;
      const page = await json<UserListResponse>(
        await handleListUsers(get(`/api/v1/users?${qs}`), deps(adminJar)),
      );
      expect(page.data.length).toBeLessThanOrEqual(1);
      seen.push(...page.data.map((u) => u.id));
      cursor = page.next_cursor;
    } while (cursor && seen.length < 10);
    expect(seen.sort()).toEqual([adminA.id, adminB.id, member.id].sort());

    const bad = await handleListUsers(
      get("/api/v1/users?la=1"),
      deps(adminJar),
    );
    expect(bad.status).toBe(400);
    expect(await json(bad)).toMatchObject({
      error: {
        code: "validation_failed",
        details: [{ field: "la", issue: "unknown_field" }],
      },
    });
  });

  it("Admin mời: 201, tài khoản ở trạng thái chờ, có phòng ban, email tới Mailpit; mời lại khi chờ 200, email đã dùng 409", async () => {
    const email = `it-e1-4-moi-${tag}@example.com`;
    const res = await handleInviteUser(
      send("POST", "/api/v1/users/invitations", {
        email: email.toUpperCase(),
        full_name: `IT Được mời ${tag}`,
        department_id: departmentId,
      }),
      deps(adminJar),
    );
    expect(res.status).toBe(201);
    const { data: user } = await json<{ data: AdminUser }>(res);
    created.push(user.id);
    expect(res.headers.get("location")).toBe(`/api/v1/users/${user.id}`);
    expect(user).toMatchObject({
      email,
      full_name: `IT Được mời ${tag}`,
      status: "invited",
      is_admin: false,
      is_active: true,
      department: { id: departmentId },
      last_sign_in_at: null,
    });
    expect(user.invited_at).not.toBeNull();

    if (MAILPIT_URL) {
      let total = 0;
      for (let i = 0; i < 20 && total === 0; i++) {
        const r = await fetch(
          `${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`,
        );
        total =
          ((await r.json()) as { messages_count?: number; total?: number })
            .messages_count ?? 0;
        if (total === 0) await new Promise((ok) => setTimeout(ok, 250));
      }
      expect(total).toBeGreaterThan(0);
    }

    // Vẫn đang chờ: gửi lại lời mời (200), không tạo tài khoản thứ hai.
    const again = await handleInviteUser(
      send("POST", "/api/v1/users/invitations", { email }),
      deps(adminJar),
    );
    expect(again.status).toBe(200);
    expect((await json<{ data: AdminUser }>(again)).data.id).toBe(user.id);

    // Email đã có tài khoản đang dùng: 409.
    const taken = await handleInviteUser(
      send("POST", "/api/v1/users/invitations", { email: member.email }),
      deps(adminJar),
    );
    expect(taken.status).toBe(409);
    expect(await json(taken)).toMatchObject({
      error: {
        code: "conflict",
        message: strings.adminUsers.errors.emailExists,
      },
    });

    const strange = await handleInviteUser(
      send("POST", "/api/v1/users/invitations", {
        email: `s-${tag}@example.com`,
        is_admin: true,
      }),
      deps(adminJar),
    );
    expect(strange.status).toBe(400);
    expect(await json(strange)).toMatchObject({
      error: { details: [{ field: "is_admin", issue: "unknown_field" }] },
    });

    const noDept = await handleInviteUser(
      send("POST", "/api/v1/users/invitations", {
        email: `d-${tag}@example.com`,
        department_id: randomUUID(),
      }),
      deps(adminJar),
    );
    expect(noDept.status).toBe(400);
  });

  it("khóa: không đăng nhập được, phiên cũ mất hiệu lực, lịch sử giữ nguyên; mở khóa: đăng nhập lại được", async () => {
    const oldJar = await signedIn(member);

    const locked = await patch(adminJar, member.id, { is_active: false });
    expect(locked.status).toBe(200);
    expect((await json<{ data: AdminUser }>(locked)).data).toMatchObject({
      is_active: false,
      status: "locked",
    });

    const { result } = await signIn(member);
    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "unauthenticated",
        message: strings.errors.invalidCredentials,
      },
    });

    // Phiên đã có trước khi khóa: không còn dùng được (Auth từ chối người bị cấm).
    const { data: stale } = await sessionClient(oldJar).auth.getUser();
    expect(stale.user).toBeNull();

    // Lịch sử giữ: hồ sơ và tư cách thành viên dự án vẫn còn.
    const { data: membership } = await service
      .from("project_members")
      .select("role")
      .eq("project_id", projectId)
      .eq("user_id", member.id);
    expect(membership).toEqual([{ role: "pm" }]);

    const unlocked = await patch(adminJar, member.id, { is_active: true });
    expect(unlocked.status).toBe(200);
    expect((await json<{ data: AdminUser }>(unlocked)).data.status).toBe(
      "active",
    );
    memberJar = await signedIn(member);
  });

  it("cấp Admin: người đó dùng được API quản trị; thu quyền: lại 403", async () => {
    const granted = await patch(adminJar, member.id, { is_admin: true });
    expect(granted.status).toBe(200);
    expect((await json<{ data: AdminUser }>(granted)).data.is_admin).toBe(true);
    expect(
      (await handleListUsers(get(`/api/v1/users?q=${tag}`), deps(memberJar)))
        .status,
    ).toBe(200);

    const revoked = await patch(adminJar, member.id, { is_admin: false });
    expect(revoked.status).toBe(200);
    expect((await json<{ data: AdminUser }>(revoked)).data.is_admin).toBe(
      false,
    );
    expect(
      (await handleListUsers(get(`/api/v1/users?q=${tag}`), deps(memberJar)))
        .status,
    ).toBe(403);
  });

  it("Admin không tự khóa, không tự thu quyền Admin (409); Admin khác thì được", async () => {
    const selfLock = await patch(adminJar, adminA.id, { is_active: false });
    expect(selfLock.status).toBe(409);
    expect(await json(selfLock)).toMatchObject({
      error: { code: "conflict", message: strings.adminUsers.errors.selfLock },
    });
    const selfRevoke = await patch(adminJar, adminA.id, { is_admin: false });
    expect(selfRevoke.status).toBe(409);
    expect(await profileOf(adminA.id)).toMatchObject({
      is_admin: true,
      is_active: true,
    });
    expect((await signIn(adminA)).result.ok).toBe(true);

    const revokeOther = await patch(adminJar, adminB.id, { is_admin: false });
    expect(revokeOther.status).toBe(200);
    // adminB vừa mất quyền: không thu ngược quyền của adminA được.
    const adminBJar = await signedIn(adminB);
    expect(
      (await patch(adminBJar, adminA.id, { is_admin: false })).status,
    ).toBe(403);
  });

  it("PATCH sai đầu vào: id không phải UUID 404, người không tồn tại 404, trường lạ 400", async () => {
    expect(
      (await patch(adminJar, "khong-phai-uuid", { is_active: false })).status,
    ).toBe(404);
    expect(
      (await patch(adminJar, randomUUID(), { is_active: false })).status,
    ).toBe(404);
    const strange = await patch(adminJar, member.id, {
      is_active: false,
      email: "x@y.vn",
    });
    expect(strange.status).toBe(400);
    expect(await profileOf(member.id)).toMatchObject({ is_active: true });
  });
});
