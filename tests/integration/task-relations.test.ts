/**
 * Test tích hợp Story E8-1 (QLDA-55) với Supabase cục bộ: API quan hệ task.
 * Gọi thẳng lõi Route Handler (lib/task-relations/handlers.ts) với client phiên tạo từ hũ cookie
 * (giống trình duyệt), nên đi qua đủ: Origin, getUser, đọc vai trò qua RLS, schema, RLS và trigger.
 *
 * Chạy: make db-start && make test-integration. Thiếu SUPABASE_URL... thì cả nhóm BỎ QUA có
 * thông báo. Chỉ chấp nhận URL localhost. Tài khoản, dự án tạo tạm, xóa ở afterAll.
 */
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signInWithPassword } from "@/lib/auth/sign-in";
import { strings } from "@/lib/strings";
import {
  handleCreateRelation,
  handleDeleteRelation,
  handleGetRelation,
  handleListRelations,
  type TaskRelationDeps,
} from "@/lib/task-relations/handlers";
import { relationMessages } from "@/lib/task-relations/messages";
import type {
  TaskRelationListResponse,
  TaskRelationView,
} from "@/lib/task-relations/model";
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

function deps(jar: CookieJar): TaskRelationDeps {
  return { session: sessionClient(jar) };
}

function get(path: string) {
  return new Request(new URL(path, APP_ORIGIN));
}

