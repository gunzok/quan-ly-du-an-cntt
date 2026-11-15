/**
 * Test tích hợp Story E2-4 (QLDA-42) với Supabase cục bộ: việc con tối đa 3 cấp và quy tắc đóng
 * task cha (BR-04) qua API task (lib/tasks/handlers.ts) và API cấu hình (đổi nhóm trạng thái).
 * Client phiên tạo từ hũ cookie (giống trình duyệt): đi qua Origin, getUser, RLS, schema, trigger.
 *
 * Chạy: make db-start && make test-integration. Thiếu SUPABASE_URL... thì cả nhóm BỎ QUA có
 * thông báo. Chỉ chấp nhận URL localhost. Tài khoản, dự án tạo tạm, xóa ở afterAll.
 */
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signInWithPassword } from "@/lib/auth/sign-in";
import { handlePatchConfig } from "@/lib/project-config/handlers";
import { strings } from "@/lib/strings";
import {
  handleCreateTask,
  handleGetTask,
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
const e = strings.subtasks.errors;

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
    details?: { field: string; issue: string }[];
    task_ids?: string[];
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
  return body.error;
}

describe.skipIf(!enabled)("Việc con và đóng task cha (Supabase cục bộ)", () => {
  const tag = randomUUID().slice(0, 8);
  const password = `It-${randomUUID()}`;
  const created: string[] = [];
  const users: Record<string, string> = {};
  const jars: Record<string, CookieJar> = {};
  const status: Record<string, string> = {};
  let projectA: string;
  let projectB: string;
  let taskB: string;

  const email = (label: string) => `it-e2-4-${label}-${tag}@example.com`;

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

  const create = (
    who: string,
    body: Record<string, unknown>,
    project = projectA,
  ) =>
    handleCreateTask(
      send("POST", `/api/v1/projects/${project}/tasks`, body),
      project,
      deps(jars[who]),
    );
  const patch = (who: string, id: string, body: Record<string, unknown>) =>
    handlePatchTask(
      send("PATCH", `/api/v1/tasks/${id}`, body),
      id,
      deps(jars[who]),
    );
  const show = async (who: string, id: string) => {
    const res = await handleGetTask(
      new Request(new URL(`/api/v1/tasks/${id}`, APP_ORIGIN)),
      id,
      deps(jars[who]),
    );
    expect(res.status).toBe(200);
    return (await json<{ data: Task }>(res)).data;
  };

  async function createOk(who: string, body: Record<string, unknown>) {
    const res = await create(who, { title: `IT ${tag}`, ...body });
    expect(res.status).toBe(201);
    return (await json<{ data: Task }>(res)).data;
  }

  async function patchOk(
    who: string,
    id: string,
    body: Record<string, unknown>,
  ) {
    const res = await patch(who, id, body);
    expect(res.status).toBe(200);
    return (await json<{ data: Task }>(res)).data;
  }

  /** Cây 3 cấp mới: gốc → con → cháu (PM tạo qua API). */
  async function tree() {
    const root = await createOk("pm", {});
    const child = await createOk("pm", { parent_id: root.id });
    const grand = await createOk("pm", { parent_id: child.id });
    return { root, child, grand };
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
    projectB = randomUUID();
    const projects = await service.from("projects").insert([
      { id: projectA, name: `IT E2-4 A ${tag}`, created_by: users.pm },
      { id: projectB, name: `IT E2-4 B ${tag}`, created_by: users.pmb },
    ]);
    if (projects.error) throw projects.error;
    const members = await service.from("project_members").insert([
      { project_id: projectA, user_id: users.member, role: "member" },
      { project_id: projectA, user_id: users.viewer, role: "viewer" },
    ]);
    if (members.error) throw members.error;

    const statuses = await service
      .from("task_statuses")
      .select("id, name")
      .eq("project_id", projectA);
    if (statuses.error) throw statuses.error;
    for (const s of statuses.data) status[s.name] = s.id;

    taskB = randomUUID();
    const b = await service.from("tasks").insert({
      id: taskB,
      project_id: projectB,
      title: `IT B ${tag}`,
      created_by: users.pmb,
    });
    if (b.error) throw b.error;

    for (const label of Object.keys(users)) await signIn(label);
  });

  afterAll(async () => {
    if (!service) return;
    for (const id of [projectA, projectB]) {
      if (id) await service.from("projects").delete().eq("id", id);
    }
    for (const id of created) await service.auth.admin.deleteUser(id);
  });

  // =========================================================================
  // AC1: tối đa 3 cấp
  // =========================================================================
  it("AC1: tạo con dưới task cấp 2 được (depth 3), dưới task cấp 3 bị từ chối 422", async () => {
    const { root, child, grand } = await tree();
    expect([root.depth, child.depth, grand.depth]).toEqual([1, 2, 3]);
    expect(grand.parent_id).toBe(child.id);

    const error = await expectError(
      await create("pm", { title: "Quá cấp", parent_id: grand.id }),
      422,
      "business_rule_violated",
    );
    expect(error.message).toBe(e.depthExceeded);
    expect(error.details).toEqual([
      { field: "parent_id", issue: "invalid_value" },
    ]);
  });

  it("chuyển cây: kiểm cả chiều dưới (cây cao 2 vào dưới cấp 2 bị từ chối), depth hậu duệ đi theo", async () => {
    const { root, child } = await tree();
    const x = await createOk("pm", {});
    const y = await createOk("pm", { parent_id: x.id });

    // Cha cấp 2: x thành cấp 3, y thành cấp 4 → trigger từ chối (handler không thấy được cây con).
    const error = await expectError(
      await patch("pm", x.id, { parent_id: child.id }),
      422,
      "business_rule_violated",
    );
    expect(error.message).toBe(e.depthExceeded);
    expect((await show("pm", x.id)).parent_id).toBeNull();

    const moved = await patchOk("pm", x.id, { parent_id: root.id });
    expect(moved.depth).toBe(2);
    expect((await show("pm", y.id)).depth).toBe(3);

    const detached = await patchOk("pm", x.id, { parent_id: null });
    expect(detached.depth).toBe(1);
    expect((await show("pm", y.id)).depth).toBe(2);
  });

  it("tự làm cha, tạo vòng: 409", async () => {
    const { root, grand } = await tree();
    for (const parent of [root.id, grand.id]) {
      const error = await expectError(
        await patch("pm", root.id, { parent_id: parent }),
        409,
        "conflict",
      );
      expect(error.message).toBe(e.cycle);
    }
  });

  // =========================================================================
  // Chống dò, quyền
  // =========================================================================
  it("cha ở dự án khác và cha không tồn tại: cùng một lỗi 422 (không lộ task dự án khác)", async () => {
    const own = await createOk("pm", {});
    const bodies = [];
    for (const parent of [taskB, randomUUID()]) {
      const a = await expectError(
        await create("pm", { title: "x", parent_id: parent }),
        422,
        "business_rule_violated",
      );
      const b = await expectError(
        await patch("pm", own.id, { parent_id: parent }),
        422,
        "business_rule_violated",
      );
      bodies.push(
        { message: a.message, details: a.details },
        { message: b.message, details: b.details },
      );
    }
    for (const body of bodies) {
      expect(body).toEqual({
        message: e.parentNotFound,
        details: [{ field: "parent_id", issue: "invalid_value" }],
      });
    }
    // PM dự án B (không thuộc A) dùng task của A làm cha cho task B: cùng lỗi, kể cả khi task A là cấp 3.
    const { grand } = await tree();
    const cross = await expectError(
      await create("pmb", { title: "x", parent_id: grand.id }, projectB),
      422,
      "business_rule_violated",
    );
    expect(cross.message).toBe(e.parentNotFound);
    // Người ngoài: không thấy dự án → 404 trước mọi kiểm về cha.
    await expectError(
      await create("outsider", { title: "x", parent_id: grand.id }),
      404,
      "not_found",
    );
  });

  it("Thành viên gắn việc con vào task mình sửa được; task người khác: 403; Người xem: 403", async () => {
    const assigned = await createOk("pm", { assignee_id: users.member });
    const others = await createOk("pm", {});
    const sub = await createOk("member", { parent_id: assigned.id });
    expect(sub.depth).toBe(2);

    const error = await expectError(
      await create("member", { title: "x", parent_id: others.id }),
      403,
      "forbidden",
    );
    expect(error.message).toBe(e.parentNotEditable);
    const moveError = await expectError(
      await patch("member", sub.id, { parent_id: others.id }),
      403,
      "forbidden",
    );
    expect(moveError.message).toBe(e.parentNotEditable);
    // Tách việc con của mình khỏi cha: được (không đòi quyền với cha cũ).
    expect((await patchOk("member", sub.id, { parent_id: null })).depth).toBe(
      1,
    );

    await expectError(
      await create("viewer", { title: "x", parent_id: assigned.id }),
      403,
      "forbidden",
    );
  });

  it("schema: parent_id sai định dạng 400; depth không ghi được", async () => {
    const own = await createOk("pm", {});
    const bad = await expectError(
      await create("pm", { title: "x", parent_id: "abc" }),
      400,
      "validation_failed",
    );
    expect(bad.details).toEqual([
      { field: "parent_id", issue: "invalid_format" },
    ]);
    const depth = await expectError(
      await patch("pm", own.id, { depth: 3 }),
      400,
      "validation_failed",
    );
    expect(depth.details).toEqual([{ field: "depth", issue: "unknown_field" }]);
  });

  // =========================================================================
  // AC2: BR-04
  // =========================================================================
  it("AC2: cha còn hậu duệ chưa xong → 422 kèm task_ids; mọi hậu duệ xong (kể cả Từ chối/Đã đóng) → được", async () => {
    const { root, child, grand } = await tree();

    const all = await expectError(
      await patch("pm", root.id, { status_id: status["Đã xong"] }),
      422,
      "business_rule_violated",
    );
    expect(all.message).toBe(e.openSubtasks);
    expect(all.task_ids).toEqual([child.id, grand.id]);
    expect(all.details).toEqual([
      { field: "status_id", issue: "invalid_value" },
    ]);

    const mid = await expectError(
      await patch("pm", child.id, { status_id: status["Đã xong"] }),
      422,
      "business_rule_violated",
    );
    expect(mid.task_ids).toEqual([grand.id]);

    await patchOk("pm", grand.id, { status_id: status["Từ chối"] });
    await patchOk("pm", child.id, { status_id: status["Đã đóng"] });
    const closed = await patchOk("pm", root.id, {
      status_id: status["Đã xong"],
    });
    expect(closed.completed_at).not.toBeNull();
  });

  it("AC2: cháu chưa xong chặn đóng ông (con trực tiếp đã xong)", async () => {
    const { root, child, grand } = await tree();
    await patchOk("pm", child.id, { status_id: status["Đang thực hiện"] });
    // Con không đóng được vì cháu; cho cháu xong rồi đóng con, mở lại cháu.
    await patchOk("pm", grand.id, { status_id: status["Đã xong"] });
    await patchOk("pm", child.id, { status_id: status["Đã xong"] });
    await patchOk("pm", grand.id, { status_id: status["Mới"] });

    const error = await expectError(
      await patch("pm", root.id, { status_id: status["Đã xong"] }),
      422,
      "business_rule_violated",
    );
    expect(error.task_ids).toEqual([grand.id]);
  });

  it("mở lại việc con khi cha đã done: KHÔNG bị chặn, cha vẫn done (hành vi đã chốt)", async () => {
    const parent = await createOk("pm", {});
    const sub = await createOk("pm", {
      parent_id: parent.id,
      status_id: status["Đã xong"],
    });
    await patchOk("pm", parent.id, { status_id: status["Đã xong"] });

    const reopened = await patchOk("pm", sub.id, {
      status_id: status["Đang thực hiện"],
    });
    expect(reopened.completed_at).toBeNull();
    const after = await show("pm", parent.id);
    expect(after.status_id).toBe(status["Đã xong"]);
    expect(after.completed_at).not.toBeNull();
    // Thêm việc con chưa xong dưới cha đã done cũng không bị chặn (nhất quán với mở lại).
    expect((await createOk("pm", { parent_id: parent.id })).depth).toBe(2);
    // Nhưng chuyển cha sang trạng thái done khác lúc này thì bị chặn.
    await expectError(
      await patch("pm", parent.id, { status_id: status["Đã đóng"] }),
      422,
      "business_rule_violated",
    );
  });

  it("PM đổi nhóm trạng thái sang done khi một task cha ở đó còn con chưa xong: 422 kèm task_ids", async () => {
    const custom = randomUUID();
    const ins = await service.from("task_statuses").insert({
      id: custom,
      project_id: projectA,
      name: `Chờ duyệt ${tag}`,
      category: "todo",
      position: 50,
    });
    if (ins.error) throw ins.error;
    const parent = await createOk("pm", { status_id: custom });
    const sub = await createOk("pm", { parent_id: parent.id });

    const changeCategory = () =>
      handlePatchConfig(
        send("PATCH", `/api/v1/statuses/${custom}`, { category: "done" }),
        "statuses",
        custom,
        deps(jars.pm),
      );
    const error = await expectError(
      await changeCategory(),
      422,
      "business_rule_violated",
    );
    expect(error.message).toBe(e.statusChangeBlocked);
    expect(error.task_ids).toEqual([sub.id]);
    expect((await show("pm", parent.id)).completed_at).toBeNull();

    // Con cùng ở trạng thái đó: đổi nhóm làm cả hai cùng done → được.
    await patchOk("pm", sub.id, { status_id: custom });
    const res = await changeCategory();
    expect(res.status).toBe(200);
    expect((await show("pm", parent.id)).completed_at).not.toBeNull();
  });

  // =========================================================================
  // Đồng thời
  // =========================================================================
  it("đồng thời A→dưới B và B→dưới A: đúng một thành công, một 409", async () => {
    for (let i = 0; i < 6; i++) {
      const a = await createOk("pm", {});
      const b = await createOk("pm", {});
      const [ra, rb] = await Promise.all([
        patch("pm", a.id, { parent_id: b.id }),
        patch("admin", b.id, { parent_id: a.id }),
      ]);
      expect([ra.status, rb.status].sort()).toEqual([200, 409]);
    }
  });

  it("đồng thời chuyển P xuống cấp 3 và tạo con dưới P: không bao giờ thành 4 cấp", async () => {
    for (let i = 0; i < 6; i++) {
      const p = await createOk("pm", {});
      const q1 = await createOk("pm", {});
      const q2 = await createOk("pm", { parent_id: q1.id });
      const [move, add] = await Promise.all([
        patch("pm", p.id, { parent_id: q2.id }),
        create("admin", { title: `con ${i}`, parent_id: p.id }),
      ]);
      // Một trong hai thành công, cái còn lại 422 (vượt 3 cấp).
      expect([move.status, add.status].sort()).toEqual(
        move.status === 200 ? [200, 422] : [201, 422],
      );
      const rows = await service
        .from("tasks")
        .select("id, depth, parent_id")
        .eq("project_id", projectA);
      if (rows.error) throw rows.error;
      const byId = new Map(rows.data.map((r) => [r.id, r]));
      for (const r of rows.data) {
        expect(r.depth).toBeLessThanOrEqual(3);
        if (r.parent_id) expect(r.depth).toBe(byId.get(r.parent_id)!.depth + 1);
        else expect(r.depth).toBe(1);
      }
    }
  });

  // Hai test trên đi qua handler (nhiều lượt gọi trước câu lệnh ghi) nên hai giao dịch hiếm khi
  // thật sự chồng nhau. Hai test dưới ghi thẳng bằng client phiên (PostgREST, đường trình duyệt
  // cũng đi được vì có quyền cột parent_id) để hai câu lệnh chạy cùng lúc. Đã kiểm: tắt khóa cấu
  // trúc cây thì phần lớn lượt "cả hai cùng thành công" (tạo vòng), test đỏ.
  it("đồng thời ghi thẳng A→dưới B và B→dưới A (20 lượt): không bao giờ cả hai cùng thành công", async () => {
    const pm = sessionClient(jars.pm);
    const admin = sessionClient(jars.admin);
    for (let i = 0; i < 20; i++) {
      const a = await createOk("pm", {});
      const b = await createOk("pm", {});
      const [ra, rb] = await Promise.all([
        pm.from("tasks").update({ parent_id: b.id }).eq("id", a.id),
        admin.from("tasks").update({ parent_id: a.id }).eq("id", b.id),
      ]);
      const errors = [ra.error, rb.error].filter((x) => x !== null);
      expect(errors).toHaveLength(1);
      expect(errors[0]?.message).toBe("task_parent_cycle");
    }
  });

  it("đồng thời ghi thẳng: chuyển P xuống cấp 3 và tạo con dưới P (20 lượt): không bao giờ 4 cấp", async () => {
    const pm = sessionClient(jars.pm);
    const admin = sessionClient(jars.admin);
    for (let i = 0; i < 20; i++) {
      const p = await createOk("pm", {});
      const q1 = await createOk("pm", {});
      const q2 = await createOk("pm", { parent_id: q1.id });
      const [move, add] = await Promise.all([
        pm.from("tasks").update({ parent_id: q2.id }).eq("id", p.id),
        admin
          .from("tasks")
          .insert({ project_id: projectA, title: `con ${i}`, parent_id: p.id }),
      ]);
      const errors = [move.error, add.error].filter((x) => x !== null);
      expect(errors).toHaveLength(1);
      expect(errors[0]?.message).toBe("subtask_depth_exceeded");
    }
  });

  it("đồng thời đóng cha và mở lại con: kết quả luôn ứng với một thứ tự tuần tự hợp lệ", async () => {
    for (let i = 0; i < 6; i++) {
      const parent = await createOk("pm", {});
      const sub = await createOk("pm", {
        parent_id: parent.id,
        status_id: status["Đã xong"],
      });
      const [close, reopen] = await Promise.all([
        patch("pm", parent.id, { status_id: status["Đã xong"] }),
        patch("admin", sub.id, { status_id: status["Mới"] }),
      ]);
      // Mở lại con không bao giờ bị chặn. Đóng cha: thành công nếu chạy trước (con còn done lúc
      // kiểm), 422 nếu chạy sau; không có kết quả khác (không 500, không khóa chết).
      expect(reopen.status).toBe(200);
      expect([200, 422]).toContain(close.status);
      if (close.status === 422) {
        expect((await json<ErrorBody>(close)).error.task_ids).toEqual([sub.id]);
        expect((await show("pm", parent.id)).completed_at).toBeNull();
      }
    }
  });
});
