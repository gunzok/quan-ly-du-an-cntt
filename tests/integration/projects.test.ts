/**
 * Test tích hợp Story E2-1 (QLDA-37) với Supabase cục bộ: API dự án.
 * Gọi thẳng lõi Route Handler (lib/projects/handlers.ts) với client phiên tạo từ hũ cookie (giống
 * trình duyệt), nên đi qua đủ: Origin, getUser, đọc vai trò qua RLS, schema, RLS, trigger và hàm
 * public.create_project(), public.project_stats().
 *
 * Chạy: make db-start && make test-integration. Thiếu SUPABASE_URL... thì cả nhóm BỎ QUA có
 * thông báo (tests/integration/global-setup.ts). Chỉ chấp nhận URL localhost.
 * Tài khoản và dự án tạo tạm với email, tên ngẫu nhiên, xóa ở afterAll; không đụng seed. Stack
 * dùng chung nên mọi kiểm tra danh sách lọc theo `q` = mã ngẫu nhiên của lần chạy.
 */
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signInWithPassword } from "@/lib/auth/sign-in";
import {
  handleCreateProject,
  handleDeleteProject,
  handleGetProject,
  handleListProjects,
  handlePatchProject,
  type ProjectDeps,
} from "@/lib/projects/handlers";
import type { Project, ProjectListResponse } from "@/lib/projects/model";
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
/** "Hôm nay" cố định để số task trễ hạn không phụ thuộc ngày chạy test. */
const TODAY = "2030-06-15";

let service: SupabaseClient;

function deps(jar: CookieJar): ProjectDeps {
  return { session: sessionClient(jar), today: TODAY };
}

function get(path: string) {
  return new Request(new URL(path, APP_ORIGIN));
}

