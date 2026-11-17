/**
 * Test tích hợp Story E2-6 (QLDA-43): ma trận quyền sửa task theo vai trò ở lớp API (BR-02, BR-03).
 * Lớp CSDL có ma trận riêng: supabase/tests/database/task-permissions-matrix.test.sql.
 *
 * Mỗi persona thử PATCH từng trường (tên, mô tả, ưu tiên, ngày, vị trí, trạng thái, hoàn thành,
 * loại, nhãn, cha, giao/gỡ người phụ trách) trên một task mới tạo bằng khóa service; kiểm mã HTTP
 * theo quy ước (401 → 404 → 403 → 400), dữ liệu thật không đổi khi bị từ chối, và
 * `permissions` của GET /tasks/{id} khớp với kết quả thật.
 *
 * Chạy: make db-start && make test-integration. Tài khoản, dự án tạo tạm, xóa ở afterAll.
 */
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signInWithPassword } from "@/lib/auth/sign-in";
import type { TaskDetail } from "@/lib/tasks/detail";
import {
  handleCreateTask,
  handleGetTask,
  handlePatchTask,
  type TaskDeps,
} from "@/lib/tasks/handlers";
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

type Persona =
  | "admin"
  | "pm"
  | "member"
  | "member2"
  | "viewer"
  | "outsider"
  | "locked"
  | "anon";

/** Người tạo, người phụ trách của task đích trong một ca. */
interface Target {
  created_by: Persona;
  assignee: Persona | null;
}

const FIELDS = [
  "title",
  "description",
  "priority",
  "dates",
  "position",
  "status",
  "complete",
  "type",
  "labels",
  "parent",
  "assign",
  "unassign",
] as const;
type Field = (typeof FIELDS)[number];

interface ErrorBody {
  error: { code: string; message: string };
}

