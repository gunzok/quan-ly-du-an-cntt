/**
 * Test tích hợp Story E1-6 (QLDA-33) với Supabase cục bộ: API thành viên dự án và tìm người.
 * Gọi thẳng lõi Route Handler với client phiên tạo từ hũ cookie (giống trình duyệt): đi qua Origin,
 * getUser, vai trò qua RLS, schema, hàm set_project_member() và trigger PM cuối cùng.
 *
 * Chạy: make db-start && make test-integration. Tài khoản và dự án tạo tạm, xóa ở afterAll.
 */
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signInWithPassword } from "@/lib/auth/sign-in";
import {
  handleDeleteMember,
  handleGetMember,
  handleListMembers,
  handlePutMember,
  handleSearchUsers,
  type MemberDeps,
} from "@/lib/project-members/handlers";
import type { ProjectMember, UserCandidate } from "@/lib/project-members/model";
import { handleListProjects } from "@/lib/projects/handlers";
import type { ProjectListResponse } from "@/lib/projects/model";
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
const t = strings.projectMembers.errors;

let service: SupabaseClient;

function deps(jar: CookieJar): MemberDeps {
  return { session: sessionClient(jar) };
}

function get(path: string) {
  return new Request(new URL(path, APP_ORIGIN));
}

function send(
  method: "PUT" | "DELETE",
  path: string,
  body?: unknown,
  origin: string | null = APP_ORIGIN,
  contentType = "application/json",
) {
  const headers = new Headers();
  if (body !== undefined) headers.set("content-type", contentType);
  if (origin) headers.set("origin", origin);
  return new Request(new URL(path, APP_ORIGIN), {
    method,
    headers,
    body:
      body === undefined
        ? undefined
        : typeof body === "string"
          ? body
          : JSON.stringify(body),
  });
}

interface ErrorBody {
  error: {
    code: string;
    message: string;
    details?: { field: string; issue: string }[];
    request_id: string;
  };
}

async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

async function expectError(res: Response, status: number, code: string) {
  expect(res.status).toBe(status);
  const body = await json<ErrorBody>(res);
  expect(body.error.code).toBe(code);
  expect(body.error.request_id.length).toBeGreaterThan(0);
  return body.error;
}

