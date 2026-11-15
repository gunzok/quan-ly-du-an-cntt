/**
 * Test tích hợp Story E2-3 (QLDA-41) với Supabase cục bộ: API trạng thái, loại task, nhãn và phần
 * task nhận status_id, type_id, label_ids. Gọi thẳng lõi Route Handler với client phiên tạo từ hũ
 * cookie (giống trình duyệt): đi qua Origin, getUser, vai trò qua RLS, schema, RLS và trigger.
 *
 * Chạy: make db-start && make test-integration. Tài khoản và dự án tạo tạm, xóa ở afterAll.
 */
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signInWithPassword } from "@/lib/auth/sign-in";
import {
  handleCreateConfig,
  handleDeleteConfig,
  handleListConfig,
  handleListTaskTypesByQuery,
  handlePatchConfig,
  type ConfigDeps,
} from "@/lib/project-config/handlers";
import type {
  ConfigKind,
  Label,
  TaskStatus,
  TaskType,
} from "@/lib/project-config/model";
import { strings } from "@/lib/strings";
import {
  handleCreateTask,
  handleListTasks,
  handlePatchTask,
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

function deps(jar: CookieJar): ConfigDeps {
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
  expect(body.error.request_id.length).toBeGreaterThan(0);
  return body.error;
}

describe.skipIf(!enabled)("API cấu hình dự án (Supabase cục bộ)", () => {
  const tag = randomUUID().slice(0, 8);
  const password = `It-${randomUUID()}`;
  const created: string[] = [];
  const users: Record<string, string> = {};
  const jars: Record<string, CookieJar> = {};
  let projectA: string;
  let projectB: string;

  async function createUser(label: string) {
    const { data, error } = await service.auth.admin.createUser({
      email: `it-e2-3-${label}-${tag}@example.com`,
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
      email: `it-e2-3-${label}-${tag}@example.com`,
      password,
    });
    expect(result.ok).toBe(true);
    jars[label] = jar;
  }

  const list = (who: string, kind: ConfigKind, projectId: string, qs = "") =>
    handleListConfig(
      get(`/api/v1/projects/${projectId}/${kind}${qs}`),
      kind,
      projectId,
      deps(jars[who]),
    );
  const create = (
    who: string,
    kind: ConfigKind,
    projectId: string,
    body: unknown,
    origin?: string | null,
  ) =>
    handleCreateConfig(
      send("POST", `/api/v1/projects/${projectId}/${kind}`, body, origin),
      kind,
      projectId,
      deps(jars[who]),
    );
  const patch = (who: string, kind: ConfigKind, id: string, body: unknown) =>
    handlePatchConfig(
      send("PATCH", `/api/v1/${kind}/${id}`, body),
      kind,
      id,
      deps(jars[who]),
    );
  const remove = (who: string, kind: ConfigKind, id: string, qs = "") =>
    handleDeleteConfig(
      send("DELETE", `/api/v1/${kind}/${id}${qs}`),
      kind,
      id,
      deps(jars[who]),
    );

  async function statuses(projectId: string, who = "pm") {
    const res = await list(who, "statuses", projectId);
    expect(res.status).toBe(200);
    return (await json<{ data: TaskStatus[] }>(res)).data;
  }
  async function types(projectId: string, who = "pm") {
    const res = await list(who, "task-types", projectId);
    expect(res.status).toBe(200);
    return (await json<{ data: TaskType[] }>(res)).data;
  }
  const byName = <T extends { name: string }>(items: T[], name: string) => {
    const item = items.find((i) => i.name === name);
    if (!item) throw new Error(`không có ${name}`);
    return item;
  };

  async function createTask(who: string, body: Record<string, unknown>) {
    return handleCreateTask(
      send("POST", `/api/v1/projects/${projectA}/tasks`, body),
      projectA,
      { session: sessionClient(jars[who]) },
    );
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
      { id: projectA, name: `IT E2-3 A ${tag}`, created_by: users.pm },
      { id: projectB, name: `IT E2-3 B ${tag}`, created_by: users.outsider },
    ]);
    if (projects.error) throw projects.error;
    const members = await service.from("project_members").insert([
      { project_id: projectA, user_id: users.member, role: "member" },
      { project_id: projectA, user_id: users.viewer, role: "viewer" },
      { project_id: projectA, user_id: users.locked, role: "member" },
    ]);
    if (members.error) throw members.error;

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
      await list("anon", "statuses", projectA),
      await create("anon", "labels", projectA, { name: "x" }),
      await patch("anon", "statuses", id, { name: "x" }),
      await remove("anon", "task-types", id),
      await handleListTaskTypesByQuery(
        get(`/api/v1/task-types?project_id=${projectA}`),
        deps(jars.anon),
      ),
    ]) {
      const error = await expectError(res, 401, "unauthenticated");
      expect(error.message).toBe(strings.api.unauthenticated);
    }
  });

  it("AC1: dự án mới có trạng thái và loại task mặc định", async () => {
    const st = await statuses(projectA);
    expect(st.map((s) => [s.name, s.category])).toEqual([
      ["Mới", "todo"],
      ["Đang thực hiện", "in_progress"],
      ["Đang kiểm thử", "in_progress"],
      ["Cần phản hồi", "in_progress"],
      ["Đã xong", "done"],
      ["Đã đóng", "done"],
      ["Từ chối", "done"],
    ]);
    expect(st.every((s) => s.task_count === 0)).toBe(true);
    const res = await handleListTaskTypesByQuery(
      get(`/api/v1/task-types?project_id=${projectA}`),
      deps(jars.member),
    );
    expect(res.status).toBe(200);
    const { data } = await json<{ data: TaskType[] }>(res);
    expect(data.map((t) => [t.name, t.is_milestone])).toEqual([
      ["Task", false],
      ["Bug", false],
      ["Milestone", true],
      ["Phase", false],
    ]);
  });

  it("đọc: mọi vai trò và Admin 200; người ngoài, người bị khóa, id sai 404", async () => {
    for (const who of ["pm", "member", "viewer", "admin"]) {
      expect((await list(who, "labels", projectA)).status).toBe(200);
    }
    for (const who of ["outsider", "locked"]) {
      await expectError(
        await list(who, "statuses", projectA),
        404,
        "not_found",
      );
    }
    await expectError(await list("pm", "statuses", "abc"), 404, "not_found");
    await expectError(
      await handleListTaskTypesByQuery(
        get(`/api/v1/task-types?project_id=${projectB}`),
        deps(jars.pm),
      ),
      404,
      "not_found",
    );
    await expectError(
      await handleListTaskTypesByQuery(
        get(`/api/v1/task-types`),
        deps(jars.pm),
      ),
      400,
      "validation_failed",
    );
    await expectError(
      await list("pm", "statuses", projectA, "?q=x"),
      400,
      "validation_failed",
    );
  });

  it("tạo: PM 201 + Location, xếp cuối; Thành viên, Người xem 403; người ngoài 404", async () => {
    const res = await create("pm", "statuses", projectA, {
      name: "  Chờ   duyệt ",
      category: "in_progress",
      color: "#e56daf",
    });
    expect(res.status).toBe(201);
    const { data } = await json<{ data: TaskStatus }>(res);
    expect(res.headers.get("location")).toBe(`/api/v1/statuses/${data.id}`);
    expect(data).toMatchObject({
      name: "Chờ duyệt",
      category: "in_progress",
      color: "#E56DAF",
      project_id: projectA,
      position: 8,
      task_count: 0,
    });

    for (const who of ["member", "viewer"]) {
      const e = await expectError(
        await create(who, "labels", projectA, { name: "x" }),
        403,
        "forbidden",
      );
      expect(e.message).toBe(strings.projectConfig.errors.forbidden);
    }
    await expectError(
      await create("outsider", "labels", projectA, { name: "x" }),
      404,
      "not_found",
    );
    await expectError(
      await create(
        "pm",
        "labels",
        projectA,
        { name: "x" },
        "https://evil.example",
      ),
      403,
      "forbidden",
    );
    const admin = await create("admin", "task-types", projectA, {
      name: "Epic",
      color: "#7C3AED",
    });
    expect(admin.status).toBe(201);
  });

  it("tạo: 400 trường lạ, thiếu nhóm; 409 trùng tên không phân biệt hoa thường", async () => {
    const e = await expectError(
      await create("pm", "statuses", projectA, {
        name: "x",
        category: "todo",
        project_id: projectB,
      }),
      400,
      "validation_failed",
    );
    expect(e.details).toEqual([
      { field: "project_id", issue: "unknown_field" },
    ]);
    await expectError(
      await create("pm", "statuses", projectA, { name: "x" }),
      400,
      "validation_failed",
    );
    const dup = await expectError(
      await create("pm", "statuses", projectA, {
        name: "MỚI",
        category: "todo",
      }),
      409,
      "conflict",
    );
    expect(dup.message).toBe(strings.projectConfig.errors.nameExists.statuses);
  });

  it("sửa: PM đổi tên, màu, thứ tự; Thành viên 403; người ngoài 404; nhóm todo cuối 422", async () => {
    const st = await statuses(projectA);
    const moi = byName(st, "Mới");
    const res = await patch("pm", "statuses", moi.id, {
      name: "Cần làm",
      color: "#4b5563",
      position: 0.5,
    });
    expect(res.status).toBe(200);
    expect((await json<{ data: TaskStatus }>(res)).data).toMatchObject({
      name: "Cần làm",
      color: "#4B5563",
      position: 0.5,
    });
    await expectError(
      await patch("member", "statuses", moi.id, { name: "x" }),
      403,
      "forbidden",
    );
    await expectError(
      await patch("outsider", "statuses", moi.id, { name: "x" }),
      404,
      "not_found",
    );
    await expectError(
      await patch("pm", "statuses", moi.id, { project_id: projectB }),
      400,
      "validation_failed",
    );
    const last = await expectError(
      await patch("pm", "statuses", moi.id, { category: "in_progress" }),
      422,
      "business_rule_violated",
    );
    expect(last.message).toBe(strings.projectConfig.errors.lastOfCategory);
  });

  it("task: mặc định, trạng thái/loại/nhãn của dự án, completed_at theo nhóm done, lọc", async () => {
    const st = await statuses(projectA);
    const ty = await types(projectA);
    const labelRes = await create("pm", "labels", projectA, {
      name: "Bảo mật",
      color: "#C0262D",
    });
    expect(labelRes.status).toBe(201);
    const label = (await json<{ data: Label }>(labelRes)).data;
    const otherLabel = await service
      .from("labels")
      .insert({ project_id: projectB, name: "Khác" })
      .select("id")
      .single();
    if (otherLabel.error) throw otherLabel.error;
    const otherStatus = await service
      .from("task_statuses")
      .select("id")
      .eq("project_id", projectB)
      .limit(1)
      .single();
    if (otherStatus.error) throw otherStatus.error;

    const plain = await createTask("member", { title: "Mặc định" });
    expect(plain.status).toBe(201);
    const plainTask = (await json<{ data: Task }>(plain)).data;
    expect(plainTask.status_id).toBe(byName(st, "Cần làm").id);
    expect(plainTask.type_id).toBe(byName(ty, "Task").id);

    const full = await createTask("member", {
      title: "Bug có nhãn",
      status_id: byName(st, "Đang thực hiện").id,
      type_id: byName(ty, "Bug").id,
      label_ids: [label.id],
    });
    expect(full.status).toBe(201);
    const task = (await json<{ data: Task }>(full)).data;
    expect(task).toMatchObject({
      status_id: byName(st, "Đang thực hiện").id,
      type_id: byName(ty, "Bug").id,
      label_ids: [label.id],
      completed_at: null,
    });

    await expectError(
      await createTask("member", {
        title: "x",
        label_ids: [otherLabel.data.id],
      }),
      422,
      "business_rule_violated",
    );
    const cross = await expectError(
      await createTask("member", {
        title: "x",
        status_id: otherStatus.data.id,
      }),
      422,
      "business_rule_violated",
    );
    expect(cross.details).toEqual([
      { field: "status_id", issue: "invalid_value" },
    ]);

    const patchTask = (who: string, id: string, body: unknown) =>
      handlePatchTask(send("PATCH", `/api/v1/tasks/${id}`, body), id, {
        session: sessionClient(jars[who]),
      });
    const done = await patchTask("member", task.id, {
      status_id: byName(st, "Đã xong").id,
      label_ids: [],
    });
    expect(done.status).toBe(200);
    const doneTask = (await json<{ data: Task }>(done)).data;
    expect(doneTask.completed_at).not.toBeNull();
    expect(doneTask.label_ids).toEqual([]);
    await expectError(
      await patchTask("viewer", task.id, {
        status_id: byName(st, "Đã đóng").id,
      }),
      403,
      "forbidden",
    );

    const tagged = await patchTask("pm", plainTask.id, {
      label_ids: [label.id],
    });
    expect(tagged.status).toBe(200);
    const listTasks = async (qs: string) =>
      (
        await json<TaskListResponse>(
          await handleListTasks(
            get(`/api/v1/projects/${projectA}/tasks${qs}`),
            projectA,
            { session: sessionClient(jars.viewer) },
          ),
        )
      ).data;
    const withLabel = await listTasks(`?label_id=${label.id}`);
    expect(withLabel.map((t) => t.id)).toEqual([plainTask.id]);
    expect(withLabel[0].label_ids).toEqual([label.id]);
    const doneList = await listTasks(`?status_id=${byName(st, "Đã xong").id}`);
    expect(doneList.map((t) => t.id)).toEqual([task.id]);

    // Đổi nhóm của trạng thái: completed_at của task trong đó theo nhóm mới.
    expect(
      (
        await patch("pm", "statuses", byName(st, "Đã xong").id, {
          category: "in_progress",
        })
      ).status,
    ).toBe(200);
    const after = await service
      .from("tasks")
      .select("completed_at")
      .eq("id", task.id)
      .single();
    expect(after.data?.completed_at).toBeNull();
    await patch("pm", "statuses", byName(st, "Đã xong").id, {
      category: "done",
    });
  });

  it("AC2: xóa trạng thái đang có task cần replace_with; có thì chuyển task rồi xóa", async () => {
    const st = await statuses(projectA);
    const doing = byName(st, "Đang thực hiện");
    const target = byName(st, "Đang kiểm thử");
    const { error } = await service
      .from("tasks")
      .update({ status_id: doing.id })
      .eq("project_id", projectA);
    if (error) throw error;
    const count = (await statuses(projectA)).find(
      (s) => s.id === doing.id,
    )?.task_count;
    expect(count).toBeGreaterThan(0);

    const inUse = await expectError(
      await remove("pm", "statuses", doing.id),
      409,
      "conflict",
    );
    expect(inUse.details).toEqual([
      { field: "replace_with", issue: "required" },
    ]);
    const other = await service
      .from("task_statuses")
      .select("id")
      .eq("project_id", projectB)
      .limit(1)
      .single();
    await expectError(
      await remove(
        "pm",
        "statuses",
        doing.id,
        `?replace_with=${other.data?.id}`,
      ),
      422,
      "business_rule_violated",
    );
    await expectError(
      await remove("pm", "statuses", doing.id, "?replace_with=abc"),
      400,
      "validation_failed",
    );
    await expectError(
      await remove(
        "member",
        "statuses",
        doing.id,
        `?replace_with=${target.id}`,
      ),
      403,
      "forbidden",
    );

    const res = await remove(
      "pm",
      "statuses",
      doing.id,
      `?replace_with=${target.id}`,
    );
    expect(res.status).toBe(204);
    const moved = await service
      .from("tasks")
      .select("status_id")
      .eq("project_id", projectA);
    expect(moved.data?.every((t) => t.status_id === target.id)).toBe(true);
    const left = await statuses(projectA);
    expect(left.find((s) => s.id === doing.id)).toBeUndefined();
    expect(left.find((s) => s.id === target.id)?.task_count).toBe(count);

    await expectError(
      await remove("pm", "statuses", randomUUID()),
      404,
      "not_found",
    );
  });

  it("xóa loại task đang dùng: 409, có replace_with thì 204; thay bằng chính nó 422", async () => {
    const ty = await types(projectA);
    const task = byName(ty, "Task");
    const phase = byName(ty, "Phase");
    await expectError(
      await remove("pm", "task-types", task.id),
      409,
      "conflict",
    );
    expect(
      (await remove("pm", "task-types", task.id, `?replace_with=${phase.id}`))
        .status,
    ).toBe(204);
    for (const t of await types(projectA)) {
      if (t.id !== phase.id) {
        const r = await remove(
          "admin",
          "task-types",
          t.id,
          `?replace_with=${phase.id}`,
        );
        expect(r.status).toBe(204);
      }
    }
    const last = await expectError(
      await remove("pm", "task-types", phase.id, `?replace_with=${phase.id}`),
      422,
      "business_rule_violated",
    );
    expect(last.message).toBe(strings.projectConfig.errors.invalidReplacement);
  });

  it("nhãn: đổi tên, xóa 204 (gỡ khỏi task); replace_with không hợp lệ cho nhãn", async () => {
    const labels = (
      await json<{ data: Label[] }>(await list("pm", "labels", projectA))
    ).data;
    const label = byName(labels, "Bảo mật");
    expect(label.task_count).toBe(1);
    const renamed = await patch("pm", "labels", label.id, { name: "An ninh" });
    expect(renamed.status).toBe(200);
    await expectError(
      await patch("pm", "labels", label.id, { position: 1 }),
      400,
      "validation_failed",
    );
    await expectError(
      await remove("pm", "labels", label.id, `?replace_with=${label.id}`),
      400,
      "validation_failed",
    );
    await expectError(
      await remove("viewer", "labels", label.id),
      403,
      "forbidden",
    );
    expect((await remove("pm", "labels", label.id)).status).toBe(204);
    const gone = await service
      .from("task_labels")
      .select("task_id")
      .eq("label_id", label.id);
    expect(gone.data).toEqual([]);
  });
});