function send(
  method: "POST" | "DELETE",
  path: string,
  body?: unknown,
  opts: { origin?: string | null; raw?: string; type?: string } = {},
) {
  const headers = new Headers();
  const origin = opts.origin === undefined ? APP_ORIGIN : opts.origin;
  if (body !== undefined || opts.raw !== undefined) {
    headers.set("content-type", opts.type ?? "application/json");
  }
  if (origin) headers.set("origin", origin);
  return new Request(new URL(path, APP_ORIGIN), {
    method,
    headers,
    body: opts.raw ?? (body === undefined ? undefined : JSON.stringify(body)),
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

describe.skipIf(!enabled)("API quan hệ task (Supabase cục bộ)", () => {
  const tag = randomUUID().slice(0, 8);
  const password = `It-${randomUUID()}`;
  const created: string[] = [];
  const users: Record<string, string> = {};
  const jars: Record<string, CookieJar> = {};
  const t: Record<string, string> = {};
  let projectA: string;
  let projectB: string;

  const email = (label: string) => `it-e8-1-${label}-${tag}@example.com`;

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

  /** Tạo task bằng service_role (dữ liệu chuẩn bị, không phải đối tượng test). */
  async function task(
    key: string,
    projectId: string,
    createdBy: string,
    assignee: string | null = null,
  ) {
    const id = randomUUID();
    const { error } = await service.from("tasks").insert({
      id,
      project_id: projectId,
      title: `IT ${key} ${tag}`,
      created_by: createdBy,
      assignee_id: assignee,
    });
    if (error) throw error;
    t[key] = id;
    return id;
  }

  const create = (who: string, taskId: string, body: unknown) =>
    handleCreateRelation(
      send("POST", `/api/v1/tasks/${taskId}/relations`, body),
      taskId,
      deps(jars[who]),
    );
  const list = (who: string, taskId: string) =>
    handleListRelations(
      get(`/api/v1/tasks/${taskId}/relations`),
      taskId,
      deps(jars[who]),
    );
  const show = (who: string, taskId: string, relId: string) =>
    handleGetRelation(
      get(`/api/v1/tasks/${taskId}/relations/${relId}`),
      taskId,
      relId,
      deps(jars[who]),
    );
  const remove = (who: string, taskId: string, relId: string) =>
    handleDeleteRelation(
      send("DELETE", `/api/v1/tasks/${taskId}/relations/${relId}`),
      taskId,
      relId,
      deps(jars[who]),
    );

  async function createOk(who: string, taskId: string, body: unknown) {
    const res = await create(who, taskId, body);
    expect(res.status).toBe(201);
    return (await json<{ data: TaskRelationView }>(res)).data;
  }

  async function listOf(who: string, taskId: string) {
    const res = await list(who, taskId);
    expect(res.status).toBe(200);
    return (await json<TaskRelationListResponse>(res)).data;
  }

  beforeAll(async () => {
    assertLocalSupabase();
    service = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    for (const label of [
      "admin",
      "pm",
      "pmb",
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
      { id: projectA, name: `IT E8-1 A ${tag}`, created_by: users.pm },
      { id: projectB, name: `IT E8-1 B ${tag}`, created_by: users.pmb },
    ]);
    if (projects.error) throw projects.error;
    const members = await service.from("project_members").insert([
      { project_id: projectA, user_id: users.member, role: "member" },
      { project_id: projectA, user_id: users.member2, role: "member" },
      { project_id: projectA, user_id: users.viewer, role: "viewer" },
      { project_id: projectA, user_id: users.locked, role: "member" },
    ]);
    if (members.error) throw members.error;

    await task("m", projectA, users.member);
    await task("as", projectA, users.pm, users.member);
    for (const k of ["p1", "p2", "p3", "p4", "p5", "p6"]) {
      await task(k, projectA, users.pm);
    }
    await task("l", projectA, users.locked);
    await task("b", projectB, users.pmb);

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
  });

  it("chưa đăng nhập: 401 ở mọi endpoint", async () => {
    jars.anon = new CookieJar();
    const id = randomUUID();
    for (const res of [
      await list("anon", id),
      await show("anon", id, id),
      await create("anon", id, { kind: "blocks", to_task_id: id }),
      await remove("anon", id, id),
    ]) {
      const error = await expectError(res, 401, "unauthenticated");
      expect(error.message).toBe(strings.api.unauthenticated);
    }
  });

  it("AC1: PM đặt P1 chặn P2 → 201 + Location; task kia thấy quan hệ đảo blocked_by", async () => {
    const res = await create("pm", t.p1, {
      kind: "blocks",
      to_task_id: t.p2.toUpperCase(),
    });
    expect(res.status).toBe(201);
    const { data } = await json<{ data: TaskRelationView }>(res);
    expect(res.headers.get("location")).toBe(
      `/api/v1/tasks/${t.p1}/relations/${data.id}`,
    );
    expect(data).toMatchObject({
      kind: "blocks",
      direction: "outgoing",
      relation: "blocks",
      lag_days: 0,
      created_by: users.pm,
      task: { id: t.p2, title: `IT p2 ${tag}` },
    });
    // status_id có mặt (null, hoặc trạng thái mặc định khi đã có danh mục trạng thái E2-3).
    expect(data.task).toHaveProperty("status_id");

    // Người xem đọc từ phía P2: "bị chặn bởi P1".
    const fromP2 = await listOf("viewer", t.p2);
    expect(fromP2).toEqual([
      expect.objectContaining({
        id: data.id,
        kind: "blocks",
        direction: "incoming",
        relation: "blocked_by",
        task: expect.objectContaining({ id: t.p1, title: `IT p1 ${tag}` }),
      }),
    ]);
    const fromP1 = await listOf("member2", t.p1);
    expect(fromP1.map((r) => [r.id, r.relation])).toEqual([
      [data.id, "blocks"],
    ]);

    // Location đọc được từ cả hai phía.
    const one = await show("viewer", t.p2, data.id);
    expect(one.status).toBe(200);
    expect((await json<{ data: TaskRelationView }>(one)).data.relation).toBe(
      "blocked_by",
    );
  });

  it("AC2: quan hệ gây vòng trực tiếp và gián tiếp → 409", async () => {
    let error = await expectError(
      await create("pm", t.p2, { kind: "blocks", to_task_id: t.p1 }),
      409,
      "conflict",
    );
    expect(error.message).toBe(relationMessages.cycle);
    // blocks và precedes chung một đồ thị.
    error = await expectError(
      await create("pm", t.p2, { kind: "precedes", to_task_id: t.p1 }),
      409,
      "conflict",
    );
    expect(error.message).toBe(relationMessages.cycle);

    // P1 → P2 → P3, rồi P3 → P1 đóng vòng.
    await createOk("pm", t.p2, {
      kind: "precedes",
      to_task_id: t.p3,
      lag_days: 2,
    });
    error = await expectError(
      await create("pm", t.p3, { kind: "blocks", to_task_id: t.p1 }),
      409,
      "conflict",
    );
    expect(error.message).toBe(relationMessages.cycle);
    // relates / duplicates ngược chiều không phải vòng.
    await createOk("pm", t.p3, { kind: "relates", to_task_id: t.p1 });
    await createOk("pm", t.p3, { kind: "duplicates", to_task_id: t.p1 });
  });

  it("quan hệ đảo của precedes, duplicates, relates", async () => {
    const fromP3 = await listOf("pm", t.p3);
    expect(
      fromP3.map((r) => [r.relation, r.direction, r.task.id, r.lag_days]),
    ).toEqual([
      ["follows", "incoming", t.p2, 2],
      ["relates", "outgoing", t.p1, 0],
      ["duplicates", "outgoing", t.p1, 0],
    ]);
    const fromP1 = await listOf("pm", t.p1);
    expect(fromP1.map((r) => r.relation)).toEqual([
      "blocks",
      "relates",
      "duplicated_by",
    ]);
  });

  it("trùng và relates đảo cặp → 409", async () => {
    let error = await expectError(
      await create("pm", t.p1, { kind: "blocks", to_task_id: t.p2 }),
      409,
      "conflict",
    );
    expect(error.message).toBe(relationMessages.duplicate);
    error = await expectError(
      await create("pm", t.p1, { kind: "relates", to_task_id: t.p3 }),
      409,
      "conflict",
    );
    expect(error.message).toBe(relationMessages.duplicate);
  });

  it("400: schema viết tay từ chối trường lạ, kiểu sai, lag_days sai kiểu", async () => {
    let error = await expectError(
      await create("pm", t.p4, {
        kind: "blocks",
        to_task_id: t.p5,
        from_task_id: t.p6,
      }),
      400,
      "validation_failed",
    );
    expect(error.details).toEqual([
      { field: "from_task_id", issue: "unknown_field" },
    ]);
    error = await expectError(
      await create("pm", t.p4, { kind: "blocked_by", to_task_id: "x" }),
      400,
      "validation_failed",
    );
    expect(error.details).toEqual([
      { field: "kind", issue: "invalid_value" },
      { field: "to_task_id", issue: "invalid_format" },
    ]);
    error = await expectError(
      await create("pm", t.p4, {
        kind: "blocks",
        to_task_id: t.p5,
        lag_days: 3,
      }),
      400,
      "validation_failed",
    );
    expect(error.details).toEqual([
      { field: "lag_days", issue: "invalid_value" },
    ]);
    await expectError(
      await handleCreateRelation(
        send("POST", `/api/v1/tasks/${t.p4}/relations`, undefined, {
          raw: "{",
        }),
        t.p4,
        deps(jars.pm),
      ),
      400,
      "validation_failed",
    );
    await expectError(
      await handleCreateRelation(
        send("POST", `/api/v1/tasks/${t.p4}/relations`, undefined, {
          raw: "kind=blocks",
          type: "application/x-www-form-urlencoded",
        }),
        t.p4,
        deps(jars.pm),
      ),
      400,
      "validation_failed",
    );
  });

  it("422: tự quan hệ, hai task khác dự án", async () => {
    let error = await expectError(
      await create("pm", t.p4, { kind: "relates", to_task_id: t.p4 }),
      422,
      "business_rule_violated",
    );
    expect(error.message).toBe(relationMessages.selfRelation);
    // Admin thấy cả hai dự án.
    error = await expectError(
      await create("admin", t.p4, { kind: "relates", to_task_id: t.b }),
      422,
      "business_rule_violated",
    );
    expect(error.message).toBe(relationMessages.crossProject);
  });

  it("404: task nguồn, task đích hoặc quan hệ không thấy được", async () => {
    const ghost = randomUUID();
    await expectError(await list("pm", ghost), 404, "not_found");
    await expectError(await list("pm", "khong-phai-uuid"), 404, "not_found");
    await expectError(await list("outsider", t.p1), 404, "not_found");
    await expectError(await list("locked", t.p1), 404, "not_found");
    await expectError(
      await create("outsider", t.p1, { kind: "blocks", to_task_id: t.p4 }),
      404,
      "not_found",
    );
    // PM dự án A, task đích ở dự án B không thấy được: 404 (không lộ là khác dự án).
    await expectError(
      await create("pm", t.p4, { kind: "relates", to_task_id: t.b }),
      404,
      "not_found",
    );
    await expectError(
      await create("pm", t.p4, { kind: "relates", to_task_id: ghost }),
      404,
      "not_found",
    );
    await expectError(await show("pm", t.p1, ghost), 404, "not_found");
  });

  it("403: Người xem, Thành viên chỉ sửa được một task, Origin lạ", async () => {
    let error = await expectError(
      await create("viewer", t.p4, { kind: "relates", to_task_id: t.p5 }),
      403,
      "forbidden",
    );
    expect(error.message).toBe(relationMessages.forbiddenEdit);
    error = await expectError(
      await create("member", t.m, { kind: "blocks", to_task_id: t.p4 }),
      403,
      "forbidden",
    );
    expect(error.message).toBe(relationMessages.forbiddenEdit);
    await expectError(
      await create("member", t.p4, { kind: "blocks", to_task_id: t.m }),
      403,
      "forbidden",
    );
    await expectError(
      await create("member2", t.p4, { kind: "relates", to_task_id: t.p5 }),
      403,
      "forbidden",
    );
    await expectError(
      await handleCreateRelation(
        send(
          "POST",
          `/api/v1/tasks/${t.p4}/relations`,
          { kind: "relates", to_task_id: t.p5 },
          { origin: "https://evil.example" },
        ),
        t.p4,
        deps(jars.pm),
      ),
      403,
      "forbidden",
    );
  });

  it("Thành viên sửa được cả hai task (tạo + phụ trách), Admin không thuộc dự án: 201", async () => {
    const r = await createOk("member", t.m, {
      kind: "relates",
      to_task_id: t.as,
    });
    expect(r.created_by).toBe(users.member);
    await createOk("admin", t.p4, {
      kind: "precedes",
      to_task_id: t.p5,
      lag_days: -1,
    });
  });

  it("DELETE: 403 khi thiếu quyền, 404 khi quan hệ không dính task, 204 từ phía nào cũng được", async () => {
    const rel = await createOk("pm", t.p5, {
      kind: "blocks",
      to_task_id: t.m,
    });
    await expectError(await remove("viewer", t.p5, rel.id), 403, "forbidden");
    // Thành viên sửa được M nhưng không sửa được P5.
    await expectError(await remove("member", t.m, rel.id), 403, "forbidden");
    await expectError(await remove("outsider", t.m, rel.id), 404, "not_found");
    // Quan hệ có thật nhưng không dính tới P4.
    await expectError(await remove("pm", t.p4, rel.id), 404, "not_found");
    await expectError(await remove("pm", t.p5, "xyz"), 404, "not_found");
    await expectError(
      await handleDeleteRelation(
        send("DELETE", `/api/v1/tasks/${t.m}/relations/${rel.id}`, undefined, {
          origin: null,
        }),
        t.m,
        rel.id,
        deps(jars.pm),
      ),
      403,
      "forbidden",
    );

    // Xóa từ phía task đích (M).
    const res = await remove("pm", t.m, rel.id);
    expect(res.status).toBe(204);
    await expectError(await show("pm", t.p5, rel.id), 404, "not_found");
    await expectError(await remove("pm", t.p5, rel.id), 404, "not_found");

    // Thành viên xóa quan hệ giữa hai task mình sửa được.
    const own = (await listOf("member", t.m)).find((r) => r.task.id === t.as);
    expect(own).toBeDefined();
    expect((await remove("member", t.as, own!.id)).status).toBe(204);
  });

  it("xóa task thì quan hệ mất", async () => {
    await createOk("pm", t.p6, { kind: "blocks", to_task_id: t.p4 });
    expect((await listOf("pm", t.p4)).some((r) => r.task.id === t.p6)).toBe(
      true,
    );
    const { error } = await service.from("tasks").delete().eq("id", t.p6);
    if (error) throw error;
    expect((await listOf("pm", t.p4)).some((r) => r.task.id === t.p6)).toBe(
      false,
    );
  });

  it("hai yêu cầu đồng thời X→Y và Y→X: đúng một thành công, một 409", async () => {
    for (let i = 0; i < 8; i++) {
      const x = await task(`cx${i}`, projectA, users.pm);
      const y = await task(`cy${i}`, projectA, users.pm);
      const [a, b] = await Promise.all([
        create("pm", x, { kind: "blocks", to_task_id: y }),
        create("admin", y, { kind: "precedes", to_task_id: x }),
      ]);
      expect([a.status, b.status].sort()).toEqual([201, 409]);
    }
  });
});
