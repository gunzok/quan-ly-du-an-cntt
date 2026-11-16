/**
 * Test tích hợp Story E5-1 (QLDA-60) với Supabase cục bộ: GET /api/v1/projects/{id}/dashboard.
 * Gọi thẳng lõi Route Handler với client phiên tạo từ hũ cookie (giống trình duyệt): đi qua getUser,
 * RLS và hàm public.project_dashboard().
 *
 * AC1: seed một tập task biết trước rồi so TỪNG con số. Ca biên: task không hạn, hạn đúng hôm nay
 * (không trễ), task xong sau hạn (không trễ), ranh giới nửa đêm giờ Việt Nam, người phụ trách đã bị
 * gỡ khỏi dự án, quan hệ chặn từ task đã xong (không còn bị chặn).
 * AC2: dự án chưa có task trả toàn số 0 (giao diện hiện trạng thái rỗng).
 *
 * Chạy: make db-start && make test-integration. Tài khoản và dự án tạo tạm, xóa ở afterAll.
 */
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signInWithPassword } from "@/lib/auth/sign-in";
import { handleGetDashboard } from "@/lib/dashboard/handlers";
import type { Dashboard } from "@/lib/dashboard/model";
import { todayIso } from "@/lib/projects/format";
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
const TODAY = "2030-06-15";

let service: SupabaseClient;

interface ErrorBody {
  error: { code: string; request_id: string };
}