describe.skipIf(!enabled)("API thành viên dự án (Supabase cục bộ)", () => {
  const tag = randomUUID().slice(0, 8);
  const password = `It-${randomUUID()}`;
  const created: string[] = [];
  const users: Record<string, string> = {};
  const jars: Record<string, CookieJar> = {};
  let projectA: string;
  let projectB: string;

  const email = (label: string) => `it-e1-6-${label}-${tag}@example.com`;

  async function createUser(label: string) {
    const { data, error } = await service.auth.admin.createUser({
      email: email(label),
      password,
      email_confirm: true,
      user_metadata: { full_name: `IT ${label} ${tag}` },
    });
    if (error) throw error;
    created.push(data.user.id);
    users[label] = data.user.id;
  }

  async function signIn(label: string) {
    const jar = new CookieJar();
    const result = await signInWithPassword(sessionClient(jar), {
      email: email(label),
      password,
    });
    expect(result.ok).toBe(true);
    jars[label] = jar;
  }

  const listRes = (who: string, projectId = projectA, qs = "") =>
    handleListMembers(
      get(`/api/v1/projects/${projectId}/members${qs}`),
      projectId,
      deps(jars[who]),
    );
  const put = (
    who: string,
    userId: string,
    body: unknown,
    opts: {
      projectId?: string;
      origin?: string | null;
      contentType?: string;
    } = {},
  ) => {
    const projectId = opts.projectId ?? projectA;
    return handlePutMember(
      send(
        "PUT",
        `/api/v1/projects/${projectId}/members/${userId}`,
        body,
        opts.origin === undefined ? APP_ORIGIN : opts.origin,
        opts.contentType,
      ),
      projectId,
      userId,
      deps(jars[who]),
    );
  };
  const remove = (
    who: string,
    userId: string,
    opts: { projectId?: string; origin?: string | null } = {},
  ) => {
    const projectId = opts.projectId ?? projectA;
    return handleDeleteMember(
      send(
        "DELETE",
        `/api/v1/projects/${projectId}/members/${userId}`,
        undefined,
        opts.origin === undefined ? APP_ORIGIN : opts.origin,
      ),
      projectId,
      userId,
      deps(jars[who]),
    );
  };
  const search = (who: string, qs: string) =>
    handleSearchUsers(get(`/api/v1/users/search?${qs}`), deps(jars[who]));

  async function members(who = "pm", projectId = projectA) {
    const res = await listRes(who, projectId);
    expect(res.status).toBe(200);
    return (await json<{ data: ProjectMember[] }>(res)).data;
  }
  async function roleInDb(userId: string, projectId = projectA) {
    const { data, error } = await service
      .from("project_members")
      .select("role")
      .eq("project_id", projectId)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw error;
    return (data?.role as string | undefined) ?? null;
  }
  async function setRole(userId: string, role: string) {
    const { error } = await service
      .from("project_members")
      .update({ role })
      .eq("project_id", projectA)
      .eq("user_id", userId);
    if (error) throw error;
  }
  async function activePms(projectId = projectA) {
    return (await members("admin", projectId))
      .filter((m) => m.role === "pm" && m.user.is_active)
      .map((m) => m.user_id);
  }

  beforeAll(async () => {
    assertLocalSupabase();
    service = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    for (const label of [
      "admin",
      "pm",
      "pm2",
      "member",
      "viewer",
      "outsider",
      "newbie",
      "locked",
    ]) {
      await createUser(label);
    }
    const { error: adminError } = await service
      .from("profiles")
      .update({ is_admin: true })
      .eq("id", users.admin);
    if (adminError) throw adminError;
    const dept = await service
      .from("departments")
      .insert({ name: `IT E1-6 Phòng ${tag}` })
      .select("id")
      .single();
    if (dept.error) throw dept.error;
    const { error: deptError } = await service
      .from("profiles")
      .update({ department_id: dept.data.id })
      .eq("id", users.member);
    if (deptError) throw deptError;

    projectA = randomUUID();
    projectB = randomUUID();
    const projects = await service.from("projects").insert([
      { id: projectA, name: `IT E1-6 A ${tag}`, created_by: users.pm },
      { id: projectB, name: `IT E1-6 B ${tag}`, created_by: users.pm2 },
    ]);
    if (projects.error) throw projects.error;
    const rows = await service.from("project_members").insert([
      { project_id: projectA, user_id: users.member, role: "member" },
      { project_id: projectA, user_id: users.viewer, role: "viewer" },
    ]);
    if (rows.error) throw rows.error;

    for (const label of Object.keys(users)) await signIn(label);
    const { error: lockError } = await service
      .from("profiles")
      .update({ is_active: false })
      .eq("id", users.locked);
    if (lockError) throw lockError;
  });

  afterAll(async () => {
    if (!service) return;
    for (const id of [projectA, projectB]) {
      if (id) await service.from("projects").delete().eq("id", id);
    }
    for (const id of created) await service.auth.admin.deleteUser(id);
    await service
      .from("departments")
      .delete()
      .eq("name", `IT E1-6 Phòng ${tag}`);
  });

  it("chưa đăng nhập: 401 ở mọi endpoint", async () => {
    jars.anon = new CookieJar();
    for (const res of [
      await listRes("anon"),
      await put("anon", users.newbie, { role: "member" }),
      await remove("anon", users.member),
      await search("anon", "q=it-e1-6"),
      await handleGetMember(
        get(`/api/v1/projects/${projectA}/members/${users.pm}`),
        projectA,
        users.pm,
        deps(jars.anon),
      ),
    ]) {
      await expectError(res, 401, "unauthenticated");
    }
  });

  it("ghi không có Origin hoặc khác Origin: 403 trước cả phiên", async () => {
    await expectError(
      await put("pm", users.newbie, { role: "member" }, { origin: null }),
      403,
      "forbidden",
    );
    await expectError(
      await remove("pm", users.member, { origin: "https://evil.example" }),
      403,
      "forbidden",
    );
    expect(await roleInDb(users.newbie)).toBeNull();
    expect(await roleInDb(users.member)).toBe("member");
  });

  it("người ngoài dự án: 404 ở mọi endpoint, không lộ dự án", async () => {
    await expectError(await listRes("outsider"), 404, "not_found");
    // pm2 là PM của dự án B nhưng không thuộc A: vẫn 404 (không phải 403).
    await expectError(
      await put("pm2", users.pm2, { role: "pm" }),
      404,
      "not_found",
    );
    await expectError(await remove("pm2", users.member), 404, "not_found");
    await expectError(
      await listRes("pm", "not-a-uuid" as string),
      404,
      "not_found",
    );
    expect(await roleInDb(users.pm2)).toBeNull();
  });

  it("mọi vai trò trong dự án đọc được danh sách: PM trước, có email và phòng ban", async () => {
    for (const who of ["pm", "member", "viewer", "admin"]) {
      const list = await members(who);
      expect(list.map((m) => [m.user_id, m.role])).toEqual([
        [users.pm, "pm"],
        [users.member, "member"],
        [users.viewer, "viewer"],
      ]);
    }
    const [, member] = await members("viewer");
    expect(member.user).toMatchObject({
      id: users.member,
      full_name: `IT member ${tag}`,
      email: email("member"),
      is_active: true,
      department: { name: `IT E1-6 Phòng ${tag}` },
    });
    await expectError(
      await listRes("pm", projectA, "?limit=5"),
      400,
      "validation_failed",
    );
  });

  it("AC2: Thành viên và Người xem không gán vai trò, không thêm, không gỡ (403)", async () => {
    for (const who of ["member", "viewer"]) {
      const err = await expectError(
        await put(who, users.newbie, { role: "member" }),
        403,
        "forbidden",
      );
      expect(err.message).toBe(t.forbidden);
      await expectError(
        await put(who, users[who], { role: "pm" }),
        403,
        "forbidden",
      );
      await expectError(await remove(who, users.viewer), 403, "forbidden");
      // Vai trò kiểm trước schema: thân sai vẫn 403.
      await expectError(
        await put(who, "x", { role: "boss" }),
        403,
        "forbidden",
      );
    }
    expect(await roleInDb(users.newbie)).toBeNull();
    expect(await roleInDb(users.member)).toBe("member");
    expect(await roleInDb(users.viewer)).toBe("viewer");
  });

  it("AC1: PM thêm người, người đó thấy dự án với đúng vai trò; PUT lặp lại 200, đổi vai trò 200", async () => {
    const res = await put("pm", users.newbie, { role: "viewer" });
    expect(res.status).toBe(201);
    expect(res.headers.get("location")).toBe(
      `/api/v1/projects/${projectA}/members/${users.newbie}`,
    );
    const body = await json<{ data: ProjectMember }>(res);
    expect(body.data).toMatchObject({
      user_id: users.newbie,
      role: "viewer",
      user: { email: email("newbie"), is_active: true },
    });

    const myProjects = async () => {
      const r = await handleListProjects(get(`/api/v1/projects?q=${tag}`), {
        session: sessionClient(jars.newbie),
      });
      expect(r.status).toBe(200);
      return (await json<ProjectListResponse>(r)).data.map((p) => [
        p.id,
        p.my_role,
      ]);
    };
    expect(await myProjects()).toEqual([[projectA, "viewer"]]);
    // Người được thêm cũng đọc được danh sách thành viên và đích của Location.
    const one = await handleGetMember(
      get(`/api/v1/projects/${projectA}/members/${users.newbie}`),
      projectA,
      users.newbie,
      deps(jars.newbie),
    );
    expect(one.status).toBe(200);
    expect((await json<{ data: ProjectMember }>(one)).data.role).toBe("viewer");

    // Lặp lại cùng vai trò: 200, không thêm dòng, không đổi joined_at.
    const again = await put("pm", users.newbie, { role: "viewer" });
    expect(again.status).toBe(200);
    expect(again.headers.get("location")).toBeNull();
    const againBody = await json<{ data: ProjectMember }>(again);
    expect(againBody.data.joined_at).toBe(body.data.joined_at);

    const changed = await put("pm", users.newbie, { role: "member" });
    expect(changed.status).toBe(200);
    expect((await json<{ data: ProjectMember }>(changed)).data.role).toBe(
      "member",
    );
    expect(await myProjects()).toEqual([[projectA, "member"]]);
  });

  it("schema: user_id sai, vai trò sai, trường lạ, thân không phải JSON: 400", async () => {
    const e = await expectError(
      await put("pm", "abc", { role: "member" }),
      400,
      "validation_failed",
    );
    expect(e.details).toEqual([{ field: "user_id", issue: "invalid_format" }]);
    for (const body of [
      { role: "admin" },
      {},
      { role: "member", project_id: projectB },
      [],
    ]) {
      await expectError(
        await put("pm", users.outsider, body),
        400,
        "validation_failed",
      );
    }
    await expectError(
      await put("pm", users.outsider, "role=pm", {
        contentType: "text/plain",
      }),
      400,
      "validation_failed",
    );
    expect(await roleInDb(users.outsider)).toBeNull();
  });

  it("người đích bị khóa hoặc không tồn tại: 422", async () => {
    for (const id of [users.locked, randomUUID()]) {
      const e = await expectError(
        await put("pm", id, { role: "member" }),
        422,
        "business_rule_violated",
      );
      expect(e.message).toBe(t.userInactive);
      expect(e.details).toEqual([{ field: "user_id", issue: "invalid_value" }]);
    }
    expect(await roleInDb(users.locked)).toBeNull();
  });

  it("PM cuối cùng: không tự hạ, không tự rời; Admin và service_role cũng bị chặn (409)", async () => {
    for (const res of [
      await put("pm", users.pm, { role: "member" }),
      await remove("pm", users.pm),
      await put("admin", users.pm, { role: "viewer" }),
      await remove("admin", users.pm),
    ]) {
      const e = await expectError(res, 409, "conflict");
      expect(e.message).toBe(t.lastPm);
    }
    const viaService = await service
      .from("project_members")
      .delete()
      .eq("project_id", projectA)
      .eq("user_id", users.pm);
    expect(viaService.error?.message).toBe("last_project_pm");
    expect(await roleInDb(users.pm)).toBe("pm");
  });

  it("đổi vai trò chính mình khi còn PM khác: được, rồi mất quyền ghi", async () => {
    expect((await put("pm", users.member, { role: "pm" })).status).toBe(200);
    expect((await put("pm", users.pm, { role: "member" })).status).toBe(200);
    // Không còn là PM: ghi bị 403.
    await expectError(
      await put("pm", users.newbie, { role: "viewer" }),
      403,
      "forbidden",
    );
    // PM mới trả lại vai trò, rồi PM cũ hạ PM mới về Thành viên.
    expect((await put("member", users.pm, { role: "pm" })).status).toBe(200);
    expect((await put("pm", users.member, { role: "member" })).status).toBe(
      200,
    );
    expect(await activePms()).toEqual([users.pm]);
  });

  it("chống đua: hai PM hạ nhau hoặc cùng tự hạ cùng lúc, luôn còn đúng một PM", async () => {
    for (let round = 0; round < 3; round++) {
      await setRole(users.member, "pm");
      const crossed = await Promise.all([
        put("pm", users.member, { role: "member" }),
        put("member", users.pm, { role: "member" }),
      ]);
      const codes = crossed.map((r) => r.status).sort();
      expect(codes[0]).toBe(200);
      expect([403, 409]).toContain(codes[1]);
      expect((await activePms()).length).toBe(1);
      // Đưa về trạng thái chuẩn: pm là PM duy nhất.
      if ((await roleInDb(users.pm)) !== "pm") {
        await setRole(users.pm, "pm");
      }
      await setRole(users.member, "member");

      await setRole(users.member, "pm");
      const selves = await Promise.all([
        put("pm", users.pm, { role: "member" }),
        put("member", users.member, { role: "member" }),
      ]);
      expect(selves.map((r) => r.status).sort()).toEqual([200, 409]);
      expect((await activePms()).length).toBe(1);
      if ((await roleInDb(users.pm)) !== "pm") {
        await setRole(users.pm, "pm");
      }
      await setRole(users.member, "member");
    }
    expect(await activePms()).toEqual([users.pm]);
  });

  it("gỡ thành viên: 204, người đó mất quyền xem; task giữ assignee_id cũ; gỡ lại 404", async () => {
    const task = await service
      .from("tasks")
      .insert({
        project_id: projectA,
        title: `IT E1-6 task ${tag}`,
        created_by: users.pm,
        assignee_id: users.newbie,
      })
      .select("id")
      .single();
    if (task.error) throw task.error;

    const res = await remove("pm", users.newbie);
    expect(res.status).toBe(204);
    await expectError(await listRes("newbie"), 404, "not_found");
    const { data: after } = await service
      .from("tasks")
      .select("assignee_id")
      .eq("id", task.data.id)
      .single();
    expect(after?.assignee_id).toBe(users.newbie);

    await expectError(await remove("pm", users.newbie), 404, "not_found");
    await expectError(await remove("pm", "abc"), 404, "not_found");
  });

  it("Admin không thuộc dự án vẫn thêm, đổi, gỡ được", async () => {
    expect(
      (await put("admin", users.outsider, { role: "viewer" })).status,
    ).toBe(201);
    expect(await roleInDb(users.outsider)).toBe("viewer");
    expect((await remove("admin", users.outsider)).status).toBe(204);
    expect(await roleInDb(users.outsider)).toBeNull();
  });

  describe("GET /api/v1/users/search", () => {
    it("PM tìm theo họ tên/email; chỉ trả id, họ tên, email, phòng ban; không lộ người bị khóa", async () => {
      const res = await search("pm", `q=${tag}`);
      expect(res.status).toBe(200);
      const { data } = await json<{ data: UserCandidate[] }>(res);
      const ids = data.map((u) => u.id);
      expect(ids).toContain(users.outsider);
      expect(ids).toContain(users.member);
      expect(ids).not.toContain(users.locked);
      for (const u of data) {
        expect(Object.keys(u).sort()).toEqual([
          "department",
          "email",
          "full_name",
          "id",
        ]);
      }
      expect(data.find((u) => u.id === users.member)?.department?.name).toBe(
        `IT E1-6 Phòng ${tag}`,
      );
      // Tìm theo email, không phân biệt hoa thường.
      const byEmail = await json<{ data: UserCandidate[] }>(
        await search(
          "pm",
          `q=${encodeURIComponent(email("outsider").toUpperCase())}`,
        ),
      );
      expect(byEmail.data.map((u) => u.id)).toEqual([users.outsider]);
    });

    it("exclude_project_id bỏ người đã thuộc dự án; limit giới hạn số dòng", async () => {
      const { data } = await json<{ data: UserCandidate[] }>(
        await search("pm", `q=${tag}&exclude_project_id=${projectA}`),
      );
      const ids = data.map((u) => u.id);
      expect(ids).not.toContain(users.pm);
      expect(ids).not.toContain(users.member);
      expect(ids).toContain(users.outsider);
      const limited = await json<{ data: UserCandidate[] }>(
        await search("pm", `q=${tag}&limit=2`),
      );
      expect(limited.data.length).toBe(2);
    });

    it("Admin và PM của dự án khác dùng được; Thành viên, Người xem, người ngoài: 403", async () => {
      expect((await search("admin", `q=${tag}`)).status).toBe(200);
      expect((await search("pm2", `q=${tag}`)).status).toBe(200);
      for (const who of ["member", "viewer", "outsider"]) {
        const e = await expectError(
          await search(who, `q=${tag}`),
          403,
          "forbidden",
        );
        expect(e.message).toBe(t.searchForbidden);
      }
      // Quyền kiểm trước schema.
      await expectError(await search("member", "q=a"), 403, "forbidden");
    });

    it("schema: thiếu q, q 1 ký tự, tham số lạ: 400", async () => {
      for (const qs of ["", "q=a", `q=${tag}&role=pm`, "q=ab&limit=50"]) {
        await expectError(await search("pm", qs), 400, "validation_failed");
      }
    });
  });
});
