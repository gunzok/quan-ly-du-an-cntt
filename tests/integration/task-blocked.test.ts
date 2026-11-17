/**
 * Test tích hợp Story E8-3 (QLDA-58) với Supabase cục bộ: cờ `blocked`/`blocked_by` ở
 * GET /projects/{id}/tasks, GET /tasks/{id}, và PATCH sang nhóm done khi còn bị chặn (BR-06: vẫn
 * 200, kèm `warnings`). Gọi thẳng lõi Route Handler với client phiên (RLS áp dụng).
 *
 * Chạy: make db-start && make test-integration. Tài khoản, dự án tạo tạm, xóa ở afterAll.
 */
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signInWithPassword } from "@/lib/auth/sign-in";
import type { BlockedWarning } from "@/lib/tasks/blocked";
import {
  handleGetTask,
  handleListTasks,
  handlePatchTask,
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

describe.skipIf(!enabled)("Cờ bị chặn ở API task (Supabase cục bộ)", () => {
  const tag = randomUUID().slice(0, 8);
  const password = `It-${randomUUID()}`;
  const created: string[] = [];
  const users: Record<string, string> = {};
  const jars: Record<string, CookieJar> = {};
  const t: Record<string, string> = {};
  let projectA: string;
  let doneStatus: string;
  let todoStatus: string;

  const email = (label: string) => `it-e8-3-${label}-${tag}@example.com`;
  const deps = (who: string): TaskDeps => ({
    session: sessionClient(jars[who]),
  });

  async function task(
    key: string,
    createdBy: string,
    assignee: string | null = null,
  ) {
    const id = randomUUID();
    const { error } = await service.from("tasks").insert({
      id,
      project_id: projectA,
      title: `IT ${key} ${tag}`,
      created_by: createdBy,
      assignee_id: assignee,
    });
    if (error) throw error;
    t[key] = id;
  }

  async function relate(from: string, to: string, kind: string) {
    const { error } = await service
      .from("task_relations")
      .insert({ from_task_id: t[from], to_task_id: t[to], kind });
    if (error) throw error;
  }

  async function setStatus(key: string, statusId: string) {
    const { error } = await service
      .from("tasks")
      .update({ status_id: statusId })
      .eq("id", t[key]);
    if (error) throw error;
  }

  const listAll = async (who: string) => {
    const res = await handleListTasks(
      new Request(
        new URL(`/api/v1/projects/${projectA}/tasks?limit=500`, APP_ORIGIN),
      ),
      projectA,
      deps(who),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Task[] };
    return new Map(body.data.map((x) => [x.id, x]));
  };

  const getOne = (who: string, key: string) =>
    handleGetTask(
      new Request(new URL(`/api/v1/tasks/${t[key]}`, APP_ORIGIN)),
      t[key],
      deps(who),
    );

  const patch = (who: string, key: string, body: unknown) =>
    handlePatchTask(
      new Request(new URL(`/api/v1/tasks/${t[key]}`, APP_ORIGIN), {
        method: "PATCH",
        headers: { "content-type": "application/json", origin: APP_ORIGIN },
        body: JSON.stringify(body),
      }),
      t[key],
      deps(who),
    );

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
    const admin = await service
      .from("profiles")
      .update({ is_admin: true })
      .eq("id", users.admin);
    if (admin.error) throw admin.error;

    projectA = randomUUID();
    const project = await service
      .from("projects")
      .insert({ id: projectA, name: `IT E8-3 ${tag}`, created_by: users.pm });
    if (project.error) throw project.error;
    const members = await service.from("project_members").insert([
      { project_id: projectA, user_id: users.member, role: "member" },
      { project_id: projectA, user_id: users.viewer, role: "viewer" },
    ]);
    if (members.error) throw members.error;
    const statuses = await service
      .from("task_statuses")
      .select("id, category, position")
      .eq("project_id", projectA)
      .order("position");
    if (statuses.error) throw statuses.error;
    doneStatus = statuses.data.find((s) => s.category === "done")!.id;
    todoStatus = statuses.data.find((s) => s.category === "todo")!.id;

    // target: bị b1, b2 chặn (mở). onlyDone: chỉ bị d chặn (đã xong). prec: chỉ có precedes.
    // removed: bị b1 chặn, quan hệ sẽ bị xóa. free: không quan hệ.
    await task("target", users.pm, users.member);
    for (const k of [
      "b1",
      "b2",
      "d",
      "p",
      "onlyDone",
      "prec",
      "removed",
      "free",
    ]) {
      await task(k, users.pm);
    }
    await relate("b1", "target", "blocks");
    await relate("b2", "target", "blocks");
    await relate("d", "onlyDone", "blocks");
    await relate("p", "prec", "precedes");
    await relate("b1", "removed", "blocks");
    await setStatus("d", doneStatus);

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

  it("danh sách: cờ blocked đúng các ca biên, mọi vai trò trong dự án thấy như nhau", async () => {
    for (const who of ["pm", "member", "viewer", "admin"]) {
      const rows = await listAll(who);
      const target = rows.get(t.target)!;
      expect(target.blocked, who).toBe(true);
      expect(new Set(target.blocked_by), who).toEqual(new Set([t.b1, t.b2]));
      expect(target.blocked_by_count, who).toBe(2);
      for (const k of ["onlyDone", "prec", "free", "b1", "d"]) {
        expect(rows.get(t[k])!.blocked, `${who}/${k}`).toBe(false);
        expect(rows.get(t[k])!.blocked_by, `${who}/${k}`).toEqual([]);
      }
    }
  });

  it("chi tiết: blocked + blocked_by; người ngoài 404", async () => {
    const res = await getOne("viewer", "target");
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as { data: Task };
    expect(data.blocked).toBe(true);
    expect(data.blocked_by).toHaveLength(2);
    expect((await getOne("outsider", "target")).status).toBe(404);
  });

  it("xóa quan hệ blocks: hết bị chặn", async () => {
    let res = await getOne("pm", "removed");
    expect(((await res.json()) as { data: Task }).data.blocked).toBe(true);
    const { error } = await service
      .from("task_relations")
      .delete()
      .eq("from_task_id", t.b1)
      .eq("to_task_id", t.removed);
    if (error) throw error;
    res = await getOne("pm", "removed");
    expect(((await res.json()) as { data: Task }).data).toMatchObject({
      blocked: false,
      blocked_by: [],
      blocked_by_count: 0,
    });
  });

  it("PATCH sang nhóm done khi bị chặn: 200, task đã xong, kèm warnings (BR-06)", async () => {
    const res = await patch("member", "target", {
      status_id: doneStatus,
      position: 3,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: Task;
      warnings?: BlockedWarning[];
    };
    expect(body.data.status_id).toBe(doneStatus);
    expect(body.data.completed_at).not.toBeNull();
    // Task đã xong không còn hiện bị chặn.
    expect(body.data.blocked).toBe(false);
    expect(body.warnings).toHaveLength(1);
    expect(body.warnings![0]!.code).toBe("blocked_by_open_task");
    expect(new Set(body.warnings![0]!.task_ids)).toEqual(new Set([t.b1, t.b2]));

    // Đã xong rồi, sửa tiếp (đổi vị trí): không cảnh báo lại.
    const again = await patch("member", "target", { position: 5 });
    expect(again.status).toBe(200);
    expect(
      ((await again.json()) as { warnings?: unknown }).warnings,
    ).toBeUndefined();

    // Mở lại: bị chặn lại, không cảnh báo.
    const reopen = await patch("member", "target", { status_id: todoStatus });
    const reopened = (await reopen.json()) as {
      data: Task;
      warnings?: unknown;
    };
    expect(reopened.data.blocked).toBe(true);
    expect(reopened.warnings).toBeUndefined();
  });

  it("PATCH sang nhóm done khi không bị chặn (hoặc chỉ bị task đã xong chặn): không warnings", async () => {
    for (const k of ["free", "onlyDone", "prec"]) {
      const res = await patch("pm", k, { status_id: doneStatus });
      expect(res.status, k).toBe(200);
      expect(
        ((await res.json()) as { warnings?: unknown }).warnings,
        k,
      ).toBeUndefined();
    }
  });

  it("task chặn xong: task bị chặn hết bị chặn", async () => {
    await setStatus("b1", doneStatus);
    let rows = await listAll("pm");
    expect(rows.get(t.target)).toMatchObject({
      blocked: true,
      blocked_by: [t.b2],
    });
    await setStatus("b2", doneStatus);
    rows = await listAll("pm");
    expect(rows.get(t.target)!.blocked).toBe(false);
  });
});
