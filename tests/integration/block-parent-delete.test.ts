/**
 * Test tích hợp QLDA-81 với Supabase cục bộ: DELETE /api/v1/tasks/{id} với task còn việc con trả
 * 422 kèm `subtask_count` (mọi cấp), giữ thứ tự kiểm Origin 403 → phiên 401 → 404 → vai trò 403 →
 * 422; xóa lá 204; xóa dần từ dưới lên được. Đường ghi service_role cũng bị chặn; xóa dự án và xóa
 * tài khoản (dây chuyền) vẫn chạy. Ca theo từng vai trò ở mức CSDL: block-parent-delete.test.sql.
 *
 * Chạy: make db-start && make test-integration. Tài khoản, dự án tạo tạm, xóa ở afterAll.
 */
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signInWithPassword } from "@/lib/auth/sign-in";
import { strings } from "@/lib/strings";
import {
  handleCreateTask,
  handleDeleteTask,
  type TaskDeps,
} from "@/lib/tasks/handlers";
import type { Task } from "@/lib/tasks/model";
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

interface ErrorBody {
  error: {
    code: string;
    message: string;
    message_key?: string;
    subtask_count?: number;
  };
}

function request(
  method: "POST" | "DELETE",
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

async function expectError(res: Response, status: number, code: string) {
  expect(res.status).toBe(status);
  const body = (await res.json()) as ErrorBody;
  expect(body.error.code).toBe(code);
  return body.error;
}

describe.skipIf(!enabled)("QLDA-81: chặn xóa task cha còn việc con", () => {
  const tag = randomUUID().slice(0, 8);
  const password = `It-${randomUUID()}`;
  const created: string[] = [];
  const users: Record<string, string> = {};
  const jars: Record<string, CookieJar> = {};
  let projectA: string;

  const email = (label: string) => `it-q81-${label}-${tag}@example.com`;
  const deps = (who: string): TaskDeps => ({
    session: sessionClient(jars[who] ?? new CookieJar()),
  });

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

  async function createOk(who: string, parentId?: string): Promise<Task> {
    const res = await handleCreateTask(
      request("POST", `/api/v1/projects/${projectA}/tasks`, {
        title: `IT Q81 ${tag}`,
        ...(parentId ? { parent_id: parentId } : {}),
      }),
      projectA,
      deps(who),
    );
    expect(res.status).toBe(201);
    return ((await res.json()) as { data: Task }).data;
  }

  const remove = (who: string, id: string, origin: string | null = APP_ORIGIN) =>
    handleDeleteTask(
      request("DELETE", `/api/v1/tasks/${id}`, undefined, origin),
      id,
      deps(who),
    );

  async function alive(ids: string[]) {
    const { data, error } = await service.from("tasks").select("id").in("id", ids);
    if (error) throw error;
    return data.length;
  }

  beforeAll(async () => {
    assertLocalSupabase();
    service = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    for (const label of ["admin", "pm", "member", "viewer", "outsider", "gone"]) {
      await createUser(label);
    }
    const admin = await service
      .from("profiles")
      .update({ is_admin: true })
      .eq("id", users.admin);
    if (admin.error) throw admin.error;

    projectA = randomUUID();
    const project = await service
      .from("projects")
      .insert({ id: projectA, name: `IT Q81 ${tag}`, created_by: users.pm });
    if (project.error) throw project.error;
    const members = await service.from("project_members").insert([
      { project_id: projectA, user_id: users.member, role: "member" },
      { project_id: projectA, user_id: users.viewer, role: "viewer" },
      { project_id: projectA, user_id: users.gone, role: "member" },
    ]);
    if (members.error) throw members.error;

    for (const label of ["admin", "pm", "member", "viewer", "outsider"]) {
      await signIn(label);
    }
  });

  afterAll(async () => {
    if (!service) return;
    if (projectA) await service.from("projects").delete().eq("id", projectA);
    for (const id of created) await service.auth.admin.deleteUser(id);
  });

  it("task còn con, cháu (người khác tạo): 422 business_rule_violated kèm subtask_count, cây còn nguyên", async () => {
    const root = await createOk("member");
    const child = await createOk("pm", root.id);
    const grand = await createOk("pm", child.id);
    await createOk("pm", root.id);

    // Thành viên xóa task mình tạo, có con/cháu do PM tạo; PM, Admin xóa task của người khác.
    for (const who of ["member", "pm", "admin"]) {
      const error = await expectError(
        await remove(who, root.id),
        422,
        "business_rule_violated",
      );
      expect(error.subtask_count).toBe(3);
      expect(error.message).toBe(strings.taskDelete.errors.hasSubtasks);
      expect(error.message_key).toBe("taskDelete.errors.hasSubtasks");
    }
    // Task cấp giữa còn một cháu.
    const mid = await expectError(
      await remove("pm", child.id),
      422,
      "business_rule_violated",
    );
    expect(mid.subtask_count).toBe(1);
    expect(await alive([root.id, child.id, grand.id])).toBe(3);
  });

  it("thứ tự kiểm giữ nguyên: Origin 403 → phiên 401 → 404 → vai trò 403 → 422", async () => {
    const root = await createOk("pm");
    await createOk("pm", root.id);

    await expectError(await remove("pm", root.id, "https://evil.example"), 403, "forbidden");
    await expectError(await remove("nobody", root.id), 401, "unauthenticated");
    await expectError(await remove("outsider", root.id), 404, "not_found");
    await expectError(await remove("viewer", root.id), 403, "forbidden");
    // Thành viên không tạo task này: 403, không lộ số việc con.
    const forbidden = await expectError(await remove("member", root.id), 403, "forbidden");
    expect(forbidden.subtask_count).toBeUndefined();
    await expectError(await remove("pm", root.id), 422, "business_rule_violated");
  });

  it("xóa lá 204; xóa dần từ dưới lên thì xóa được cha", async () => {
    const root = await createOk("member");
    const child = await createOk("member", root.id);
    const grand = await createOk("member", child.id);

    expect((await remove("member", grand.id)).status).toBe(204);
    const still = await expectError(
      await remove("member", root.id),
      422,
      "business_rule_violated",
    );
    expect(still.subtask_count).toBe(1);
    expect((await remove("member", child.id)).status).toBe(204);
    expect((await remove("member", root.id)).status).toBe(204);
    expect(await alive([root.id, child.id, grand.id])).toBe(0);
  });

  it("service_role ghi thẳng cũng bị chặn (khóa ngoại 23503)", async () => {
    const root = await createOk("pm");
    const child = await createOk("pm", root.id);
    const { error } = await service.from("tasks").delete().eq("id", root.id);
    expect(error?.code).toBe("23503");
    expect(error?.message).toContain("tasks_parent_id_fkey");
    expect(await alive([root.id, child.id])).toBe(2);
  });

  it("xóa tài khoản người tạo cây task và xóa dự án có cây 3 cấp vẫn chạy (dây chuyền)", async () => {
    const root = randomUUID();
    const child = randomUUID();
    const grand = randomUUID();
    for (const [id, parent] of [
      [root, null],
      [child, root],
      [grand, child],
    ] as const) {
      const { error } = await service.from("tasks").insert({
        id,
        project_id: projectA,
        title: `IT Q81 gone ${tag}`,
        created_by: users.gone,
        assignee_id: users.gone,
        parent_id: parent,
      });
      if (error) throw error;
    }

    const deleted = await service.auth.admin.deleteUser(users.gone);
    expect(deleted.error).toBeNull();
    created.splice(created.indexOf(users.gone), 1);
    const { data, error } = await service
      .from("tasks")
      .select("id, created_by, assignee_id")
      .in("id", [root, child, grand]);
    if (error) throw error;
    expect(data).toHaveLength(3);
    expect(data.every((t) => t.created_by === null && t.assignee_id === null)).toBe(true);

    const project = await service.from("projects").delete().eq("id", projectA).select("id");
    expect(project.error).toBeNull();
    expect(project.data).toHaveLength(1);
    const left = await service.from("tasks").select("id").eq("project_id", projectA);
    expect(left.data).toEqual([]);
  });
});
