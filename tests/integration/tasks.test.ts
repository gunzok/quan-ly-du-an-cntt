/**
 * Test tích hợp Story E2-2 (QLDA-38) với Supabase cục bộ: API task.
 * Gọi thẳng lõi Route Handler (lib/tasks/handlers.ts) với client phiên tạo từ hũ cookie (giống
 * trình duyệt), nên đi qua đủ: Origin, getUser, đọc vai trò qua RLS, schema, RLS và trigger CSDL.
 *
 * Chạy: make db-start && make test-integration. Thiếu SUPABASE_URL... thì cả nhóm BỎ QUA có
 * thông báo (tests/integration/global-setup.ts). Chỉ chấp nhận URL localhost.
 * Tài khoản và dự án tạo tạm với email ngẫu nhiên, xóa ở afterAll; không đụng seed.
 */
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signInWithPassword } from "@/lib/auth/sign-in";
import { strings } from "@/lib/strings";
import {
  handleCreateTask,
  handleDeleteTask,
  handleGetTask,
  handleListTasks,
  handlePatchTask,
  type TaskDeps,
} from "@/lib/tasks/handlers";
import type { Task, TaskListResponse } from "@/lib/tasks/model";
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

function deps(jar: CookieJar): TaskDeps {
  return { session: sessionClient(jar) };
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

describe.skipIf(!enabled)("API task (Supabase cục bộ)", () => {
  const tag = randomUUID().slice(0, 8);
  const password = `It-${randomUUID()}`;
  const created: string[] = [];
  const users: Record<string, string> = {};
  const jars: Record<string, CookieJar> = {};
  let projectA: string;
  let projectB: string;

  async function createUser(label: string) {
    const { data, error } = await service.auth.admin.createUser({
      email: `it-e2-2-${label}-${tag}@example.com`,
      password,
      email_confirm: true,
      user_metadata: { full_name: `IT ${label} ${tag}` },
    });
    if (error) throw error;
    created.push(data.user.id);
    users[label] = data.user.id;
    return data.user;
  }

  async function signIn(label: string) {
    const jar = new CookieJar();
    const result = await signInWithPassword(sessionClient(jar), {
      email: `it-e2-2-${label}-${tag}@example.com`,
      password,
    });
    expect(result.ok).toBe(true);
    jars[label] = jar;
  }

  const create = (who: string, projectId: string, body: unknown) =>
    handleCreateTask(
      send("POST", `/api/v1/projects/${projectId}/tasks`, body),
      projectId,
      deps(jars[who]),
    );
  const patch = (who: string, id: string, body: unknown) =>
    handlePatchTask(
      send("PATCH", `/api/v1/tasks/${id}`, body),
      id,
      deps(jars[who]),
    );
  const remove = (who: string, id: string) =>
    handleDeleteTask(
      send("DELETE", `/api/v1/tasks/${id}`),
      id,
      deps(jars[who]),
    );
  const show = (who: string, id: string) =>
    handleGetTask(get(`/api/v1/tasks/${id}`), id, deps(jars[who]));
  const list = (who: string, projectId: string, qs = "") =>
    handleListTasks(
      get(`/api/v1/projects/${projectId}/tasks${qs}`),
      projectId,
      deps(jars[who]),
    );

  async function createOk(who: string, body: Record<string, unknown>) {
    const res = await create(who, projectA, body);
    expect(res.status).toBe(201);
    return (await json<{ data: Task }>(res)).data;
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
      "member2",
      "viewer",
      "outsider",
      "locked",
    ]) {
      await createUser(label);
    }
    const { error: adminError } = await service
      .from("profiles")
      .update({ is_admin: true })
      .eq("id", users.admin);
    if (adminError) throw adminError;

    projectA = randomUUID();
    projectB = randomUUID();
    const projects = await service.from("projects").insert([
      { id: projectA, name: `IT Dự án A ${tag}`, created_by: users.pm },
      { id: projectB, name: `IT Dự án B ${tag}`, created_by: users.outsider },
    ]);
    if (projects.error) throw projects.error;
    const members = await service.from("project_members").insert([
      { project_id: projectA, user_id: users.member, role: "member" },
      { project_id: projectA, user_id: users.member2, role: "member" },
      { project_id: projectA, user_id: users.viewer, role: "viewer" },
      { project_id: projectA, user_id: users.locked, role: "member" },
    ]);
    if (members.error) throw members.error;

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
    for (const id of [projectA, projectB]) {
      if (id) await service.from("projects").delete().eq("id", id);
    }
    for (const id of created) await service.auth.admin.deleteUser(id);
  });

  it("chưa đăng nhập: 401 ở mọi endpoint", async () => {
    jars.anon = new CookieJar();
    const id = randomUUID();
    for (const res of [
      await list("anon", projectA),
      await create("anon", projectA, { title: "x" }),
      await show("anon", id),
      await patch("anon", id, { title: "x" }),
      await remove("anon", id),
    ]) {
      const error = await expectError(res, 401, "unauthenticated");
      expect(error.message).toBe(strings.api.unauthenticated);
    }
  });

  it("AC1: Thành viên tạo task đủ tên → 201, Location, task hiện trong danh sách", async () => {
    const res = await create("member", projectA, {
      title: "  Thiết kế Kanban ",
    });
    expect(res.status).toBe(201);
    const { data } = await json<{ data: Task }>(res);
    expect(res.headers.get("location")).toBe(`/api/v1/tasks/${data.id}`);
    expect(data).toMatchObject({
      project_id: projectA,
      title: "Thiết kế Kanban",
      created_by: users.member,
      priority: "medium",
      depth: 1,
      parent_id: null,
      status_id: null,
      assignee_id: null,
    });

    const listed = await json<TaskListResponse>(await list("member", projectA));
    expect(listed.data.map((t) => t.id)).toContain(data.id);
  });

  it("PM tạo task đủ trường, giao cho Thành viên", async () => {
    const task = await createOk("pm", {
      title: "Đủ trường",
      description: "Mô tả\nnhiều dòng",
      assignee_id: users.member,
      priority: "high",
      start_date: "2026-12-01",
      due_date: "2026-12-05",
      position: 2.5,
    });
    expect(task).toMatchObject({
      assignee_id: users.member,
      created_by: users.pm,
      priority: "high",
      start_date: "2026-12-01",
      due_date: "2026-12-05",
      position: 2.5,
    });
  });

  it("Admin không thuộc dự án vẫn tạo được task", async () => {
    const res = await create("admin", projectB, { title: "Admin tạo" });
    expect(res.status).toBe(201);
  });

  it("400: thiếu tên, trường lạ, sai định dạng, sai content-type", async () => {
    let error = await expectError(
      await create("member", projectA, { title: "" }),
      400,
      "validation_failed",
    );
    expect(error.details).toEqual([{ field: "title", issue: "required" }]);

    error = await expectError(
      await create("member", projectA, { title: "x", created_by: users.pm }),
      400,
      "validation_failed",
    );
    expect(error.details).toEqual([
      { field: "created_by", issue: "unknown_field" },
    ]);

    error = await expectError(
      await create("member", projectA, { title: "x", due_date: "05/12/2026" }),
      400,
      "validation_failed",
    );
    expect(error.details).toEqual([
      { field: "due_date", issue: "invalid_format" },
    ]);

    const textBody = new Request(
      new URL(`/api/v1/projects/${projectA}/tasks`, APP_ORIGIN),
      {
        method: "POST",
        headers: { origin: APP_ORIGIN, "content-type": "text/plain" },
        body: "title=x",
      },
    );
    await expectError(
      await handleCreateTask(textBody, projectA, deps(jars.member)),
      400,
      "validation_failed",
    );
  });

  it("AC2 / BR-13: ngày kết thúc sớm hơn ngày bắt đầu → 422, khi tạo và khi sửa", async () => {
    const error = await expectError(
      await create("member", projectA, {
        title: "Sai ngày",
        start_date: "2026-12-10",
        due_date: "2026-12-05",
      }),
      422,
      "business_rule_violated",
    );
    expect(error.message).toBe(strings.tasks.errors.dateOrder);

    const task = await createOk("member", {
      title: "Có ngày",
      start_date: "2026-12-01",
      due_date: "2026-12-10",
    });
    await expectError(
      await patch("member", task.id, { due_date: "2026-11-30" }),
      422,
      "business_rule_violated",
    );
    await expectError(
      await patch("member", task.id, { start_date: "2026-12-11" }),
      422,
      "business_rule_violated",
    );
    const ok = await patch("member", task.id, { start_date: "2026-12-10" });
    expect(ok.status).toBe(200);
  });

  it("422: giao việc cho người ngoài dự án hoặc Người xem", async () => {
    for (const assignee of [users.outsider, users.viewer, users.locked]) {
      const error = await expectError(
        await create("pm", projectA, { title: "x", assignee_id: assignee }),
        422,
        "business_rule_violated",
      );
      expect(error.details).toEqual([
        { field: "assignee_id", issue: "invalid_value" },
      ]);
    }
  });

  it("Người xem tạo task → 403; người ngoài, người bị khóa → 404 (không lộ dự án)", async () => {
    await expectError(
      await create("viewer", projectA, { title: "x" }),
      403,
      "forbidden",
    );
    await expectError(
      await create("outsider", projectA, { title: "x" }),
      404,
      "not_found",
    );
    await expectError(
      await create("locked", projectA, { title: "x" }),
      404,
      "not_found",
    );
    await expectError(
      await create("member", randomUUID(), { title: "x" }),
      404,
      "not_found",
    );
    await expectError(
      await create("member", "khong-phai-uuid", { title: "x" }),
      404,
      "not_found",
    );
  });

  it("thao tác ghi thiếu Origin hoặc khác Origin → 403", async () => {
    const task = await createOk("member", { title: "Origin" });
    for (const origin of [null, "http://evil.example"]) {
      await expectError(
        await handleCreateTask(
          send(
            "POST",
            `/api/v1/projects/${projectA}/tasks`,
            { title: "x" },
            origin,
          ),
          projectA,
          deps(jars.member),
        ),
        403,
        "forbidden",
      );
      await expectError(
        await handlePatchTask(
          send("PATCH", `/api/v1/tasks/${task.id}`, { title: "y" }, origin),
          task.id,
          deps(jars.member),
        ),
        403,
        "forbidden",
      );
      await expectError(
        await handleDeleteTask(
          send("DELETE", `/api/v1/tasks/${task.id}`, undefined, origin),
          task.id,
          deps(jars.member),
        ),
        403,
        "forbidden",
      );
    }
  });

  it("GET /tasks/{id}: thành viên và Người xem đọc; người ngoài, bị khóa → 404", async () => {
    const task = await createOk("pm", { title: "Đọc" });
    for (const who of ["pm", "member", "member2", "viewer", "admin"]) {
      const res = await show(who, task.id);
      expect(res.status).toBe(200);
      expect((await json<{ data: Task }>(res)).data.id).toBe(task.id);
    }
    for (const who of ["outsider", "locked"]) {
      await expectError(await show(who, task.id), 404, "not_found");
    }
    await expectError(await show("pm", randomUUID()), 404, "not_found");
  });

  it("PATCH theo BR-03: Thành viên sửa task mình tạo hoặc phụ trách, không sửa task người khác", async () => {
    const byPm = await createOk("pm", { title: "Của PM" });
    const assigned = await createOk("pm", {
      title: "Giao cho member",
      assignee_id: users.member,
    });
    const byMember = await createOk("member", { title: "Của member" });

    // Được phép
    let res = await patch("member", byMember.id, { priority: "urgent" });
    expect(res.status).toBe(200);
    expect((await json<{ data: Task }>(res)).data.priority).toBe("urgent");
    res = await patch("member", assigned.id, { title: "Member sửa" });
    expect(res.status).toBe(200);
    res = await patch("pm", byMember.id, { description: "PM sửa" });
    expect(res.status).toBe(200);
    res = await patch("admin", byPm.id, { position: 7 });
    expect(res.status).toBe(200);

    // Bị từ chối
    const error = await expectError(
      await patch("member2", byPm.id, { title: "x" }),
      403,
      "forbidden",
    );
    expect(error.message).toBe(strings.tasks.errors.forbiddenEdit);
    await expectError(
      await patch("member", byPm.id, { title: "x" }),
      403,
      "forbidden",
    );
    await expectError(
      await patch("viewer", byMember.id, { title: "x" }),
      403,
      "forbidden",
    );
    await expectError(
      await patch("outsider", byMember.id, { title: "x" }),
      404,
      "not_found",
    );
    await expectError(
      await patch("locked", byMember.id, { title: "x" }),
      404,
      "not_found",
    );
    // Thành viên chỉ phụ trách không giao task đi cho người khác.
    await expectError(
      await patch("member", assigned.id, { assignee_id: users.member2 }),
      403,
      "forbidden",
    );
    // Người tạo thì giao được.
    res = await patch("member", byMember.id, { assignee_id: users.member2 });
    expect(res.status).toBe(200);

    // Không đổi được trường hệ thống.
    const unknown = await expectError(
      await patch("pm", byPm.id, { project_id: projectB }),
      400,
      "validation_failed",
    );
    expect(unknown.details).toEqual([
      { field: "project_id", issue: "unknown_field" },
    ]);
    await expectError(await patch("pm", byPm.id, {}), 400, "validation_failed");

    // Dữ liệu thật trong CSDL không bị đổi bởi các lần bị từ chối.
    const { data } = await service
      .from("tasks")
      .select("title, project_id")
      .eq("id", byPm.id)
      .single();
    expect(data).toEqual({ title: "Của PM", project_id: projectA });
  });

  it("DELETE vĩnh viễn: Thành viên chỉ xóa task mình tạo; PM, Admin xóa mọi task", async () => {
    const byMember = await createOk("member", { title: "Xóa 1" });
    const assigned = await createOk("pm", {
      title: "Xóa 2",
      assignee_id: users.member,
    });
    const byPm = await createOk("pm", { title: "Xóa 3" });

    const error = await expectError(
      await remove("member", assigned.id),
      403,
      "forbidden",
    );
    expect(error.message).toBe(strings.tasks.errors.forbiddenDelete);
    await expectError(await remove("member2", byMember.id), 403, "forbidden");
    await expectError(await remove("viewer", byMember.id), 403, "forbidden");
    await expectError(await remove("outsider", byMember.id), 404, "not_found");
    await expectError(await remove("locked", byMember.id), 404, "not_found");

    let res = await remove("member", byMember.id);
    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
    res = await remove("pm", assigned.id);
    expect(res.status).toBe(204);
    res = await remove("admin", byPm.id);
    expect(res.status).toBe(204);

    // Xóa vĩnh viễn: không còn trong CSDL; gọi lại → 404.
    const { data } = await service
      .from("tasks")
      .select("id")
      .in("id", [byMember.id, assigned.id, byPm.id]);
    expect(data).toEqual([]);
    await expectError(await remove("pm", byPm.id), 404, "not_found");
    await expectError(await show("pm", byPm.id), 404, "not_found");
  });

  it("GET danh sách: phân trang con trỏ đủ và không trùng, lọc cơ bản, 404 với người ngoài", async () => {
    // Dự án B riêng cho danh sách để đếm chính xác.
    const { error } = await service.from("tasks").insert(
      Array.from({ length: 5 }, (_, i) => ({
        project_id: projectB,
        title: `Trang ${i}`,
        created_by: users.outsider,
        assignee_id: i % 2 === 0 ? users.outsider : null,
        priority: i === 0 ? "urgent" : "low",
      })),
    );
    if (error) throw error;
    const { data: all } = await service
      .from("tasks")
      .select("id")
      .eq("project_id", projectB);
    const expected = (all ?? []).map((t) => t.id as string).sort();

    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const qs: string = `?limit=2${cursor ? `&cursor=${cursor}` : ""}`;
      const res = await list("outsider", projectB, qs);
      expect(res.status).toBe(200);
      const body = await json<TaskListResponse>(res);
      expect(body.data.length).toBeLessThanOrEqual(2);
      seen.push(...body.data.map((t) => t.id));
      cursor = body.next_cursor;
      pages += 1;
    } while (cursor && pages < 10);
    expect(seen.length).toBe(expected.length);
    expect([...seen].sort()).toEqual(expected);
    expect(pages).toBe(Math.ceil(expected.length / 2));

    // Thứ tự mới tạo trước.
    const first = await json<TaskListResponse>(
      await list("outsider", projectB),
    );
    const times = first.data.map((t) => t.created_at);
    expect([...times].sort().reverse()).toEqual(times);

    // Lọc
    let body = await json<TaskListResponse>(
      await list("outsider", projectB, `?assignee_id=${users.outsider}`),
    );
    expect(body.data.length).toBe(3);
    expect(body.data.every((t) => t.assignee_id === users.outsider)).toBe(true);
    body = await json<TaskListResponse>(
      await list("outsider", projectB, "?priority=urgent"),
    );
    expect(body.data.map((t) => t.title)).toEqual(["Trang 0"]);
    body = await json<TaskListResponse>(
      await list("outsider", projectB, `?status_id=${randomUUID()}`),
    );
    expect(body.data).toEqual([]);

    // Sai tham số
    await expectError(
      await list("outsider", projectB, "?limit=500"),
      400,
      "validation_failed",
    );
    await expectError(
      await list("outsider", projectB, "?q=tim"),
      400,
      "validation_failed",
    );
    await expectError(
      await list("outsider", projectB, "?cursor=abc"),
      400,
      "validation_failed",
    );

    // Không thuộc dự án / bị khóa: 404, không lộ dự án.
    await expectError(await list("member", projectB), 404, "not_found");
    await expectError(await list("locked", projectA), 404, "not_found");
    // Người xem đọc được danh sách dự án mình thuộc.
    expect((await list("viewer", projectA)).status).toBe(200);
  });
});