describe.skipIf(!enabled)("Ma trận quyền sửa task qua API (E2-6)", () => {
  const tag = randomUUID().slice(0, 8);
  const password = `It-${randomUUID()}`;
  const created: string[] = [];
  const users = {} as Record<Persona, string>;
  const jars = {} as Record<Persona, CookieJar>;
  let projectA: string;
  let statusInProgress: string;
  let statusDone: string;
  let typeBug: string;
  let label: string;
  let parentId: string;

  const email = (label: string) => `it-e2-6-${label}-${tag}@example.com`;

  function deps(who: Persona): TaskDeps {
    return { session: sessionClient(jars[who]) };
  }

  function send(method: "POST" | "PATCH", path: string, body: unknown) {
    return new Request(new URL(path, APP_ORIGIN), {
      method,
      headers: { "content-type": "application/json", origin: APP_ORIGIN },
      body: JSON.stringify(body),
    });
  }

  const patch = (who: Persona, id: string, body: unknown) =>
    handlePatchTask(send("PATCH", `/api/v1/tasks/${id}`, body), id, deps(who));
  const create = (who: Persona, body: unknown) =>
    handleCreateTask(
      send("POST", `/api/v1/projects/${projectA}/tasks`, body),
      projectA,
      deps(who),
    );
  const show = (who: Persona, id: string) =>
    handleGetTask(
      new Request(new URL(`/api/v1/tasks/${id}`, APP_ORIGIN)),
      id,
      deps(who),
    );

  function bodyFor(field: Field): Record<string, unknown> {
    switch (field) {
      case "title":
        return { title: "Đã sửa tên" };
      case "description":
        return { description: "Mô tả mới" };
      case "priority":
        return { priority: "urgent" };
      case "dates":
        return { start_date: "2026-12-01", due_date: "2026-12-10" };
      case "position":
        return { position: 42 };
      case "status":
        return { status_id: statusInProgress };
      case "complete":
        return { status_id: statusDone };
      case "type":
        return { type_id: typeBug };
      case "labels":
        return { label_ids: [label] };
      case "parent":
        return { parent_id: parentId };
      case "assign":
        return { assignee_id: users.pm };
      case "unassign":
        return { assignee_id: null };
    }
  }

  /** Task mới (khóa service) để mỗi lần thử bắt đầu từ cùng một trạng thái. */
  async function makeTask(target: Target) {
    const { data, error } = await service
      .from("tasks")
      .insert({
        project_id: projectA,
        title: "Gốc",
        created_by: users[target.created_by],
        assignee_id: target.assignee ? users[target.assignee] : null,
      })
      .select("id")
      .single();
    if (error) throw error;
    return data.id as string;
  }

  /** Ảnh chụp dòng task và nhãn để chứng minh lần bị từ chối không ghi gì. */
  async function snapshot(id: string) {
    const task = await service.from("tasks").select("*").eq("id", id).single();
    const labels = await service
      .from("task_labels")
      .select("label_id")
      .eq("task_id", id);
    return { task: task.data, labels: labels.data };
  }

  /** Thử mọi trường; trả về `field=status` để so một lần, thông báo lỗi chỉ rõ ô sai. */
  async function runMatrix(who: Persona, target: Target) {
    const result: string[] = [];
    for (const field of FIELDS) {
      const id = await makeTask(target);
      const before = await snapshot(id);
      const res = await patch(who, id, bodyFor(field));
      let outcome = String(res.status);
      if (res.status >= 400) {
        const body = (await res.json()) as ErrorBody;
        outcome += `:${body.error.code}`;
        expect(await snapshot(id), `${who}/${field} không được ghi`).toEqual(
          before,
        );
      }
      result.push(`${field}=${outcome}`);
    }
    return result.join(" ");
  }

  function expected(
    code: string,
    overrides: Partial<Record<Field, string>> = {},
  ) {
    return FIELDS.map((f) => `${f}=${overrides[f] ?? code}`).join(" ");
  }

  beforeAll(async () => {
    assertLocalSupabase();
    service = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const personas: Persona[] = [
      "admin",
      "pm",
      "member",
      "member2",
      "viewer",
      "outsider",
      "locked",
    ];
    for (const label of personas) {
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
    const admin = await service
      .from("profiles")
      .update({ is_admin: true })
      .eq("id", users.admin);
    if (admin.error) throw admin.error;

    projectA = randomUUID();
    const project = await service
      .from("projects")
      .insert({ id: projectA, name: `IT E2-6 ${tag}`, created_by: users.pm });
    if (project.error) throw project.error;
    const members = await service.from("project_members").insert([
      { project_id: projectA, user_id: users.member, role: "member" },
      { project_id: projectA, user_id: users.member2, role: "member" },
      { project_id: projectA, user_id: users.viewer, role: "viewer" },
      { project_id: projectA, user_id: users.locked, role: "member" },
    ]);
    if (members.error) throw members.error;

    const statuses = await service
      .from("task_statuses")
      .select("id, name")
      .eq("project_id", projectA);
    if (statuses.error) throw statuses.error;
    const byName = (name: string) => {
      const found = statuses.data.find((s) => s.name === name);
      if (!found) throw new Error(`Thiếu trạng thái mặc định ${name}`);
      return found.id as string;
    };
    statusInProgress = byName("Đang thực hiện");
    statusDone = byName("Đã xong");
    const types = await service
      .from("task_types")
      .select("id")
      .eq("project_id", projectA)
      .eq("name", "Bug")
      .single();
    if (types.error) throw types.error;
    typeBug = types.data.id;
    const labels = await service
      .from("labels")
      .insert({ project_id: projectA, name: `Ma trận ${tag}` })
      .select("id")
      .single();
    if (labels.error) throw labels.error;
    label = labels.data.id;
    // Cha mới: Thành viên tạo nên mọi người sửa được task đích (trừ người bị từ chối) cũng sửa được cha.
    parentId = await makeTask({ created_by: "member", assignee: null });

    for (const label of personas) {
      const jar = new CookieJar();
      const result = await signInWithPassword(sessionClient(jar), {
        email: email(label),
        password,
      });
      expect(result.ok).toBe(true);
      jars[label] = jar;
    }
    jars.anon = new CookieJar();
    // Khóa sau khi đăng nhập: phiên còn hạn nhưng RLS chặn mọi dữ liệu.
    const lock = await service
      .from("profiles")
      .update({ is_active: false })
      .eq("id", users.locked);
    if (lock.error) throw lock.error;
  }, 60_000);

  afterAll(async () => {
    if (!service) return;
    if (projectA) await service.from("projects").delete().eq("id", projectA);
    for (const id of created) await service.auth.admin.deleteUser(id);
  });

  it("Admin không thuộc dự án và PM sửa được mọi trường của mọi task", async () => {
    expect(await runMatrix("admin", { created_by: "pm", assignee: null })).toBe(
      expected("200"),
    );
    expect(
      await runMatrix("pm", { created_by: "member", assignee: null }),
    ).toBe(expected("200"));
  }, 60_000);

  it("BR-03: Thành viên là người tạo sửa mọi trường, kể cả giao/gỡ người phụ trách", async () => {
    expect(
      await runMatrix("member", { created_by: "member", assignee: null }),
    ).toBe(expected("200"));
  }, 60_000);

  it("BR-03: Thành viên chỉ là người phụ trách sửa được, trừ giao đi hoặc tự gỡ mình", async () => {
    expect(
      await runMatrix("member", { created_by: "pm", assignee: "member" }),
    ).toBe(
      expected("200", {
        assign: "403:forbidden",
        unassign: "403:forbidden",
      }),
    );
  }, 60_000);

  it("AC1: Thành viên sửa task của người khác: 403 ở mọi trường, CSDL không đổi", async () => {
    expect(
      await runMatrix("member2", { created_by: "pm", assignee: null }),
    ).toBe(expected("403:forbidden"));
    // Task người khác đang giao cho người thứ ba cũng vậy.
    expect(
      await runMatrix("member2", { created_by: "pm", assignee: "member" }),
    ).toBe(expected("403:forbidden"));
  }, 60_000);

  it("AC2 / BR-02: Người xem sửa: 403 ở mọi trường (RLS chặn tiếp ở pgTAP)", async () => {
    expect(
      await runMatrix("viewer", { created_by: "member", assignee: null }),
    ).toBe(expected("403:forbidden"));
  }, 60_000);

  it("Người ngoài, người bị khóa: 404 (không lộ task); chưa đăng nhập: 401", async () => {
    expect(
      await runMatrix("outsider", { created_by: "member", assignee: null }),
    ).toBe(expected("404:not_found"));
    expect(
      await runMatrix("locked", { created_by: "locked", assignee: null }),
    ).toBe(expected("404:not_found"));
    expect(
      await runMatrix("anon", { created_by: "member", assignee: null }),
    ).toBe(expected("401:unauthenticated"));
  }, 60_000);

  it("thứ tự kiểm: vai trò 403 đứng trước schema 400 (không lộ schema cho người không có quyền)", async () => {
    const id = await makeTask({ created_by: "pm", assignee: null });
    for (const who of ["viewer", "member2"] as const) {
      const res = await patch(who, id, { khong_co: 1 });
      expect(res.status, who).toBe(403);
    }
    const res = await patch("pm", id, { khong_co: 1 });
    expect(res.status).toBe(400);
  });

  it("tạo task: Người xem 403 (BR-02); Thành viên tạo task mới được", async () => {
    let res = await create("viewer", { title: "x" });
    expect(res.status).toBe(403);
    res = await create("member2", { title: "Task của member2" });
    expect(res.status).toBe(201);
  });

  it("permissions của GET /tasks/{id} khớp kết quả PATCH thật cho mọi persona", async () => {
    const cases: [Persona, Target][] = [
      ["admin", { created_by: "pm", assignee: null }],
      ["pm", { created_by: "member", assignee: null }],
      ["member", { created_by: "member", assignee: null }],
      ["member", { created_by: "pm", assignee: "member" }],
      ["member2", { created_by: "pm", assignee: null }],
      ["viewer", { created_by: "member", assignee: null }],
    ];
    for (const [who, target] of cases) {
      const id = await makeTask(target);
      const res = await show(who, id);
      expect(res.status).toBe(200);
      const { permissions } = ((await res.json()) as { data: TaskDetail }).data;
      const label = `${who} (${target.created_by}/${target.assignee})`;
      const edit = await patch(who, id, { title: "Thử quyền" });
      expect(permissions.can_edit, label).toBe(edit.status === 200);
      const reassign = await patch(who, id, { assignee_id: users.member2 });
      expect(permissions.can_reassign, label).toBe(reassign.status === 200);
    }
  }, 60_000);
});