function send(
  method: "POST" | "PATCH" | "DELETE",
  path: string,
  body?: unknown,
  origin: string | null = APP_ORIGIN,
) {
  const headers = new Headers();
  if (body !== undefined) headers.set("content-type", "application/json");
  if (origin) headers.set("origin", origin);
  return new Request(new URL(path, APP_ORIGIN), {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
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
  expect(typeof body.error.request_id).toBe("string");
  expect(body.error.request_id.length).toBeGreaterThan(0);
  return body.error;
}

describe.skipIf(!enabled)("API dự án (Supabase cục bộ)", () => {
  const tag = randomUUID().slice(0, 8);
  const password = `It-${randomUUID()}`;
  const createdUsers: string[] = [];
  const createdProjects: string[] = [];
  const users: Record<string, string> = {};
  const jars: Record<string, CookieJar> = {};
  let projectA: string;
  let projectB: string;

  async function createUser(label: string) {
    const { data, error } = await service.auth.admin.createUser({
      email: `it-e2-1-${label}-${tag}@example.com`,
      password,
      email_confirm: true,
      user_metadata: { full_name: `IT ${label} ${tag}` },
    });
    if (error) throw error;
    createdUsers.push(data.user.id);
    users[label] = data.user.id;
  }

  async function signIn(label: string) {
    const jar = new CookieJar();
    const result = await signInWithPassword(sessionClient(jar), {
      email: `it-e2-1-${label}-${tag}@example.com`,
      password,
    });
    expect(result.ok).toBe(true);
    jars[label] = jar;
  }

  const list = (who: string, qs = `?q=${tag}`) =>
    handleListProjects(get(`/api/v1/projects${qs}`), deps(jars[who]));
  const create = (who: string, body: unknown, origin?: string | null) =>
    handleCreateProject(
      send("POST", "/api/v1/projects", body, origin),
      deps(jars[who]),
    );
  const show = (who: string, id: string) =>
    handleGetProject(get(`/api/v1/projects/${id}`), id, deps(jars[who]));
  const patch = (
    who: string,
    id: string,
    body: unknown,
    origin?: string | null,
  ) =>
    handlePatchProject(
      send("PATCH", `/api/v1/projects/${id}`, body, origin),
      id,
      deps(jars[who]),
    );
  const remove = (who: string, id: string, origin?: string | null) =>
    handleDeleteProject(
      send("DELETE", `/api/v1/projects/${id}`, undefined, origin),
      id,
      deps(jars[who]),
    );

  async function createOk(who: string, body: Record<string, unknown>) {
    const res = await create(who, body);
    expect(res.status).toBe(201);
    const { data } = await json<{ data: Project }>(res);
    createdProjects.push(data.id);
    return { res, data };
  }

  async function listIds(who: string, qs = `?q=${tag}`) {
    const res = await list(who, qs);
    expect(res.status).toBe(200);
    const body = await json<ProjectListResponse>(res);
    return body.data.map((p) => p.id);
  }

  beforeAll(async () => {
    assertLocalSupabase();
    service = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    for (const label of [
      "admin",
      "pm",
      "member",
      "viewer",
      "outsider",
      "locked",
      "pmb",
    ]) {
      await createUser(label);
    }
    const { error: adminError } = await service
      .from("profiles")
      .update({ is_admin: true })
      .eq("id", users.admin);
    if (adminError) throw adminError;

    // Trigger add_creator_as_pm biến người tạo thành PM.
    projectA = randomUUID();
    projectB = randomUUID();
    const projects = await service.from("projects").insert([
      {
        id: projectA,
        name: `IT Dự án A ${tag}`,
        created_by: users.pm,
        end_date: "2030-12-31",
      },
      { id: projectB, name: `IT Dự án B ${tag}`, created_by: users.pmb },
    ]);
    if (projects.error) throw projects.error;
    createdProjects.push(projectA, projectB);
    const members = await service.from("project_members").insert([
      { project_id: projectA, user_id: users.member, role: "member" },
      { project_id: projectA, user_id: users.viewer, role: "viewer" },
      { project_id: projectA, user_id: users.locked, role: "pm" },
    ]);
    if (members.error) throw members.error;

    // Dự án A: 4 task: 1 đã xong (trễ hạn nhưng đã xong thì không tính), 1 trễ hạn, 1 hạn đúng
    // hôm nay (chưa trễ), 1 không có hạn. Tiến độ 1/4 = 25%, trễ hạn 1.
    const tasks = await service.from("tasks").insert([
      {
        project_id: projectA,
        title: "Đã xong",
        created_by: users.pm,
        due_date: "2030-06-01",
        completed_at: "2030-06-02T00:00:00Z",
      },
      {
        project_id: projectA,
        title: "Trễ hạn",
        created_by: users.pm,
        due_date: "2030-06-14",
      },
      {
        project_id: projectA,
        title: "Hạn hôm nay",
        created_by: users.pm,
        due_date: TODAY,
      },
      { project_id: projectA, title: "Không hạn", created_by: users.pm },
    ]);
    if (tasks.error) throw tasks.error;

    for (const label of Object.keys(users)) await signIn(label);
    // Khóa sau khi đăng nhập: phiên còn hạn nhưng RLS chặn mọi dữ liệu.
    const { error: lockError } = await service
      .from("profiles")
      .update({ is_active: false })
      .eq("id", users.locked);
    if (lockError) throw lockError;
  });

  afterAll(async () => {
    if (!service) return;
    for (const id of createdProjects) {
      await service.from("projects").delete().eq("id", id);
    }
    for (const id of createdUsers) await service.auth.admin.deleteUser(id);
  });

  it("chưa đăng nhập: 401 ở mọi endpoint", async () => {
    jars.anon = new CookieJar();
    for (const res of [
      await list("anon"),
      await create("anon", { name: "x" }),
      await show("anon", projectA),
      await patch("anon", projectA, { name: "x" }),
      await remove("anon", projectA),
    ]) {
      const error = await expectError(res, 401, "unauthenticated");
      expect(error.message).toBe(strings.api.unauthenticated);
    }
  });

  it("Origin lạ hoặc thiếu ở POST, PATCH, DELETE: 403 trước cả kiểm phiên", async () => {
    for (const origin of ["https://evil.example", null]) {
      await expectError(
        await create("pm", { name: "x" }, origin),
        403,
        "forbidden",
      );
      await expectError(
        await patch("pm", projectA, { name: "x" }, origin),
        403,
        "forbidden",
      );
      await expectError(
        await remove("admin", projectA, origin),
        403,
        "forbidden",
      );
    }
    const res = await show("pm", projectA);
    expect((await json<{ data: Project }>(res)).data.name).toBe(
      `IT Dự án A ${tag}`,
    );
  });

  it("AC1: PM tạo dự án → 201, Location, người tạo là PM của dự án mới", async () => {
    const { res, data } = await createOk("pm", {
      name: `  IT PM tạo ${tag} `,
      description: "Mô tả\nnhiều dòng",
      start_date: "2030-01-01",
      end_date: "2030-03-31",
    });
    expect(res.headers.get("location")).toBe(`/api/v1/projects/${data.id}`);
    expect(data).toMatchObject({
      name: `IT PM tạo ${tag}`,
      description: "Mô tả\nnhiều dòng",
      start_date: "2030-01-01",
      end_date: "2030-03-31",
      status: "active",
      created_by: users.pm,
      my_role: "pm",
      member_count: 1,
      task_count: 0,
      progress: 0,
      overdue_task_count: 0,
    });
    expect(data.members_preview.map((m) => m.id)).toEqual([users.pm]);

    const { data: rows } = await service
      .from("project_members")
      .select("user_id, role")
      .eq("project_id", data.id);
    expect(rows).toEqual([{ user_id: users.pm, role: "pm" }]);
  });

  it("Admin không thuộc dự án nào vẫn tạo được và thành PM của dự án mới", async () => {
    const { data } = await createOk("admin", { name: `IT Admin tạo ${tag}` });
    expect(data.my_role).toBe("pm");
    expect(data.created_by).toBe(users.admin);
  });

  it("403: Thành viên, Người xem, người ngoài, người bị khóa (không phải PM ở đâu) không tạo được", async () => {
    for (const who of ["member", "viewer", "outsider", "locked"]) {
      const error = await expectError(
        await create(who, { name: `IT bị chặn ${tag}` }),
        403,
        "forbidden",
      );
      expect(error.message).toBe(strings.projects.errors.forbiddenCreate);
    }
    const { count } = await service
      .from("projects")
      .select("id", { count: "exact", head: true })
      .eq("name", `IT bị chặn ${tag}`);
    expect(count).toBe(0);
  });

  it("400: thiếu tên, trường lạ (template_id, status, created_by), sai định dạng, JSON hỏng", async () => {
    let error = await expectError(
      await create("pm", { name: "   " }),
      400,
      "validation_failed",
    );
    expect(error.details).toEqual([{ field: "name", issue: "required" }]);

    error = await expectError(
      await create("pm", {
        name: "x",
        template_id: randomUUID(),
        status: "archived",
        created_by: users.member,
      }),
      400,
      "validation_failed",
    );
    expect(error.details).toEqual([
      { field: "template_id", issue: "unknown_field" },
      { field: "status", issue: "unknown_field" },
      { field: "created_by", issue: "unknown_field" },
    ]);

    error = await expectError(
      await create("pm", { name: "x", end_date: "31/12/2030" }),
      400,
      "validation_failed",
    );
    expect(error.details).toEqual([
      { field: "end_date", issue: "invalid_format" },
    ]);

    error = await expectError(
      await create("pm", { name: "x".repeat(201) }),
      400,
      "validation_failed",
    );
    expect(error.details).toEqual([{ field: "name", issue: "too_long" }]);

    const broken = new Request(new URL("/api/v1/projects", APP_ORIGIN), {
      method: "POST",
      headers: { origin: APP_ORIGIN, "content-type": "application/json" },
      body: "{",
    });
    await expectError(
      await handleCreateProject(broken, deps(jars.pm)),
      400,
      "validation_failed",
    );
  });

  it("422: ngày kết thúc sớm hơn ngày bắt đầu, khi tạo và khi sửa", async () => {
    const error = await expectError(
      await create("pm", {
        name: `IT sai ngày ${tag}`,
        start_date: "2030-05-01",
        end_date: "2030-04-30",
      }),
      422,
      "business_rule_violated",
    );
    expect(error.message).toBe(strings.projects.errors.dateOrder);
    // Dự án A có end_date 2030-12-31: đặt start sau đó cũng là 422.
    await expectError(
      await patch("pm", projectA, { start_date: "2031-01-01" }),
      422,
      "business_rule_violated",
    );
  });

  it("AC2: mỗi người chỉ thấy dự án mình thuộc; Admin thấy tất cả", async () => {
    expect(await listIds("member")).toEqual([projectA]);
    expect(await listIds("viewer")).toEqual([projectA]);
    expect(await listIds("pmb")).toEqual([projectB]);
    expect(await listIds("outsider")).toEqual([]);
    expect(await listIds("locked")).toEqual([]);
    const pmIds = await listIds("pm");
    expect(pmIds).toContain(projectA);
    expect(pmIds).not.toContain(projectB);
    const adminIds = await listIds("admin");
    expect(adminIds).toEqual(expect.arrayContaining([projectA, projectB]));
  });

  it("Danh sách kèm vai trò, số thành viên, tiến độ, trễ hạn tính từ task", async () => {
    const res = await list("member");
    const body = await json<ProjectListResponse>(res);
    const a = body.data.find((p) => p.id === projectA);
    expect(a).toMatchObject({
      my_role: "member",
      member_count: 4,
      task_count: 4,
      done_task_count: 1,
      overdue_task_count: 1,
      progress: 25,
      end_date: "2030-12-31",
    });
    // PM trước trong ảnh đại diện; chỉ id và họ tên, không email.
    expect(a?.members_preview.length).toBe(3);
    expect(a?.members_preview[0]?.id).toMatch(
      new RegExp(`^(${users.pm}|${users.locked})$`),
    );
    expect(Object.keys(a?.members_preview[0] ?? {}).sort()).toEqual([
      "full_name",
      "id",
    ]);

    const adminView = (await json<ProjectListResponse>(await list("admin")))
      .data;
    expect(adminView.find((p) => p.id === projectA)?.my_role).toBeNull();
    expect(body.counts.active).toBe(1);
  });

  it("Phân trang con trỏ: không trùng, không sót; limit, cursor sai → 400", async () => {
    for (let i = 0; i < 3; i++) {
      await createOk("pm", { name: `IT trang ${tag} ${i}` });
    }
    const q = encodeURIComponent(`trang ${tag}`);
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const qs: string = `?q=${q}&limit=2${cursor ? `&cursor=${cursor}` : ""}`;
      const body: ProjectListResponse = await json<ProjectListResponse>(
        await list("pm", qs),
      );
      expect(body.data.length).toBeLessThanOrEqual(2);
      seen.push(...body.data.map((p) => p.id));
      cursor = body.next_cursor;
      pages += 1;
    } while (cursor && pages < 5);
    expect(pages).toBe(2);
    expect(seen.length).toBe(3);
    expect(new Set(seen).size).toBe(3);

    for (const qs of [
      "?limit=0",
      "?limit=101",
      "?cursor=abc",
      "?status=deleted",
      "?foo=1",
      "?q=a&q=b",
    ]) {
      await expectError(await list("pm", qs), 400, "validation_failed");
    }
  });

  it("Lọc theo tên không coi % và _ là ký tự đại diện", async () => {
    expect(
      await listIds("admin", `?q=${encodeURIComponent(`%${tag}`)}`),
    ).toEqual([]);
    expect(await listIds("admin", `?q=${encodeURIComponent(`IT_Dự`)}`)).toEqual(
      [],
    );
  });

  it("GET /projects/{id}: thành viên 200; người ngoài, người bị khóa, id sai, id không tồn tại 404", async () => {
    const res = await show("viewer", projectA);
    expect(res.status).toBe(200);
    expect((await json<{ data: Project }>(res)).data.my_role).toBe("viewer");
    for (const [who, id] of [
      ["outsider", projectA],
      ["locked", projectA],
      ["member", projectB],
      ["member", "khong-phai-uuid"],
      ["admin", randomUUID()],
    ] as const) {
      await expectError(await show(who, id), 404, "not_found");
    }
  });

  it("PATCH: PM sửa tên, mô tả, ngày; Thành viên và Người xem 403; người ngoài 404", async () => {
    const res = await patch("pm", projectA, {
      name: `IT Dự án A đổi ${tag}`,
      description: "Mới",
      start_date: "2030-01-01",
    });
    expect(res.status).toBe(200);
    expect((await json<{ data: Project }>(res)).data).toMatchObject({
      name: `IT Dự án A đổi ${tag}`,
      description: "Mới",
      start_date: "2030-01-01",
      task_count: 4,
    });

    for (const who of ["member", "viewer"]) {
      const error = await expectError(
        await patch(who, projectA, { name: "Không được" }),
        403,
        "forbidden",
      );
      expect(error.message).toBe(strings.projects.errors.forbiddenEdit);
    }
    await expectError(
      await patch("outsider", projectA, { name: "x" }),
      404,
      "not_found",
    );
    await expectError(
      await patch("locked", projectA, { name: "x" }),
      404,
      "not_found",
    );

    let error = await expectError(
      await patch("pm", projectA, { status: "deleted" }),
      400,
      "validation_failed",
    );
    expect(error.details).toEqual([
      { field: "status", issue: "invalid_value" },
    ]);
    error = await expectError(
      await patch("pm", projectA, {}),
      400,
      "validation_failed",
    );
    expect(error.details).toEqual([{ field: "body", issue: "required" }]);
    error = await expectError(
      await patch("pm", projectA, { created_by: users.member }),
      400,
      "validation_failed",
    );
    expect(error.details).toEqual([
      { field: "created_by", issue: "unknown_field" },
    ]);

    const { data } = await service
      .from("projects")
      .select("name")
      .eq("id", projectA)
      .single();
    expect(data?.name).toBe(`IT Dự án A đổi ${tag}`);
  });

  it("Lưu trữ: PM PATCH status=archived → sang danh sách Lưu trữ; khôi phục được", async () => {
    let res = await patch("pm", projectA, { status: "archived" });
    expect(res.status).toBe(200);
    expect((await json<{ data: Project }>(res)).data.status).toBe("archived");

    expect(await listIds("member")).toEqual([]);
    expect(await listIds("member", `?q=${tag}&status=archived`)).toEqual([
      projectA,
    ]);
    const body = await json<ProjectListResponse>(await list("member"));
    expect(body.counts).toEqual({ active: 0, archived: 1 });

    res = await patch("pm", projectA, { status: "active" });
    expect((await json<{ data: Project }>(res)).data.status).toBe("active");
  });

  it("DELETE: chỉ Admin (204, task xóa theo); PM, Thành viên 403; người ngoài 404", async () => {
    const { data: temp } = await createOk("pm", { name: `IT xóa ${tag}` });
    for (const who of ["pm", "member"]) {
      const id = who === "pm" ? temp.id : projectA;
      const error = await expectError(await remove(who, id), 403, "forbidden");
      expect(error.message).toBe(strings.projects.errors.forbiddenDelete);
    }
    await expectError(await remove("outsider", temp.id), 404, "not_found");

    const res = await remove("admin", temp.id);
    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
    await expectError(await show("pm", temp.id), 404, "not_found");
    await expectError(await remove("admin", temp.id), 404, "not_found");
  });
});