describe.skipIf(!enabled)("API dashboard tiến độ (Supabase cục bộ)", () => {
  const tag = randomUUID().slice(0, 8);
  const password = `It-${randomUUID()}`;
  const created: string[] = [];
  const users: Record<string, string> = {};
  const jars: Record<string, CookieJar> = {};
  const task: Record<string, string> = {};
  let projectA: string;
  let projectEmpty: string;

  const email = (label: string) => `it-e5-1-${label}-${tag}@example.com`;
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

  function call(
    who: string,
    projectId: string = projectA,
    opts: { qs?: string; today?: string | null } = {},
  ) {
    const path = `/api/v1/projects/${projectId}/dashboard${opts.qs ?? ""}`;
    return handleGetDashboard(
      new Request(new URL(path, APP_ORIGIN)),
      projectId,
      {
        session: sessionClient(jars[who]),
        today: opts.today === null ? undefined : (opts.today ?? TODAY),
      },
    );
  }

  async function ok(who: string, projectId?: string, today?: string | null) {
    const res = await call(who, projectId, { today });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    return ((await res.json()) as { data: Dashboard }).data;
  }

  async function expectError(res: Response, status: number, code: string) {
    expect(res.status).toBe(status);
    const body = (await res.json()) as ErrorBody;
    expect(body.error.code).toBe(code);
    expect(body.error.request_id.length).toBeGreaterThan(0);
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
    projectEmpty = randomUUID();
    const projects = await service.from("projects").insert([
      { id: projectA, name: `IT E5-1 A ${tag}`, created_by: users.pm },
      { id: projectEmpty, name: `IT E5-1 rỗng ${tag}`, created_by: users.pm },
    ]);
    if (projects.error) throw projects.error;
    const rows = await service.from("project_members").insert([
      { project_id: projectA, user_id: users.member, role: "member" },
      { project_id: projectA, user_id: users.viewer, role: "viewer" },
      { project_id: projectA, user_id: users.gone, role: "member" },
      { project_id: projectA, user_id: users.locked, role: "member" },
      { project_id: projectEmpty, user_id: users.viewer, role: "viewer" },
    ]);
    if (rows.error) throw rows.error;

    const statuses = await service
      .from("task_statuses")
      .select("id, category, position")
      .eq("project_id", projectA)
      .order("position");
    if (statuses.error) throw statuses.error;
    const status = (category: string) =>
      statuses.data.find((s) => s.category === category)!.id as string;
    const types = await service
      .from("task_types")
      .select("id, position")
      .eq("project_id", projectA)
      .order("position");
    if (types.error) throw types.error;
    const [typeTask, typeBug] = types.data.map((x) => x.id as string);

    const seed: {
      key: string;
      status: string;
      type?: string;
      due: string | null;
      assignee: string | null;
      priority: string;
    }[] = [
      // Xong SAU hạn: không tính trễ.
      {
        key: "doneLate",
        status: "done",
        due: "2030-06-01",
        assignee: "member",
        priority: "high",
      },
      // Trễ 1 ngày.
      {
        key: "overdue",
        status: "todo",
        due: "2030-06-14",
        assignee: "member",
        priority: "urgent",
      },
      // Hạn đúng hôm nay: chưa trễ.
      {
        key: "dueToday",
        status: "in_progress",
        due: TODAY,
        assignee: "pm",
        priority: "medium",
      },
      // Không hạn: không bao giờ trễ.
      {
        key: "noDue",
        status: "todo",
        due: null,
        assignee: null,
        priority: "low",
      },
      // Người phụ trách sẽ bị gỡ khỏi dự án; trễ 5 ngày.
      {
        key: "goneOverdue",
        status: "todo",
        due: "2030-06-10",
        assignee: "gone",
        priority: "high",
      },
      // Bị chặn bởi task "overdue" (chưa xong).
      {
        key: "blocked",
        status: "in_progress",
        due: "2030-07-01",
        assignee: "pm",
        priority: "medium",
      },
      // Chặn bởi task đã xong: không còn bị chặn.
      {
        key: "unblocked",
        status: "todo",
        due: null,
        assignee: null,
        priority: "low",
      },
      {
        key: "doneOnTime",
        status: "done",
        type: "bug",
        due: "2030-06-20",
        assignee: "pm",
        priority: "medium",
      },
    ];
    for (const s of seed) {
      const res = await service
        .from("tasks")
        .insert({
          project_id: projectA,
          title: `IT E5-1 ${s.key}`,
          created_by: users.pm,
          status_id: status(s.status),
          type_id: s.type === "bug" ? typeBug : typeTask,
          due_date: s.due,
          assignee_id: s.assignee ? users[s.assignee] : null,
          priority: s.priority,
        })
        .select("id")
        .single();
      if (res.error) throw res.error;
      task[s.key] = res.data.id as string;
    }
    const rel = await service.from("task_relations").insert([
      { from_task_id: task.overdue, to_task_id: task.blocked, kind: "blocks" },
      {
        from_task_id: task.doneLate,
        to_task_id: task.unblocked,
        kind: "blocks",
      },
      // relates không làm task bị chặn.
      { from_task_id: task.overdue, to_task_id: task.noDue, kind: "relates" },
    ]);
    if (rel.error) throw rel.error;

    // Gỡ "gone" khỏi dự án: task vẫn giữ người phụ trách cũ (quyết định E1-6).
    const del = await service
      .from("project_members")
      .delete()
      .eq("project_id", projectA)
      .eq("user_id", users.gone);
    if (del.error) throw del.error;

    for (const label of Object.keys(users)) await signIn(label);
    const lock = await service
      .from("profiles")
      .update({ is_active: false })
      .eq("id", users.locked);
    if (lock.error) throw lock.error;
  });

  afterAll(async () => {
    if (!service) return;
    for (const id of [projectA, projectEmpty]) {
      if (id) await service.from("projects").delete().eq("id", id);
    }
    for (const id of created) await service.auth.admin.deleteUser(id);
  });

  it("AC1: tổng, đã xong, % hoàn thành, trễ hạn, bị chặn khớp dữ liệu task", async () => {
    const d = await ok("member");
    expect(d.project_id).toBe(projectA);
    expect(d.today).toBe(TODAY);
    expect(d.total).toBe(8);
    expect(d.done).toBe(2);
    expect(d.open).toBe(6);
    expect(d.completion_percent).toBe(25);
    expect(d.todo).toBe(4);
    expect(d.in_progress).toBe(2);
    // Chỉ "overdue" và "goneOverdue": hạn hôm nay, không hạn, xong sau hạn đều không tính.
    expect(d.overdue).toBe(2);
    expect(d.open_no_due).toBe(2);
    expect(d.blocked).toBe(1);
  });

  it("AC1: phân bố theo trạng thái (đủ mọi trạng thái, cả trạng thái 0 task), loại, ưu tiên", async () => {
    const d = await ok("member");
    const byStatus = Object.fromEntries(
      d.by_status.map((s) => [s.name, s.count]),
    );
    expect(byStatus).toEqual({
      Mới: 4,
      "Đang thực hiện": 2,
      "Đang kiểm thử": 0,
      "Cần phản hồi": 0,
      "Đã xong": 2,
      "Đã đóng": 0,
      "Từ chối": 0,
    });
    expect(d.by_status.map((s) => s.category)).toEqual([
      "todo",
      "in_progress",
      "in_progress",
      "in_progress",
      "done",
      "done",
      "done",
    ]);
    expect(d.by_status.reduce((n, s) => n + s.count, 0)).toBe(d.total);
    expect(d.by_type.map((x) => [x.name, x.count])).toEqual([
      ["Task", 7],
      ["Bug", 1],
      ["Milestone", 0],
      ["Phase", 0],
    ]);
    expect(d.by_priority).toEqual([
      { priority: "urgent", count: 1 },
      { priority: "high", count: 2 },
      { priority: "medium", count: 3 },
      { priority: "low", count: 2 },
    ]);
  });

  it("AC1: theo người phụ trách, kể cả chưa giao và người đã bị gỡ khỏi dự án", async () => {
    const d = await ok("pm");
    expect(
      d.by_assignee.map((a) => ({
        id: a.assignee_id,
        is_member: a.is_member,
        total: a.total,
        done: a.done,
        open: a.open,
        overdue: a.overdue,
      })),
    ).toEqual([
      { id: users.pm, is_member: true, total: 3, done: 1, open: 2, overdue: 0 },
      {
        id: users.member,
        is_member: true,
        total: 2,
        done: 1,
        open: 1,
        overdue: 1,
      },
      {
        id: users.gone,
        is_member: false,
        total: 1,
        done: 0,
        open: 1,
        overdue: 1,
      },
      { id: null, is_member: false, total: 2, done: 0, open: 2, overdue: 0 },
    ]);
    // PM (người tạo dự án) đọc được mọi hồ sơ (RLS profiles) nên thấy tên người đã rời.
    expect(d.by_assignee[2].full_name).toBe(fullName("gone"));
    expect(d.by_assignee[3].full_name).toBeNull();
    expect(d.by_assignee.reduce((n, a) => n + a.total, 0)).toBe(d.total);
  });

  it("người đã rời dự án: Người xem không còn chung dự án nên không thấy tên (RLS), vẫn thấy số", async () => {
    const d = await ok("viewer");
    const gone = d.by_assignee.find((a) => a.assignee_id === users.gone)!;
    expect(gone).toMatchObject({ is_member: false, full_name: null, open: 1 });
    expect(
      d.by_assignee.find((a) => a.assignee_id === users.pm)?.full_name,
    ).toBe(fullName("pm"));
  });

  it("AC1: danh sách task trễ hạn, hạn sớm nhất trước, kèm số ngày trễ", async () => {
    const d = await ok("member");
    expect(d.overdue_tasks).toEqual([
      {
        id: task.goneOverdue,
        title: "IT E5-1 goneOverdue",
        due_date: "2030-06-10",
        days_overdue: 5,
        assignee_id: users.gone,
      },
      {
        id: task.overdue,
        title: "IT E5-1 overdue",
        due_date: "2030-06-14",
        days_overdue: 1,
        assignee_id: users.member,
      },
    ]);
  });

  it("ranh giới nửa đêm giờ Việt Nam: 23:59:59 vẫn là hôm nay, 00:00 sang ngày mới thì task hạn hôm qua thành trễ", async () => {
    // 16:59:59 UTC ngày 15 = 23:59:59 ngày 15 ở Việt Nam; 17:00 UTC = 00:00 ngày 16.
    const before = todayIso(new Date("2030-06-15T16:59:59Z"));
    const after = todayIso(new Date("2030-06-15T17:00:00Z"));
    expect([before, after]).toEqual(["2030-06-15", "2030-06-16"]);
    expect((await ok("member", projectA, before)).overdue).toBe(2);
    const next = await ok("member", projectA, after);
    expect(next.overdue).toBe(3);
    expect(next.overdue_tasks.map((x) => [x.id, x.days_overdue])).toEqual([
      [task.goneOverdue, 6],
      [task.overdue, 2],
      [task.dueToday, 1],
    ]);
  });

  it("không truyền ngày: dùng hôm nay theo giờ Việt Nam", async () => {
    const d = await ok("member", projectA, null);
    expect([todayIso(), todayIso(new Date(Date.now() - 5000))]).toContain(
      d.today,
    );
  });

  it("AC2: dự án chưa có task trả toàn số 0, vẫn có danh sách trạng thái", async () => {
    const d = await ok("viewer", projectEmpty);
    expect(d).toMatchObject({
      total: 0,
      done: 0,
      open: 0,
      overdue: 0,
      blocked: 0,
      completion_percent: 0,
      by_assignee: [],
      overdue_tasks: [],
    });
    expect(d.by_status.length).toBe(7);
    expect(d.by_status.every((s) => s.count === 0)).toBe(true);
  });

  it("quyền: PM, Thành viên, Người xem, Admin (không thuộc dự án) đọc được cùng số liệu", async () => {
    const results = await Promise.all(
      ["pm", "member", "viewer", "admin"].map((who) => ok(who)),
    );
    for (const d of results) {
      expect([d.total, d.done, d.overdue, d.blocked]).toEqual([8, 2, 2, 1]);
    }
  });

  it("người ngoài, người bị khóa, người đã bị gỡ: 404 (BR-10); chưa đăng nhập: 401", async () => {
    for (const who of ["outsider", "locked", "gone"]) {
      await expectError(await call(who), 404, "not_found");
    }
    jars.anon = new CookieJar();
    await expectError(await call("anon"), 401, "unauthenticated");
  });

  it("id sai dạng hoặc không tồn tại: 404", async () => {
    await expectError(await call("admin", "khong-phai-uuid"), 404, "not_found");
    await expectError(await call("admin", randomUUID()), 404, "not_found");
  });

  it("tham số lạ: 400 với người có quyền; người ngoài vẫn 404 (không lộ dự án)", async () => {
    await expectError(
      await call("member", projectA, { qs: "?x=1" }),
      400,
      "validation_failed",
    );
    await expectError(
      await call("outsider", projectA, { qs: "?x=1" }),
      404,
      "not_found",
    );
  });
});
