/**
 * Test tích hợp Story E6-1 (QLDA-49) với Supabase cục bộ: nhật ký activity_logs.
 * Đi qua API task hiện có (lõi Route Handler lib/tasks/handlers.ts với client phiên tạo từ hũ
 * cookie), rồi đọc activity_logs bằng client phiên của từng vai trò (RLS thật qua PostgREST).
 * Không có endpoint đọc nhật ký (Story E6-2).
 *
 * Chạy: make db-start && make test-integration. Chỉ chấp nhận URL localhost.
 * Tài khoản và dự án tạo tạm, xóa ở afterAll. Nhật ký sinh ra trong lúc test KHÔNG xóa được
 * (BR-09, có chủ đích) nên còn lại trong CSDL cục bộ, gắn với id dự án ngẫu nhiên.
 */
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signInWithPassword } from "@/lib/auth/sign-in";
import {
  handleCreateTask,
  handleDeleteTask,
  handlePatchTask,
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

interface ActivityLog {
  id: number;
  project_id: string;
  actor_id: string | null;
  entity_type: string;
  entity_id: string;
  action: string;
  changes: { before: unknown; after: unknown };
  created_at: string;
}

function send(
  method: "POST" | "PATCH" | "DELETE",
  path: string,
  body?: unknown,
) {
  const headers = new Headers({ origin: APP_ORIGIN });
  if (body !== undefined) headers.set("content-type", "application/json");
  return new Request(new URL(path, APP_ORIGIN), {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe.skipIf(!enabled)("Nhật ký activity_logs (Supabase cục bộ)", () => {
  const tag = randomUUID().slice(0, 8);
  const password = `It-${randomUUID()}`;
  const created: string[] = [];
  const users: Record<string, string> = {};
  const jars: Record<string, CookieJar> = {};
  let service: SupabaseClient;
  let projectA: string;

  const email = (label: string) => `it-e6-1-${label}-${tag}@example.com`;
  const client = (who: string) => sessionClient(jars[who]);

  async function logsOf(who: string, entityId: string) {
    const { data, error } = await client(who)
      .from("activity_logs")
      .select("*")
      .eq("entity_id", entityId)
      .order("id");
    expect(error).toBeNull();
    return (data ?? []) as ActivityLog[];
  }

  async function createTask(who: string, body: Record<string, unknown>) {
    const res = await handleCreateTask(
      send("POST", `/api/v1/projects/${projectA}/tasks`, body),
      projectA,
      { session: client(who) },
    );
    expect(res.status).toBe(201);
    return ((await res.json()) as { data: Task }).data;
  }

  const patchTask = (who: string, id: string, body: unknown) =>
    handlePatchTask(send("PATCH", `/api/v1/tasks/${id}`, body), id, {
      session: client(who),
    });

  beforeAll(async () => {
    assertLocalSupabase();
    service = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    for (const label of ["admin", "pm", "member", "viewer", "outsider"]) {
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
    const { error: adminError } = await service
      .from("profiles")
      .update({ is_admin: true })
      .eq("id", users.admin);
    if (adminError) throw adminError;

    projectA = randomUUID();
    const project = await service.from("projects").insert({
      id: projectA,
      name: `IT Nhật ký ${tag}`,
      created_by: users.pm,
    });
    if (project.error) throw project.error;
    const members = await service.from("project_members").insert([
      { project_id: projectA, user_id: users.member, role: "member" },
      { project_id: projectA, user_id: users.viewer, role: "viewer" },
    ]);
    if (members.error) throw members.error;

    for (const label of Object.keys(users)) {
      const jar = new CookieJar();
      const result = await signInWithPassword(sessionClient(jar), {
        email: email(label),
        password,
      });
      expect(result.ok).toBe(true);
      jars[label] = jar;
    }
  });

  afterAll(async () => {
    if (!service) return;
    if (projectA) await service.from("projects").delete().eq("id", projectA);
    for (const id of created) await service.auth.admin.deleteUser(id);
  });

  it("AC1: PATCH task qua API → PM đọc được bản ghi gồm người, thời gian, trước và sau", async () => {
    const task = await createTask("pm", {
      title: "Viết đặc tả",
      assignee_id: users.member,
    });
    const before = Date.now();
    const res = await patchTask("member", task.id, {
      title: "Viết đặc tả v2",
      priority: "high",
    });
    expect(res.status).toBe(200);

    const logs = await logsOf("pm", task.id);
    expect(logs.map((l) => l.action)).toEqual(["create", "update"]);
    expect(logs[0]).toMatchObject({
      project_id: projectA,
      actor_id: users.pm,
      entity_type: "task",
      changes: { before: null, after: { title: "Viết đặc tả" } },
    });
    const update = logs[1];
    expect(update).toMatchObject({
      project_id: projectA,
      actor_id: users.member,
      entity_type: "task",
      entity_id: task.id,
    });
    expect(update.changes).toEqual({
      before: { title: "Viết đặc tả", priority: "medium" },
      after: { title: "Viết đặc tả v2", priority: "high" },
    });
    // Thời gian ghi nằm quanh lúc sửa (cho phép lệch đồng hồ giữa máy và container).
    expect(Math.abs(Date.parse(update.created_at) - before)).toBeLessThan(
      60_000,
    );

    // Chỉ đổi thứ tự kéo thả (position) thì không sinh bản ghi.
    expect((await patchTask("pm", task.id, { position: 3 })).status).toBe(200);
    expect(await logsOf("pm", task.id)).toHaveLength(2);
  });

  it("Ai đọc được: PM của dự án và Admin; Thành viên, Người xem, người ngoài không", async () => {
    const task = await createTask("member", { title: "Quyền đọc nhật ký" });
    expect(await logsOf("pm", task.id)).toHaveLength(1);
    expect(await logsOf("admin", task.id)).toHaveLength(1);
    expect(await logsOf("member", task.id)).toEqual([]);
    expect(await logsOf("viewer", task.id)).toEqual([]);
    expect(await logsOf("outsider", task.id)).toEqual([]);
  });

  it("AC2: không vai trò nào sửa, xóa, chèn nhật ký qua API, kể cả service_role", async () => {
    const task = await createTask("pm", { title: "Không sửa được nhật ký" });
    const [log] = await logsOf("pm", task.id);

    const clients: [string, SupabaseClient][] = [
      ...["pm", "member", "viewer", "admin", "outsider"].map(
        (who) => [who, client(who)] as [string, SupabaseClient],
      ),
      ["service_role", service],
    ];
    for (const [who, c] of clients) {
      const upd = await c
        .from("activity_logs")
        .update({ changes: { before: null, after: null } })
        .eq("id", log.id);
      expect(upd.error?.code, `${who} UPDATE`).toBe("42501");
      const del = await c.from("activity_logs").delete().eq("id", log.id);
      expect(del.error?.code, `${who} DELETE`).toBe("42501");
      const ins = await c.from("activity_logs").insert({
        project_id: projectA,
        entity_type: "task",
        entity_id: task.id,
        action: "update",
        changes: { before: null, after: null },
      });
      expect(ins.error?.code, `${who} INSERT`).toBe("42501");
    }

    const { data } = await service
      .from("activity_logs")
      .select("*")
      .eq("entity_id", task.id);
    expect(data).toEqual([log]);
  });

  it("Xóa task qua API vẫn để lại bản ghi (kể cả bản ghi xóa)", async () => {
    const task = await createTask("pm", { title: "Sẽ bị xóa" });
    const res = await handleDeleteTask(
      send("DELETE", `/api/v1/tasks/${task.id}`),
      task.id,
      { session: client("pm") },
    );
    expect(res.status).toBe(204);

    const logs = await logsOf("pm", task.id);
    expect(logs.map((l) => l.action)).toEqual(["create", "delete"]);
    expect(logs[1]).toMatchObject({
      actor_id: users.pm,
      changes: { before: { title: "Sẽ bị xóa" }, after: null },
    });
  });
});
