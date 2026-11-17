/**
 * Test tích hợp Story E6-2 (QLDA-72) với Supabase cục bộ: GET /api/v1/projects/{id}/activity và
 * GET /api/v1/tasks/{id}/activity. Gọi thẳng lõi Route Handler với client phiên tạo từ hũ cookie
 * (giống trình duyệt): đi qua getUser, RLS của activity_logs (E6-1) và các bảng tra tên.
 *
 * Nhật ký do trigger ghi với actor_id = auth.uid(), nên các thay đổi cần "người làm" được thực
 * hiện bằng PHIÊN của PM/Thành viên (không phải service_role, vốn ghi actor null = hệ thống).
 *
 * AC1: PM mở nhật ký thấy mới nhất trước; phân trang con trỏ không trùng, không sót.
 * AC2: lọc người thực hiện, khoảng ngày (giờ Việt Nam, tính cả hai đầu) khớp; ranh giới múi giờ.
 * Quyền: 401, 404 (người ngoài, bị khóa, id sai, task đã xóa), 403 (Thành viên, Người xem), 400.
 * Dữ liệu: tên trạng thái/người, task đã xóa lấy tên từ nhật ký, mô tả không lộ, email theo quyền.
 *
 * Chạy: make db-start && make test-integration. Tài khoản và dự án tạo tạm, xóa ở afterAll (nhật
 * ký là chỉ thêm nên các dòng của dự án tạm vẫn còn, chỉ Admin đọc được, như thiết kế E6-1).
 */
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  handleGetProjectActivity,
  handleGetTaskActivity,
} from "@/lib/activity/handlers";
import type {
  ActivityEntry,
  ActivityListResponse,
  ActivityPerson,
  ActivityRef,
} from "@/lib/activity/model";
import { addDays, vnDateOf } from "@/lib/activity/time";
import { signInWithPassword } from "@/lib/auth/sign-in";
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
    request_id: string;
    details?: { field: string; issue: string }[];
  };
}

const SECRET_DESCRIPTION = "Nội dung mô tả nội bộ không được lộ ra nhật ký";

