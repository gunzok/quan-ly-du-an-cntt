/**
 * Test tích hợp Story E3-1 (QLDA-47) với Supabase cục bộ: thao tác của bảng Kanban qua API có sẵn
 * (PATCH /api/v1/tasks/{id} với status_id, position) và nhật ký tự động (trigger activity_logs).
 *
 * AC1: Thành viên có quyền sửa kéo thẻ sang cột khác → trạng thái đổi và CÓ nhật ký.
 * AC2: menu "Chuyển đến cột" gửi cùng request (status_id + position cuối cột), kiểm ở đây và e2e.
 * Kèm các nhánh lỗi giao diện phải hoàn tác: 403 (Thành viên sửa task người khác, Người xem),
 * 422 BR-04 (đóng cha còn việc con chưa xong).
 *
 * Tài khoản và dự án tạo tạm với email ngẫu nhiên, xóa ở afterAll; không đụng seed.
 */
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signInWithPassword } from "@/lib/auth/sign-in";
import { groupByStatus } from "@/lib/kanban/board";
import { planMove } from "@/lib/kanban/position";
import {
  handleCreateTask,
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

function send(method: "POST" | "PATCH", path: string, body: unknown) {
  return new Request(new URL(path, APP_ORIGIN), {
    method,
    headers: { "content-type": "application/json", origin: APP_ORIGIN },
    body: JSON.stringify(body),
  });
}

interface LogRow {
  actor_id: string | null;
  action: string;
  changes: {
    before: Record<string, unknown> | null;
    after: Record<string, unknown> | null;
  };
}

describe.skipIf(!enabled)(
  "Bảng Kanban: chuyển cột qua API (Supabase cục bộ)",
  () => {
    const tag = randomUUID().slice(0, 8);
    const password = `It-${randomUUID()}`;
    const created: string[] = [];
    const users: Record<string, string> = {};
    const jars: Record<string, CookieJar> = {};
    let projectId: string;
    const status: Record<string, string> = {};

    const deps = (who: string): TaskDeps => ({
      session: sessionClient(jars[who]),
    });

    async function createUser(label: string) {
      const { data, error } = await service.auth.admin.createUser({
        email: `it-e3-1-${label}-${tag}@example.com`,
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
        email: `it-e3-1-${label}-${tag}@example.com`,
        password,
      });
      expect(result.ok).toBe(true);
      jars[label] = jar;
    }

    async function createTask(who: string, body: Record<string, unknown>) {
      const res = await handleCreateTask(
        send("POST", `/api/v1/projects/${projectId}/tasks`, body),
        projectId,
        deps(who),
      );
      expect(res.status).toBe(201);
      return ((await res.json()) as { data: Task }).data;
    }

    const move = (who: string, id: string, body: unknown) =>
      handlePatchTask(
        send("PATCH", `/api/v1/tasks/${id}`, body),
        id,
        deps(who),
      );

    async function listAll(who: string): Promise<Task[]> {
      const res = await handleListTasks(
        new Request(
          new URL(`/api/v1/projects/${projectId}/tasks?limit=100`, APP_ORIGIN),
        ),
        projectId,
        deps(who),
      );
      expect(res.status).toBe(200);
      return ((await res.json()) as TaskListResponse).data;
    }

    async function logsOf(taskId: string): Promise<LogRow[]> {
      const { data, error } = await service
        .from("activity_logs")
        .select("actor_id, action, changes")
        .eq("entity_type", "task")
        .eq("entity_id", taskId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data as LogRow[];
    }

    beforeAll(async () => {
      assertLocalSupabase();
      service = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      for (const label of ["pm", "member", "member2", "viewer"])
        await createUser(label);
      projectId = randomUUID();
      const project = await service.from("projects").insert({
        id: projectId,
        name: `IT Kanban ${tag}`,
        created_by: users.pm,
      });
      if (project.error) throw project.error;
      const members = await service.from("project_members").insert([
        { project_id: projectId, user_id: users.member, role: "member" },
        { project_id: projectId, user_id: users.member2, role: "member" },
        { project_id: projectId, user_id: users.viewer, role: "viewer" },
      ]);
      if (members.error) throw members.error;
      const statuses = await service
        .from("task_statuses")
        .select("id, category, position")
        .eq("project_id", projectId)
        .order("position");
      if (statuses.error) throw statuses.error;
      // Trạng thái mặc định: lấy cột đầu của từng nhóm.
      for (const s of statuses.data as { id: string; category: string }[]) {
        status[s.category] ??= s.id;
      }
      for (const label of Object.keys(users)) await signIn(label);
    });

    afterAll(async () => {
      if (!service) return;
      if (projectId)
        await service.from("projects").delete().eq("id", projectId);
      for (const id of created) await service.auth.admin.deleteUser(id);
    });

    it("AC1: Thành viên kéo task mình phụ trách sang cột khác → trạng thái đổi, có nhật ký", async () => {
      const task = await createTask("pm", {
        title: `Kéo sang cột ${tag}`,
        assignee_id: users.member,
        status_id: status.todo,
      });
      const res = await move("member", task.id, {
        status_id: status.in_progress,
        position: 1.5,
      });
      expect(res.status).toBe(200);
      const saved = ((await res.json()) as { data: Task }).data;
      expect(saved.status_id).toBe(status.in_progress);
      expect(saved.position).toBe(1.5);

      const logs = await logsOf(task.id);
      const update = logs.find((l) => l.action === "update");
      expect(update).toBeDefined();
      expect(update!.actor_id).toBe(users.member);
      expect(update!.changes.before).toMatchObject({ status_id: status.todo });
      expect(update!.changes.after).toMatchObject({
        status_id: status.in_progress,
      });
    });

    it("chỉ đổi thứ tự trong cột (position) → lưu được, không ghi nhật ký (nhiễu, theo thiết kế E6)", async () => {
      const task = await createTask("member", {
        title: `Đổi thứ tự ${tag}`,
        status_id: status.todo,
      });
      const before = (await logsOf(task.id)).length;
      const res = await move("member", task.id, { position: -3.25 });
      expect(res.status).toBe(200);
      expect(((await res.json()) as { data: Task }).data.position).toBe(-3.25);
      expect((await logsOf(task.id)).length).toBe(before);
    });

    it("chèn giữa hai thẻ trùng position: kế hoạch dãn hàng xóm, sau khi lưu thứ tự đọc lại đúng", async () => {
      const col = status.in_progress;
      const a = await createTask("pm", {
        title: `A ${tag}`,
        status_id: col,
        position: 10,
      });
      const b = await createTask("pm", {
        title: `B ${tag}`,
        status_id: col,
        position: 10,
      });
      const c = await createTask("pm", {
        title: `C ${tag}`,
        status_id: col,
        position: 10,
      });
      const x = await createTask("pm", {
        title: `X ${tag}`,
        status_id: status.todo,
      });

      const columnOf = async () =>
        (
          groupByStatus([{ id: col }], await listAll("pm")).get(col) ?? []
        ).filter((t) => [a.id, b.id, c.id, x.id].includes(t.id));
      const column = await columnOf();
      // Chèn X giữa A và B (chỉ số 1 trong cột A, B, C cùng position 10).
      const at = column.findIndex((t) => t.id === a.id) + 1;
      const plan = planMove(column, at, x.position);
      expect(plan.exact).toBe(true);
      expect(
        (await move("pm", x.id, { status_id: col, position: plan.position }))
          .status,
      ).toBe(200);
      for (const u of plan.others) {
        expect((await move("pm", u.id, { position: u.position })).status).toBe(
          200,
        );
      }
      const ids = (await columnOf()).map((t) => t.id);
      expect(ids.indexOf(x.id)).toBe(ids.indexOf(a.id) + 1);
      expect(ids.indexOf(b.id)).toBeGreaterThan(ids.indexOf(x.id));
      expect(ids.indexOf(c.id)).toBeGreaterThan(ids.indexOf(b.id));
    });

    it("Thành viên kéo task không phụ trách, không tạo → 403, task giữ nguyên, không có nhật ký sửa", async () => {
      const task = await createTask("pm", {
        title: `Của người khác ${tag}`,
        assignee_id: users.member2,
        status_id: status.todo,
      });
      const res = await move("member", task.id, {
        status_id: status.done,
        position: 0,
      });
      expect(res.status).toBe(403);
      const { data } = await service
        .from("tasks")
        .select("status_id")
        .eq("id", task.id)
        .single();
      expect(data!.status_id).toBe(status.todo);
      expect((await logsOf(task.id)).some((l) => l.action === "update")).toBe(
        false,
      );
    });

    it("Người xem không chuyển được task → 403", async () => {
      const task = await createTask("pm", {
        title: `Người xem ${tag}`,
        status_id: status.todo,
      });
      const res = await move("viewer", task.id, {
        status_id: status.in_progress,
        position: 0,
      });
      expect(res.status).toBe(403);
    });

    it("BR-04: kéo task cha sang cột hoàn thành khi còn việc con chưa xong → 422 kèm task_ids", async () => {
      const parent = await createTask("member", {
        title: `Cha ${tag}`,
        status_id: status.todo,
      });
      const child = await createTask("member", {
        title: `Con ${tag}`,
        parent_id: parent.id,
        status_id: status.todo,
      });
      const res = await move("member", parent.id, {
        status_id: status.done,
        position: 0,
      });
      expect(res.status).toBe(422);
      const body = (await res.json()) as {
        error: { code: string; task_ids?: string[] };
      };
      expect(body.error.code).toBe("business_rule_violated");
      expect(body.error.task_ids).toContain(child.id);
    });
  },
);
