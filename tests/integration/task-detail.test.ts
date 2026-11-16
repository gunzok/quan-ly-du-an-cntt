/**
 * Test tích hợp Story E2-5 (QLDA-46) với Supabase cục bộ: phần mở rộng API cho ngăn chi tiết task.
 *   - GET /api/v1/tasks/{id}: thêm `parent`, `subtasks` (cây con tóm tắt), `subtasks_truncated`,
 *     `permissions` của người gọi; trường cũ giữ nguyên.
 *   - GET /api/v1/projects/{id}/tasks?parent_id=: chỉ việc con trực tiếp.
 *   - PATCH với `expected_updated_at`: task đã đổi kể từ lần đọc thì 409, không ghi.
 * Client phiên tạo từ hũ cookie (giống trình duyệt): đi qua Origin, getUser, RLS.
 *
 * Chạy: make db-start && make test-integration. Thiếu SUPABASE_URL... thì cả nhóm BỎ QUA có
 * thông báo. Chỉ chấp nhận URL localhost. Tài khoản, dự án tạo tạm, xóa ở afterAll.
 */
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signInWithPassword } from "@/lib/auth/sign-in";
import { strings } from "@/lib/strings";
import type { TaskDetail } from "@/lib/tasks/detail";
import {
  handleCreateTask,
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

function deps(jar: CookieJar): TaskDeps {
  return { session: sessionClient(jar) };
}

function send(method: "POST" | "PATCH", path: string, body: unknown) {
  return new Request(new URL(path, APP_ORIGIN), {
    method,
    headers: { "content-type": "application/json", origin: APP_ORIGIN },
    body: JSON.stringify(body),
  });
}

interface ErrorBody {
  error: {
    code: string;
    message: string;
    message_key?: string;
    details?: { field: string; issue: string }[];
  };
}

async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

async function expectError(res: Response, status: number, code: string) {
  expect(res.status).toBe(status);
  const body = await json<ErrorBody>(res);
  expect(body.error.code).toBe(code);
  return body.error;
}

describe.skipIf(!enabled)(
  "Ngăn chi tiết task: API mở rộng (Supabase cục bộ)",
  () => {
    const tag = randomUUID().slice(0, 8);
    const password = `It-${randomUUID()}`;
    const created: string[] = [];
    const users: Record<string, string> = {};
    const jars: Record<string, CookieJar> = {};
    let projectA: string;
    let labelX: string;
    let labelY: string;

    const email = (label: string) => `it-e2-5-${label}-${tag}@example.com`;

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

    const create = (who: string, body: Record<string, unknown>) =>
      handleCreateTask(
        send("POST", `/api/v1/projects/${projectA}/tasks`, body),
        projectA,
        deps(jars[who]),
      );
    const patch = (who: string, id: string, body: Record<string, unknown>) =>
      handlePatchTask(
        send("PATCH", `/api/v1/tasks/${id}`, body),
        id,
        deps(jars[who]),
      );
    const get = (who: string, id: string) =>
      handleGetTask(
        new Request(new URL(`/api/v1/tasks/${id}`, APP_ORIGIN)),
        id,
        deps(jars[who]),
      );
    const show = async (who: string, id: string) => {
      const res = await get(who, id);
      expect(res.status).toBe(200);
      return (await json<{ data: TaskDetail }>(res)).data;
    };
    const list = (who: string, query: string) =>
      handleListTasks(
        new Request(
          new URL(`/api/v1/projects/${projectA}/tasks?${query}`, APP_ORIGIN),
        ),
        projectA,
        deps(jars[who]),
      );

    async function createOk(who: string, body: Record<string, unknown>) {
      const res = await create(who, { title: `IT ${tag}`, ...body });
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
      ]) {
        await createUser(label);
      }
      const { error: adminError } = await service
        .from("profiles")
        .update({ is_admin: true })
        .eq("id", users.admin);
      if (adminError) throw adminError;

      projectA = randomUUID();
      const projects = await service
        .from("projects")
        .insert({ id: projectA, name: `IT E2-5 ${tag}`, created_by: users.pm });
      if (projects.error) throw projects.error;
      const members = await service.from("project_members").insert([
        { project_id: projectA, user_id: users.member, role: "member" },
        { project_id: projectA, user_id: users.member2, role: "member" },
        { project_id: projectA, user_id: users.viewer, role: "viewer" },
      ]);
      if (members.error) throw members.error;
      const labels = await service
        .from("labels")
        .insert([
          { project_id: projectA, name: `X ${tag}` },
          { project_id: projectA, name: `Y ${tag}` },
        ])
        .select("id, name");
      if (labels.error) throw labels.error;
      labelX = labels.data.find((l) => l.name.startsWith("X"))!.id as string;
      labelY = labels.data.find((l) => l.name.startsWith("Y"))!.id as string;

      for (const label of Object.keys(users)) await signIn(label);
    });

    afterAll(async () => {
      if (!service) return;
      if (projectA) await service.from("projects").delete().eq("id", projectA);
      for (const id of created) await service.auth.admin.deleteUser(id);
    });

    // =========================================================================
    // GET chi tiết: parent, subtasks, label_ids, permissions (AC1 phía API)
    // =========================================================================
    it("AC1: GET trả task cha, cây việc con theo thứ tự cây, nhãn; trường cũ giữ nguyên", async () => {
      const root = await createOk("pm", {
        title: "Gốc",
        label_ids: [labelY, labelX],
        description: "Dòng 1\nDòng 2",
      });
      const a = await createOk("pm", { title: "A", parent_id: root.id });
      const b = await createOk("pm", { title: "B", parent_id: root.id });
      const a1 = await createOk("pm", { title: "A1", parent_id: a.id });

      const detail = await show("pm", root.id);
      // Trường cũ không đổi tên, không mất.
      expect(detail.id).toBe(root.id);
      expect(detail.title).toBe("Gốc");
      expect(detail.description).toBe("Dòng 1\nDòng 2");
      expect(detail.updated_at).toBe(root.updated_at);
      expect([...detail.label_ids].sort()).toEqual([labelX, labelY].sort());
      // Mở rộng.
      expect(detail.parent).toBeNull();
      expect(detail.subtasks.map((s) => s.title)).toEqual(["A", "A1", "B"]);
      expect(detail.subtasks.map((s) => s.depth)).toEqual([2, 3, 2]);
      expect(detail.subtasks.map((s) => s.parent_id)).toEqual([
        root.id,
        a.id,
        root.id,
      ]);
      expect(detail.subtasks_truncated).toBe(false);
      expect(Object.keys(detail.subtasks[0]).sort()).toEqual(
        [
          "assignee_id",
          "completed_at",
          "created_at",
          "depth",
          "due_date",
          "id",
          "parent_id",
          "position",
          "status_id",
          "title",
        ].sort(),
      );

      const child = await show("pm", a1.id);
      expect(child.parent).toEqual({ id: a.id, title: "A" });
      expect(child.subtasks).toEqual([]);
      // Cấp 3: không thêm việc con được.
      expect(child.permissions.can_add_subtask).toBe(false);
      expect((await show("pm", b.id)).permissions.can_add_subtask).toBe(true);
    });

    it("permissions theo vai trò: PM/Admin sửa hết, Thành viên chỉ task mình phụ trách hoặc tạo, Người xem chỉ đọc", async () => {
      const byPm = await createOk("pm", { title: "Của PM" });
      const assignedToMember = await createOk("pm", {
        title: "Giao Thành viên",
        assignee_id: users.member,
      });
      const byMember = await createOk("member", { title: "Thành viên tạo" });

      const p = async (who: string, id: string) =>
        (await show(who, id)).permissions;

      for (const who of ["pm", "admin"]) {
        expect(await p(who, byPm.id)).toEqual({
          can_edit: true,
          can_delete: true,
          can_reassign: true,
          can_add_subtask: true,
        });
      }
      expect(await p("viewer", byPm.id)).toEqual({
        can_edit: false,
        can_delete: false,
        can_reassign: false,
        can_add_subtask: false,
      });
      // Thành viên không phụ trách, không tạo: chỉ đọc.
      expect((await p("member", byPm.id)).can_edit).toBe(false);
      // Phụ trách (không tạo): sửa được, không giao đi, không xóa.
      expect(await p("member", assignedToMember.id)).toEqual({
        can_edit: true,
        can_delete: false,
        can_reassign: false,
        can_add_subtask: true,
      });
      // Tạo: sửa, xóa, giao được.
      expect(await p("member", byMember.id)).toEqual({
        can_edit: true,
        can_delete: true,
        can_reassign: true,
        can_add_subtask: true,
      });
      expect((await p("member2", byMember.id)).can_edit).toBe(false);

      // permissions chỉ là gợi ý: API thật sự chặn đúng như vậy.
      await expectError(
        await patch("member", byPm.id, { title: "x" }),
        403,
        "forbidden",
      );
      await expectError(
        await patch("viewer", byPm.id, { title: "x" }),
        403,
        "forbidden",
      );
    });

    it("người ngoài dự án: 404 (không lộ sự tồn tại)", async () => {
      const task = await createOk("pm", { title: "Bí mật" });
      await expectError(await get("outsider", task.id), 404, "not_found");
    });

    // =========================================================================
    // ?parent_id=
    // =========================================================================
    it("?parent_id= chỉ trả việc con trực tiếp; id sai định dạng 400", async () => {
      const root = await createOk("pm", { title: "Cha lọc" });
      const c1 = await createOk("pm", { title: "C1", parent_id: root.id });
      const c2 = await createOk("pm", { title: "C2", parent_id: root.id });
      await createOk("pm", { title: "Cháu", parent_id: c1.id });

      const res = await list("viewer", `parent_id=${root.id}`);
      expect(res.status).toBe(200);
      const body = await json<{ data: Task[] }>(res);
      expect(body.data.map((t) => t.id).sort()).toEqual([c1.id, c2.id].sort());

      await expectError(
        await list("pm", "parent_id=khong-phai-uuid"),
        400,
        "validation_failed",
      );
    });

    // =========================================================================
    // expected_updated_at: chống ghi đè khi sửa đồng thời
    // =========================================================================
    it("PATCH với expected_updated_at đúng: 200; đã cũ: 409 và không ghi", async () => {
      const task = await createOk("pm", { title: "Đồng thời" });

      const first = await patch("pm", task.id, {
        title: "Bản A",
        expected_updated_at: task.updated_at,
      });
      expect(first.status).toBe(200);
      const saved = (await json<{ data: Task }>(first)).data;
      expect(saved.title).toBe("Bản A");
      expect(saved.updated_at).not.toBe(task.updated_at);

      // Người khác vẫn cầm updated_at cũ.
      const error = await expectError(
        await patch("admin", task.id, {
          title: "Bản B",
          expected_updated_at: task.updated_at,
        }),
        409,
        "conflict",
      );
      expect(error.message).toBe(strings.taskDetail.errors.stale);
      expect(error.message_key).toBe("taskDetail.errors.stale");
      expect((await show("pm", task.id)).title).toBe("Bản A");

      // Không gửi expected_updated_at: như cũ, người sửa sau thắng.
      const res = await patch("admin", task.id, { title: "Bản C" });
      expect(res.status).toBe(200);
    });

    it("expected_updated_at sai định dạng hoặc gửi một mình: 400", async () => {
      const task = await createOk("pm", { title: "Sai" });
      const bad = await expectError(
        await patch("pm", task.id, {
          title: "x",
          expected_updated_at: "hôm qua",
        }),
        400,
        "validation_failed",
      );
      expect(bad.details).toEqual([
        { field: "expected_updated_at", issue: "invalid_format" },
      ]);
      await expectError(
        await patch("pm", task.id, { expected_updated_at: task.updated_at }),
        400,
        "validation_failed",
      );
    });

    it("422 ngày (BR-13) vẫn ưu tiên đúng thứ tự khi có expected_updated_at", async () => {
      const task = await createOk("pm", {
        title: "Ngày",
        start_date: "2026-12-01",
        due_date: "2026-12-10",
      });
      const error = await expectError(
        await patch("pm", task.id, {
          due_date: "2026-11-01",
          expected_updated_at: task.updated_at,
        }),
        422,
        "business_rule_violated",
      );
      expect(error.message).toBe(strings.tasks.errors.dateOrder);
    });
  },
);
