/**
 * Test tích hợp Story E1-5 (QLDA-39) với Supabase cục bộ: danh mục phòng ban
 * (/api/v1/departments) và lọc người dùng theo phòng ban (GET /api/v1/users?department_id=).
 * Gọi thẳng lõi Route Handler với client phiên tạo từ hũ cookie, nên đi qua đủ: kiểm Origin,
 * getUser, đọc hồ sơ qua RLS, schema, RLS departments, chỉ mục tên không phân biệt hoa thường.
 *
 * Chạy: make db-start && make test-integration. Tài khoản và phòng ban tạo tạm với tên ngẫu nhiên,
 * xóa ở afterAll; không đụng seed.
 */
import { randomUUID } from "node:crypto";
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
import {
  handleCreateDepartment,
  handleListDepartments,
  handlePatchDepartment,
  type DepartmentDeps,
} from "@/lib/departments/handlers";
import type { Department } from "@/lib/departments/model";
import { strings } from "@/lib/strings";
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

let service: SupabaseClient;

function deptDeps(jar: CookieJar): DepartmentDeps {
  return { session: sessionClient(jar) };
}

function userDeps(jar: CookieJar): AdminDeps {
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

interface ErrorBody {
  error: {
    code: string;
    message: string;
    details?: { field: string; issue: string }[];
    request_id?: string;
  };
}

interface TempUser {
  id: string;
  email: string;
}

describe.skipIf(!enabled)("Danh mục phòng ban (Supabase cục bộ)", () => {
  const tag = randomUUID().slice(0, 8);
  const password = `It-${randomUUID()}`;
  const createdUsers: string[] = [];
  const createdDepartments: string[] = [];
  let admin: TempUser;
  let member: TempUser;
  let other: TempUser;
  let locked: TempUser;
  let adminJar: CookieJar;
  let memberJar: CookieJar;
  let lockedJar: CookieJar;
  let deptA: string;
  let deptB: string;

  async function createUser(label: string): Promise<TempUser> {
    const email = `it-e1-5-${label}-${tag}@example.com`;
    const { data, error } = await service.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: `IT E1-5 ${label} ${tag}` },
    });
    if (error) throw error;
    createdUsers.push(data.user.id);
    return { id: data.user.id, email };
  }

  async function signedIn(user: TempUser) {
    const jar = new CookieJar();
    const result = await signInWithPassword(sessionClient(jar), {
      email: user.email,
      password,
    });
    expect(result.ok).toBe(true);
    return jar;
  }

  async function createDept(jar: CookieJar, body: unknown) {
    const res = await handleCreateDepartment(
      send("POST", "/api/v1/departments", body),
      deptDeps(jar),
    );
    if (res.status === 201) {
      const { data } = await json<{ data: Department }>(res.clone());
      createdDepartments.push(data.id);
    }
    return res;
  }

  async function patchDept(
    jar: CookieJar,
    id: string,
    body: unknown,
    origin: string | null = APP_ORIGIN,
  ) {
    return handlePatchDepartment(
      send("PATCH", `/api/v1/departments/${id}`, body, origin),
      id,
      deptDeps(jar),
    );
  }

  async function listDepts(jar: CookieJar, query = "") {
    return handleListDepartments(
      get(`/api/v1/departments${query}`),
      deptDeps(jar),
    );
  }

  /** Tất cả người dùng (qua mọi trang) của GET /api/v1/users với tham số đã cho. */
  async function listUsers(params: Record<string, string>) {
    const users: AdminUser[] = [];
    let cursor: string | null = null;
    do {
      const search = new URLSearchParams({ ...params, limit: "100" });
      if (cursor) search.set("cursor", cursor);
      const res = await handleListUsers(
        get(`/api/v1/users?${search.toString()}`),
        userDeps(adminJar),
      );
      expect(res.status).toBe(200);
      const body = await json<UserListResponse>(res);
      users.push(...body.data);
      cursor = body.next_cursor;
    } while (cursor);
    return users;
  }

  beforeAll(async () => {
    assertLocalSupabase();
    service = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    admin = await createUser("admin");
    member = await createUser("member");
    other = await createUser("other");
    locked = await createUser("locked");
    const { error } = await service
      .from("profiles")
      .update({ is_admin: true })
      .eq("id", admin.id);
    if (error) throw error;

    adminJar = await signedIn(admin);
    memberJar = await signedIn(member);
    // Đăng nhập rồi mới khóa: phiên còn hợp lệ ở Auth nhưng RLS đã chặn.
    lockedJar = await signedIn(locked);
    const lock = await service
      .from("profiles")
      .update({ is_active: false })
      .eq("id", locked.id);
    if (lock.error) throw lock.error;
  });

  afterAll(async () => {
    if (!service) return;
    for (const id of createdUsers) await service.auth.admin.deleteUser(id);
    if (createdDepartments.length > 0) {
      await service.from("departments").delete().in("id", createdDepartments);
    }
  });

  it("chưa đăng nhập: 401 ở mọi endpoint, theo cấu trúc lỗi", async () => {
    const anon = new CookieJar();
    const responses = [
      await listDepts(anon),
      await createDept(anon, { name: `IT không được ${tag}` }),
      await patchDept(anon, randomUUID(), { name: "x" }),
    ];
    for (const res of responses) {
      expect(res.status).toBe(401);
      const body = await json<ErrorBody>(res);
      expect(body.error).toMatchObject({
        code: "unauthenticated",
        message: strings.api.unauthenticated,
      });
      expect(typeof body.error.request_id).toBe("string");
    }
  });

  it("Admin thêm phòng ban: 201 + Location, tên được chuẩn hóa, xếp cuối danh mục", async () => {
    const { data: top } = await service
      .from("departments")
      .select("position")
      .order("position", { ascending: false })
      .limit(1);
    const maxBefore = (top?.[0]?.position as number | undefined) ?? 0;

    const res = await createDept(adminJar, { name: `  IT Phòng   A ${tag} ` });
    expect(res.status).toBe(201);
    const { data } = await json<{ data: Department }>(res);
    deptA = data.id;
    expect(res.headers.get("location")).toBe(`/api/v1/departments/${deptA}`);
    expect(data).toMatchObject({
      name: `IT Phòng A ${tag}`,
      archived: false,
      archived_at: null,
    });

    const res2 = await createDept(adminJar, {
      name: `IT Phòng B ${tag}`,
      position: 7,
    });
    expect(res2.status).toBe(201);
    deptB = (await json<{ data: Department }>(res2)).data.id;

    expect(data.position).toBe(maxBefore + 1);
  });

  it("trùng tên không phân biệt hoa thường: 409 kèm trường name", async () => {
    for (const name of [`it phòng a ${tag}`, `IT PHÒNG A ${tag}`]) {
      const res = await createDept(adminJar, { name });
      expect(res.status).toBe(409);
      const body = await json<ErrorBody>(res);
      expect(body.error).toMatchObject({
        code: "conflict",
        message: strings.departments.errors.nameExists,
        details: [{ field: "name", issue: "invalid_value" }],
      });
    }
    // Đổi tên B thành tên của A (khác hoa thường) cũng 409.
    const res = await patchDept(adminJar, deptB, {
      name: `IT PHÒNG A ${tag}`,
    });
    expect(res.status).toBe(409);
  });

  it("đầu vào sai: 400 validation_failed, từ chối trường lạ", async () => {
    const cases: [unknown, { field: string; issue: string }][] = [
      [{ name: "" }, { field: "name", issue: "required" }],
      [{ name: "x".repeat(101) }, { field: "name", issue: "too_long" }],
      [
        { name: `IT ${tag}`, is_admin: true },
        { field: "is_admin", issue: "unknown_field" },
      ],
    ];
    for (const [body, detail] of cases) {
      const res = await createDept(adminJar, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      const err = await json<ErrorBody>(res);
      expect(err.error.code).toBe("validation_failed");
      expect(err.error.details).toContainEqual(detail);
    }
    const res = await patchDept(adminJar, deptA, { archived: "yes" });
    expect(res.status).toBe(400);
    const bad = await listDepts(adminJar, "?include_archived=1");
    expect(bad.status).toBe(400);
  });

  it("người không phải Admin: đọc được, ghi 403 và không có tác dụng phụ", async () => {
    const list = await listDepts(memberJar);
    expect(list.status).toBe(200);
    const names = (await json<{ data: Department[] }>(list)).data.map(
      (d) => d.id,
    );
    expect(names).toContain(deptA);

    const responses = [
      await createDept(memberJar, { name: `IT Member ${tag}` }),
      await patchDept(memberJar, deptA, { name: `IT đổi ${tag}` }),
      await patchDept(memberJar, deptA, { archived: true }),
    ];
    for (const res of responses) {
      expect(res.status).toBe(403);
      expect((await json<ErrorBody>(res)).error.code).toBe("forbidden");
    }
    const { data } = await service
      .from("departments")
      .select("name, archived_at")
      .eq("id", deptA)
      .single();
    expect(data).toEqual({ name: `IT Phòng A ${tag}`, archived_at: null });
  });

  it("người bị khóa: 403 cả khi đọc", async () => {
    const res = await listDepts(lockedJar);
    expect(res.status).toBe(403);
    expect((await json<ErrorBody>(res)).error.code).toBe("forbidden");
  });

  it("Origin lạ hoặc thiếu: 403 với POST/PATCH", async () => {
    for (const origin of ["https://evil.example", null]) {
      const post = await handleCreateDepartment(
        send("POST", "/api/v1/departments", { name: `IT ${tag}` }, origin),
        deptDeps(adminJar),
      );
      expect(post.status).toBe(403);
      const patch = await patchDept(adminJar, deptA, { name: "x" }, origin);
      expect(patch.status).toBe(403);
    }
  });

  it("PATCH id không tồn tại hoặc sai định dạng: 404", async () => {
    expect(
      (await patchDept(adminJar, randomUUID(), { name: "x" })).status,
    ).toBe(404);
    expect(
      (await patchDept(adminJar, "khong-phai-uuid", { name: "x" })).status,
    ).toBe(404);
  });

  it("tiêu chí 1: thêm phòng ban rồi gán cho người dùng (PATCH và lời mời)", async () => {
    const res = await handlePatchUser(
      send("PATCH", `/api/v1/users/${member.id}`, { department_id: deptA }),
      member.id,
      userDeps(adminJar),
    );
    expect(res.status).toBe(200);
    const { data } = await json<{ data: AdminUser }>(res);
    expect(data.department).toEqual({ id: deptA, name: `IT Phòng A ${tag}` });

    const res2 = await handlePatchUser(
      send("PATCH", `/api/v1/users/${other.id}`, { department_id: deptB }),
      other.id,
      userDeps(adminJar),
    );
    expect(res2.status).toBe(200);
  });

  it("tiêu chí 2: lọc người dùng theo phòng ban, và lọc người chưa có phòng ban", async () => {
    const inA = await listUsers({ department_id: deptA });
    expect(inA.map((u) => u.id)).toEqual([member.id]);

    const inB = await listUsers({ department_id: deptB.toUpperCase() });
    expect(inB.map((u) => u.id)).toEqual([other.id]);

    const none = await listUsers({ department_id: "none" });
    expect(none.every((u) => u.department === null)).toBe(true);
    const noneIds = none.map((u) => u.id);
    expect(noneIds).toContain(admin.id);
    expect(noneIds).not.toContain(member.id);

    // Kết hợp với tìm kiếm.
    const search = await listUsers({
      department_id: deptA,
      q: `other ${tag}`,
    });
    expect(search).toEqual([]);

    const bad = await handleListUsers(
      get("/api/v1/users?department_id=abc"),
      userDeps(adminJar),
    );
    expect(bad.status).toBe(400);
    expect((await json<ErrorBody>(bad)).error.details).toEqual([
      { field: "department_id", issue: "invalid_format" },
    ]);
  });

  it("đổi tên: tên mới hiện ở danh sách người dùng", async () => {
    const res = await patchDept(adminJar, deptA, {
      name: `IT Phòng A2 ${tag}`,
    });
    expect(res.status).toBe(200);
    expect((await json<{ data: Department }>(res)).data.name).toBe(
      `IT Phòng A2 ${tag}`,
    );
    const users = await listUsers({ department_id: deptA });
    expect(users[0]?.department?.name).toBe(`IT Phòng A2 ${tag}`);
  });

  it("lưu trữ: ẩn khỏi danh sách mặc định, người đang thuộc vẫn giữ, không gán mới được", async () => {
    const res = await patchDept(adminJar, deptA, { archived: true });
    expect(res.status).toBe(200);
    const archived = (await json<{ data: Department }>(res)).data;
    expect(archived.archived).toBe(true);
    expect(archived.archived_at).not.toBeNull();

    // Lưu trữ lần nữa giữ nguyên thời điểm.
    const again = await patchDept(adminJar, deptA, { archived: true });
    expect((await json<{ data: Department }>(again)).data.archived_at).toBe(
      archived.archived_at,
    );

    const active = await json<{ data: Department[] }>(
      await listDepts(memberJar),
    );
    expect(active.data.map((d) => d.id)).not.toContain(deptA);
    const all = await json<{ data: Department[] }>(
      await listDepts(memberJar, "?include_archived=true"),
    );
    expect(all.data.find((d) => d.id === deptA)).toMatchObject({
      archived: true,
    });

    expect(
      (await listUsers({ department_id: deptA })).map((u) => u.id),
    ).toEqual([member.id]);

    const assign = await handlePatchUser(
      send("PATCH", `/api/v1/users/${other.id}`, { department_id: deptA }),
      other.id,
      userDeps(adminJar),
    );
    expect(assign.status).toBe(400);
    expect((await json<ErrorBody>(assign)).error).toMatchObject({
      code: "validation_failed",
      message: strings.adminUsers.errors.departmentArchived,
      details: [{ field: "department_id", issue: "invalid_value" }],
    });

    const invite = await handleInviteUser(
      send("POST", "/api/v1/users/invitations", {
        email: `it-e1-5-moi-${tag}@example.com`,
        department_id: deptA,
      }),
      userDeps(adminJar),
    );
    expect(invite.status).toBe(400);
    expect((await json<ErrorBody>(invite)).error.message).toBe(
      strings.adminUsers.errors.departmentArchived,
    );

    const restore = await patchDept(adminJar, deptA, { archived: false });
    expect((await json<{ data: Department }>(restore)).data).toMatchObject({
      archived: false,
      archived_at: null,
    });
  });

  it("Admin không xóa cứng được phòng ban còn người, kể cả gọi thẳng bằng phiên trình duyệt", async () => {
    const { data, error } = await sessionClient(adminJar)
      .from("departments")
      .delete()
      .eq("id", deptA)
      .select("id");
    expect(error).toBeNull();
    expect(data).toEqual([]);
    const { data: still } = await service
      .from("departments")
      .select("id")
      .eq("id", deptA);
    expect(still).toHaveLength(1);
  });
});