describe.skipIf(!enabled)("API xem và lọc nhật ký (Supabase cục bộ)", () => {
  const tag = randomUUID().slice(0, 8);
  const password = `It-${randomUUID()}`;
  const created: string[] = [];
  const users: Record<string, string> = {};
  const jars: Record<string, CookieJar> = {};
  const task: Record<string, string> = {};
  let projectA: string;
  let projectB: string;
  let statusTodo: string;
  let statusDoing: string;
  let typeId: string;

  const email = (label: string) => `it-e6-2-${label}-${tag}@example.com`;
  const fullName = (label: string) => `IT ${label} ${tag}`;

  async function createUser(label: string) {
    const { data, error } = await service.auth.admin.createUser({
      email: email(label),
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName(label) },
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

  /** Client phiên của một người: thay đổi do client này ghi có actor_id = người đó. */
  const as = (label: string) => sessionClient(jars[label]);

  function projectCall(who: string | null, qs = "", projectId = projectA) {
    return handleGetProjectActivity(
      new Request(
        new URL(`/api/v1/projects/${projectId}/activity${qs}`, APP_ORIGIN),
      ),
      projectId,
      { session: sessionClient(who ? jars[who] : new CookieJar()) },
    );
  }

  function taskCall(who: string, taskId: string, qs = "") {
    return handleGetTaskActivity(
      new Request(new URL(`/api/v1/tasks/${taskId}/activity${qs}`, APP_ORIGIN)),
      taskId,
      { session: sessionClient(jars[who]) },
    );
  }

  async function okBody(res: Response) {
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    return (await res.json()) as ActivityListResponse;
  }

  async function list(who: string, qs = "") {
    return okBody(await projectCall(who, qs));
  }

  /** Đọc hết mọi trang với limit nhỏ. */
  async function listAll(who: string, qs = "", limit = 3) {
    const out: ActivityEntry[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 100; i++) {
      const sep = qs ? "&" : "?";
      const page: ActivityListResponse = await list(
        who,
        `${qs}${sep}limit=${limit}${cursor ? `&cursor=${cursor}` : ""}`,
      );
      expect(page.data.length).toBeLessThanOrEqual(limit);
      out.push(...page.data);
      cursor = page.next_cursor;
      if (!cursor) return out;
    }
    throw new Error("Phân trang không dừng");
  }

  async function expectError(res: Response, status: number, code: string) {
    expect(res.status).toBe(status);
    const body = (await res.json()) as ErrorBody;
    expect(body.error.code).toBe(code);
    expect(body.error.request_id.length).toBeGreaterThan(0);
    return body;
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
      "gone",
      "outsider",
      "locked",
    ]) {
      await createUser(label);
    }
    const adm = await service
      .from("profiles")
      .update({ is_admin: true })
      .eq("id", users.admin);
    if (adm.error) throw adm.error;

    projectA = randomUUID();
    projectB = randomUUID();
    const projects = await service.from("projects").insert([
      { id: projectA, name: `IT E6-2 A ${tag}`, created_by: users.pm },
      // Dự án khác của outsider: nhật ký không được lẫn sang dự án A.
      { id: projectB, name: `IT E6-2 B ${tag}`, created_by: users.outsider },
    ]);
    if (projects.error) throw projects.error;
    const rows = await service.from("project_members").insert([
      { project_id: projectA, user_id: users.member, role: "member" },
      { project_id: projectA, user_id: users.viewer, role: "viewer" },
      { project_id: projectA, user_id: users.gone, role: "member" },
      { project_id: projectA, user_id: users.locked, role: "pm" },
    ]);
    if (rows.error) throw rows.error;

    const [statuses, types] = await Promise.all([
      service
        .from("task_statuses")
        .select("id, category, position")
        .eq("project_id", projectA)
        .order("position"),
      service
        .from("task_types")
        .select("id")
        .eq("project_id", projectA)
        .order("position"),
    ]);
    if (statuses.error) throw statuses.error;
    if (types.error) throw types.error;
    statusTodo = statuses.data.find((s) => s.category === "todo")!.id;
    statusDoing = statuses.data.find((s) => s.category === "in_progress")!.id;
    typeId = types.data[0].id as string;

    for (const label of Object.keys(users)) await signIn(label);

    const base = {
      project_id: projectA,
      status_id: statusTodo,
      type_id: typeId,
      priority: "medium",
    };
    // 1. PM tạo task chính (actor = PM) có mô tả "bí mật".
    const main = await as("pm")
      .from("tasks")
      .insert({
        ...base,
        title: `Task chính ${tag}`,
        description: SECRET_DESCRIPTION,
      })
      .select("id")
      .single();
    if (main.error) throw main.error;
    task.main = main.data.id as string;
    // 2. Thành viên tạo task của mình (actor = member).
    const own = await as("member")
      .from("tasks")
      .insert({ ...base, title: `Task thành viên ${tag}` })
      .select("id")
      .single();
    if (own.error) throw own.error;
    task.own = own.data.id as string;
    // 3. "gone" tạo một task, rồi bị gỡ khỏi dự án (email không còn được thấy với PM).
    const goneTask = await as("gone")
      .from("tasks")
      .insert({ ...base, title: `Task của gone ${tag}` })
      .select("id")
      .single();
    if (goneTask.error) throw goneTask.error;
    // 4. PM đổi trạng thái và giao task chính cho thành viên, sửa mô tả.
    const upd = await as("pm")
      .from("tasks")
      .update({
        status_id: statusDoing,
        assignee_id: users.member,
        description: `${SECRET_DESCRIPTION} (sửa)`,
      })
      .eq("id", task.main);
    if (upd.error) throw upd.error;
    // 5. Thành viên đổi ưu tiên task của mình.
    const prio = await as("member")
      .from("tasks")
      .update({ priority: "urgent" })
      .eq("id", task.own);
    if (prio.error) throw prio.error;
    // 6. PM tạo task tạm, đổi ưu tiên (bản ghi không chứa tên), rồi xóa.
    const tmp = await as("pm")
      .from("tasks")
      .insert({ ...base, title: `Task sẽ xóa ${tag}` })
      .select("id")
      .single();
    if (tmp.error) throw tmp.error;
    task.removed = tmp.data.id as string;
    const tmpUpd = await as("pm")
      .from("tasks")
      .update({ priority: "low" })
      .eq("id", task.removed);
    if (tmpUpd.error) throw tmpUpd.error;
    const tmpDel = await as("pm").from("tasks").delete().eq("id", task.removed);
    if (tmpDel.error) throw tmpDel.error;
    // Nhật ký dự án B (do outsider làm) không được xuất hiện ở A.
    const other = await as("outsider")
      .from("tasks")
      .insert({
        project_id: projectB,
        title: `Task dự án B ${tag}`,
        priority: "medium",
      });
    if (other.error) throw other.error;

    const del = await service
      .from("project_members")
      .delete()
      .eq("project_id", projectA)
      .eq("user_id", users.gone);
    if (del.error) throw del.error;
    const lock = await service
      .from("profiles")
      .update({ is_active: false })
      .eq("id", users.locked);
    if (lock.error) throw lock.error;
  });

  afterAll(async () => {
    if (!service) return;
    for (const id of [projectA, projectB]) {
      if (id) await service.from("projects").delete().eq("id", id);
    }
    for (const id of created) await service.auth.admin.deleteUser(id);
  });

  describe("quyền và thứ tự kiểm", () => {
    it("chưa đăng nhập: 401", async () => {
      await expectError(await projectCall(null), 401, "unauthenticated");
    });

    it("người ngoài, người bị khóa (kể cả là PM), id sai, dự án không có: 404", async () => {
      await expectError(await projectCall("outsider"), 404, "not_found");
      await expectError(await projectCall("locked"), 404, "not_found");
      await expectError(
        await projectCall("pm", "", "khong-phai-uuid"),
        404,
        "not_found",
      );
      await expectError(
        await projectCall("admin", "", randomUUID()),
        404,
        "not_found",
      );
      await expectError(
        await taskCall("outsider", task.main),
        404,
        "not_found",
      );
    });

    it("Thành viên, Người xem: 403 (kiểm vai trò trước schema)", async () => {
      for (const who of ["member", "viewer"]) {
        await expectError(await projectCall(who), 403, "forbidden");
        await expectError(await projectCall(who, "?bogus=1"), 403, "forbidden");
        await expectError(await taskCall(who, task.main), 403, "forbidden");
      }
    });

    it("tham số sai: 400 kèm trường lỗi", async () => {
      const cases: [string, string][] = [
        ["?bogus=1", "bogus"],
        ["?limit=101", "limit"],
        ["?limit=0", "limit"],
        ["?from=2026-02-30", "from"],
        ["?from=2026-11-18&to=2026-11-17", "to"],
        ["?actor_id=me", "actor_id"],
        ["?entity_type=label", "entity_type"],
        ["?action=truncate", "action"],
        ["?cursor=abc!", "cursor"],
        ["?action=create&action=update", "action"],
      ];
      for (const [qs, field] of cases) {
        const body = await expectError(
          await projectCall("pm", qs),
          400,
          "validation_failed",
        );
        expect(body.error.details?.map((d) => d.field)).toContain(field);
      }
      const body = await expectError(
        await taskCall("pm", task.main, "?actor_id=" + users.pm),
        400,
        "validation_failed",
      );
      expect(body.error.details?.[0]).toEqual({
        field: "actor_id",
        issue: "unknown_field",
      });
    });

    it("Admin không là thành viên vẫn xem được", async () => {
      const body = await list("admin");
      expect(body.data.length).toBeGreaterThan(0);
    });
  });

  describe("AC1: mới nhất trước, phân trang con trỏ", () => {
    it("PM thấy mọi thay đổi của dự án, mới nhất trước, không lẫn dự án khác", async () => {
      const body = await list("pm", "?limit=100");
      expect(body.next_cursor).toBeNull();
      const entries = body.data;
      // Bản ghi mới nhất là việc gỡ "gone" khỏi dự án (service_role: actor null = hệ thống).
      expect(entries[0]).toMatchObject({
        entity_type: "project_member",
        action: "delete",
        entity_id: users.gone,
        actor: null,
      });
      for (let i = 1; i < entries.length; i++) {
        const prev = entries[i - 1];
        const cur = entries[i];
        // Chuỗi thời điểm Postgres (cùng múi +00:00) so sánh theo thứ tự chữ đúng cả micro giây.
        const order =
          prev.created_at > cur.created_at ||
          (prev.created_at === cur.created_at && prev.id > cur.id);
        expect(order).toBe(true);
      }
      expect(entries.some((e) => e.entity_name === `Task dự án B ${tag}`)).toBe(
        false,
      );
      // Bản ghi tạo dự án nằm cuối (cũ nhất).
      expect(entries[entries.length - 1]).toMatchObject({
        entity_type: "project",
        action: "create",
        entity_id: projectA,
        entity_name: `IT E6-2 A ${tag}`,
      });
    });

    it("đi hết các trang limit=3: đủ, không trùng, cùng thứ tự", async () => {
      const all = (await list("pm", "?limit=100")).data.map((e) => e.id);
      const paged = (await listAll("pm")).map((e) => e.id);
      expect(paged).toEqual(all);
      expect(new Set(paged).size).toBe(paged.length);
    });
  });

  describe("AC2: lọc người thực hiện và thời gian", () => {
    it("actor_id: chỉ thay đổi của người đó, đủ số lượng", async () => {
      const mine = await listAll("pm", `?actor_id=${users.member}`);
      expect(mine.length).toBe(2); // tạo task của mình, đổi ưu tiên
      expect(mine.every((e) => e.actor?.id === users.member)).toBe(true);
      const pm = await listAll("pm", `?actor_id=${users.pm}`);
      // tạo + sửa task chính, tạo + sửa + xóa task tạm
      expect(pm.length).toBe(5);
      expect(pm.every((e) => e.actor?.id === users.pm)).toBe(true);
      const nobody = await list("pm", `?actor_id=${randomUUID()}`);
      expect(nobody.data).toEqual([]);
    });

    it("khoảng ngày theo giờ Việt Nam, tính cả hai đầu", async () => {
      const all = (await list("pm", "?limit=100")).data;
      // Mọi bản ghi vừa tạo nằm trong ngày Việt Nam hiện tại (hoặc hôm qua nếu chạy sát 0 giờ).
      const days = [...new Set(all.map((e) => vnDateOf(e.created_at)))].sort();
      const first = days[0];
      const last = days[days.length - 1];
      const inRange = (await list("pm", `?limit=100&from=${first}&to=${last}`))
        .data;
      expect(inRange.map((e) => e.id)).toEqual(all.map((e) => e.id));
      // Một ngày duy nhất from = to: đúng các bản ghi có ngày Việt Nam đó.
      const sameDay = (await list("pm", `?limit=100&from=${last}&to=${last}`))
        .data;
      expect(sameDay.map((e) => e.id)).toEqual(
        all.filter((e) => vnDateOf(e.created_at) === last).map((e) => e.id),
      );
      // Ngày trước / sau: không có gì.
      expect((await list("pm", `?to=${addDays(first, -1)}`)).data).toEqual([]);
      expect((await list("pm", `?from=${addDays(last, 1)}`)).data).toEqual([]);
    });

    it("ranh giới: bản ghi trước 0 giờ Việt Nam thuộc hôm trước (UTC lệch 7 giờ)", async () => {
      const all = (await list("pm", "?limit=100")).data;
      const sample = all[0];
      const utcDay = sample.created_at.slice(0, 10);
      const vnDay = vnDateOf(sample.created_at);
      const res = (await list("pm", `?limit=100&from=${vnDay}&to=${vnDay}`))
        .data;
      expect(res.map((e) => e.id)).toContain(sample.id);
      // Khi ngày UTC khác ngày Việt Nam (chạy test trong 17:00-24:00 UTC), lọc theo ngày UTC phải
      // KHÔNG chứa bản ghi: chứng minh API dùng giờ Việt Nam chứ không dùng ngày UTC.
      if (utcDay !== vnDay) {
        const utc = (await list("pm", `?limit=100&from=${utcDay}&to=${utcDay}`))
          .data;
        expect(utc.map((e) => e.id)).not.toContain(sample.id);
      }
    });

    it("kết hợp lọc người, đối tượng, loại thay đổi", async () => {
      const res = await listAll(
        "pm",
        `?actor_id=${users.pm}&entity_type=task&action=delete`,
      );
      expect(res.length).toBe(1);
      expect(res[0]).toMatchObject({
        action: "delete",
        entity_type: "task",
        entity_id: task.removed,
        entity_name: `Task sẽ xóa ${tag}`,
        changes: [],
      });
      const members = await listAll("pm", "?entity_type=project_member");
      expect(members.every((e) => e.entity_type === "project_member")).toBe(
        true,
      );
    });
  });

  describe("nội dung: thông điệp có nghĩa, không lộ dữ liệu", () => {
    it("đổi trạng thái, giao việc: tên trạng thái, người; mô tả chỉ báo đã sửa", async () => {
      const body = await okBody(await taskCall("pm", task.main));
      expect(body.data.every((e) => e.entity_id === task.main)).toBe(true);
      const update = body.data.find((e) => e.action === "update")!;
      expect(update.entity_name).toBe(`Task chính ${tag}`);
      const byField = Object.fromEntries(
        update.changes.map((c) => [c.field, c]),
      );
      expect((byField.status_id.before as ActivityRef).id).toBe(statusTodo);
      expect((byField.status_id.before as ActivityRef).name).toBeTruthy();
      expect((byField.status_id.after as ActivityRef).id).toBe(statusDoing);
      expect(byField.assignee_id.before).toBeNull();
      expect(byField.assignee_id.after).toEqual({
        id: users.member,
        full_name: fullName("member"),
        email: email("member"),
      });
      expect(byField.description).toEqual({
        field: "description",
        kind: "redacted",
        before: null,
        after: null,
      });
      // Không trả cột ngoài danh sách cho phép (completed_at, created_by, project_id...).
      expect(Object.keys(byField).sort()).toEqual(
        ["assignee_id", "description", "status_id"].sort(),
      );
      const all = JSON.stringify((await list("admin", "?limit=100")).data);
      expect(all).not.toContain(SECRET_DESCRIPTION);
    });

    it("task đã xóa: tên lấy từ bản ghi xóa; API task trả 404", async () => {
      const removed = (await list("pm", "?limit=100")).data.filter(
        (e) => e.entity_id === task.removed,
      );
      expect(removed.map((e) => e.action)).toEqual([
        "delete",
        "update",
        "create",
      ]);
      expect(removed.every((e) => e.entity_name === `Task sẽ xóa ${tag}`)).toBe(
        true,
      );
      await expectError(await taskCall("pm", task.removed), 404, "not_found");
    });

    it("email: PM chỉ thấy email thành viên hiện tại; Admin thấy mọi người", async () => {
      const pmView = (await list("pm", "?limit=100")).data;
      const goneByPm = pmView.find((e) => e.actor?.id === users.gone)!
        .actor as ActivityPerson;
      expect(goneByPm.full_name).toBe(fullName("gone"));
      expect(goneByPm.email).toBeNull();
      const memberByPm = pmView.find((e) => e.actor?.id === users.member)!
        .actor as ActivityPerson;
      expect(memberByPm.email).toBe(email("member"));
      // Bản ghi gỡ thành viên: tên vẫn hiện, email không.
      expect(pmView[0].entity_name).toBe(fullName("gone"));

      const adminView = (await list("admin", "?limit=100")).data;
      const goneByAdmin = adminView.find((e) => e.actor?.id === users.gone)!
        .actor as ActivityPerson;
      expect(goneByAdmin.email).toBe(email("gone"));
    });

    it("nhật ký task chỉ chứa task đó, mới nhất trước, phân trang được", async () => {
      const first = await okBody(await taskCall("pm", task.main, "?limit=1"));
      expect(first.data).toHaveLength(1);
      expect(first.data[0].action).toBe("update");
      expect(first.next_cursor).not.toBeNull();
      const second = await okBody(
        await taskCall("pm", task.main, `?limit=1&cursor=${first.next_cursor}`),
      );
      expect(second.data.map((e) => e.action)).toEqual(["create"]);
      expect(second.next_cursor).toBeNull();
      // Bản ghi tạo không chứa tên, mô tả trong changes (tên ở entity_name).
      expect(second.data[0].changes.map((c) => c.field)).not.toContain(
        "description",
      );
      expect(second.data[0].actor?.id).toBe(users.pm);
    });
  });
});
