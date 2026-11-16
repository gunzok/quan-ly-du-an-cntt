/**
 * Test tích hợp Story E4-1 (QLDA-59) với Supabase cục bộ: thông báo trong app.
 * Gọi thẳng lõi Route Handler (task và thông báo) với client phiên tạo từ hũ cookie (giống trình
 * duyệt): đi qua getUser, RLS, trigger tạo thông báo và RPC notification_payloads.
 *
 * AC1: được giao task (qua API tạo/sửa task) → thông báo hiện ở chuông (số chưa đọc, danh sách).
 * AC2: đánh dấu đã đọc → số chưa đọc giảm; đánh dấu tất cả → về 0.
 * Ca biên: không tự thông báo, đổi trạng thái báo người tạo, chỉ chủ sở hữu (Admin, PM không đọc
 * hay đánh dấu thông báo người khác: 404), mất quyền dự án → bản trung tính (không lộ tiêu đề),
 * người bị khóa, phân trang con trỏ, thứ tự kiểm 403/401/404/400.
 *
 * Chạy: make db-start && make test-integration. Tài khoản và dự án tạo tạm, xóa ở afterAll.
 */
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signInWithPassword } from "@/lib/auth/sign-in";
import {
  handleListNotifications,
  handleMarkAllRead,
  handleMarkRead,
  handleUnreadCount,
} from "@/lib/notifications/handlers";
import type {
  Notification,
  NotificationListResponse,
} from "@/lib/notifications/model";
import { handleCreateTask, handlePatchTask } from "@/lib/tasks/handlers";
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
  error: { code: string; details?: { field: string; issue: string }[] };
}

describe.skipIf(!enabled)("API thông báo trong app (Supabase cục bộ)", () => {
  const tag = randomUUID().slice(0, 8);
  const password = `It-${randomUUID()}`;
  const created: string[] = [];
  const users: Record<string, string> = {};
  const jars: Record<string, CookieJar> = {};
  let projectId: string;
  let statusInProgress: string;
  let statusName: string;

  const email = (label: string) => `it-e4-1-${label}-${tag}@example.com`;
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

  const deps = (who: string) => ({ session: sessionClient(jars[who]) });
  const url = (path: string) => new URL(path, APP_ORIGIN);
  function send(
    method: string,
    path: string,
    body?: unknown,
    origin = APP_ORIGIN,
  ) {
    return new Request(url(path), {
      method,
      headers: {
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        origin,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  async function unread(who: string): Promise<number> {
    const res = await handleUnreadCount(
      new Request(url("/api/v1/notifications/unread-count")),
      deps(who),
    );
    expect(res.status).toBe(200);
    return ((await res.json()) as { data: { unread_count: number } }).data
      .unread_count;
  }

  async function list(who: string, qs = ""): Promise<NotificationListResponse> {
    const res = await handleListNotifications(
      new Request(url(`/api/v1/notifications${qs}`)),
      deps(who),
    );
    expect(res.status).toBe(200);
    return (await res.json()) as NotificationListResponse;
  }

  async function createTask(who: string, body: Record<string, unknown>) {
    const res = await handleCreateTask(
      send("POST", `/api/v1/projects/${projectId}/tasks`, body),
      projectId,
      deps(who),
    );
    expect(res.status).toBe(201);
    return ((await res.json()) as { data: { id: string } }).data.id;
  }

  async function patchTask(
    who: string,
    id: string,
    body: Record<string, unknown>,
  ) {
    const res = await handlePatchTask(
      send("PATCH", `/api/v1/tasks/${id}`, body),
      id,
      deps(who),
    );
    expect(res.status).toBe(200);
  }

  const markRead = (who: string, id: string, body?: unknown, origin?: string) =>
    handleMarkRead(
      send("POST", `/api/v1/notifications/${id}/read`, body, origin),
      id,
      deps(who),
    );

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

    projectId = randomUUID();
    const project = await service
      .from("projects")
      .insert({ id: projectId, name: `IT E4-1 ${tag}`, created_by: users.pm });
    if (project.error) throw project.error;
    const members = await service.from("project_members").insert([
      { project_id: projectId, user_id: users.member, role: "member" },
      { project_id: projectId, user_id: users.member2, role: "member" },
      { project_id: projectId, user_id: users.locked, role: "member" },
    ]);
    if (members.error) throw members.error;
    const statuses = await service
      .from("task_statuses")
      .select("id, name, category, position")
      .eq("project_id", projectId)
      .order("position");
    if (statuses.error) throw statuses.error;
    const s = statuses.data.find((x) => x.category === "in_progress")!;
    statusInProgress = s.id as string;
    statusName = s.name as string;

    for (const label of [
      "admin",
      "pm",
      "member",
      "member2",
      "outsider",
      "locked",
    ]) {
      await signIn(label);
    }
  });

  afterAll(async () => {
    if (!service) return;
    if (projectId) await service.from("projects").delete().eq("id", projectId);
    for (const id of created) await service.auth.admin.deleteUser(id);
  });

  let assignedTask: string;
  let memberNotification: Notification;

  it("AC1: PM giao task cho Thành viên → thông báo hiện ở chuông của Thành viên", async () => {
    expect(await unread("member")).toBe(0);
    assignedTask = await createTask("pm", {
      title: "Viết đặc tả thông báo",
      assignee_id: users.member,
    });
    expect(await unread("member")).toBe(1);
    const body = await list("member");
    expect(body.unread_count).toBe(1);
    expect(body.data).toHaveLength(1);
    memberNotification = body.data[0];
    expect(memberNotification).toMatchObject({
      type: "task_assigned",
      task_id: assignedTask,
      project_id: projectId,
      read_at: null,
      task_visible: true,
      title: "Viết đặc tả thông báo",
      status_name: null,
      actor: { id: users.pm, full_name: fullName("pm") },
    });
    // Người giao không nhận thông báo cho thao tác của chính mình.
    expect(await unread("pm")).toBe(0);
  });

  it("Giao lại cho người khác qua PATCH → người mới nhận; tự giao cho mình thì không", async () => {
    const t = await createTask("pm", {
      title: "Việc tự giao",
      assignee_id: users.pm,
    });
    expect(await unread("pm")).toBe(0);
    await patchTask("pm", t, { assignee_id: users.member2 });
    const body = await list("member2");
    expect(body.data.map((n) => [n.type, n.task_id])).toEqual([
      ["task_assigned", t],
    ]);
  });

  it("Đổi trạng thái → người tạo nhận task_status_changed kèm tên trạng thái, người đổi không", async () => {
    await patchTask("member", assignedTask, { status_id: statusInProgress });
    const pm = await list("pm");
    expect(pm.data).toHaveLength(1);
    expect(pm.data[0]).toMatchObject({
      type: "task_status_changed",
      task_id: assignedTask,
      status_name: statusName,
      actor: { id: users.member },
    });
    expect(
      (await list("member")).data.filter(
        (n) => n.type === "task_status_changed",
      ),
    ).toHaveLength(0);
  });

  it("AC2: đánh dấu đã đọc → số chưa đọc giảm; gọi lại vẫn 200 (idempotent)", async () => {
    await createTask("pm", {
      title: "Việc thứ hai",
      assignee_id: users.member,
    });
    expect(await unread("member")).toBe(2);
    const res = await markRead("member", memberNotification.id);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: Notification;
      unread_count: number;
    };
    expect(body.data.read_at).not.toBeNull();
    expect(body.unread_count).toBe(1);
    expect(await unread("member")).toBe(1);
    const again = await markRead("member", memberNotification.id, {});
    expect(again.status).toBe(200);
    expect(((await again.json()) as { data: Notification }).data.read_at).toBe(
      body.data.read_at,
    );
    expect(await unread("member")).toBe(1);
    const unreadOnly = await list("member", "?unread=true");
    expect(unreadOnly.data.every((n) => n.read_at === null)).toBe(true);
    expect(unreadOnly.data).toHaveLength(1);
  });

  it("Đánh dấu tất cả → về 0, không đụng thông báo của người khác", async () => {
    const pmBefore = await unread("pm");
    const res = await handleMarkAllRead(
      send("POST", "/api/v1/notifications/read-all"),
      deps("member"),
    );
    expect(res.status).toBe(200);
    expect(
      (
        (await res.json()) as {
          data: { updated: number; unread_count: number };
        }
      ).data,
    ).toEqual({
      updated: 1,
      unread_count: 0,
    });
    expect(await unread("member")).toBe(0);
    expect(await unread("pm")).toBe(pmBefore);
  });

  it("Chỉ chủ sở hữu: PM, Admin, người khác không thấy và không đánh dấu được (404)", async () => {
    const pmNote = (await list("pm")).data[0];
    for (const who of ["member", "admin", "outsider"]) {
      const res = await markRead(who, pmNote.id);
      expect(res.status, who).toBe(404);
      expect(
        (await list(who)).data.find((n) => n.id === pmNote.id),
        who,
      ).toBeUndefined();
    }
    expect(await unread("pm")).toBeGreaterThan(0);
    expect((await list("admin")).data).toHaveLength(0);
  });

  it("Mất quyền dự án → thông báo còn nhưng chỉ ở dạng trung tính (không lộ tiêu đề)", async () => {
    const before = (await list("member2")).data[0];
    expect(before.task_visible).toBe(true);
    const removed = await service
      .from("project_members")
      .delete()
      .eq("project_id", projectId)
      .eq("user_id", users.member2);
    expect(removed.error).toBeNull();
    const after = (await list("member2")).data[0];
    expect(after).toMatchObject({
      id: before.id,
      type: "task_assigned",
      task_visible: false,
      title: null,
      status_name: null,
      actor: null,
    });
    expect(JSON.stringify(after)).not.toContain("Việc tự giao");
    // Vẫn đánh dấu đã đọc được thông báo của mình.
    const res = await markRead("member2", before.id);
    expect(res.status).toBe(200);
    expect(
      ((await res.json()) as { data: Notification }).data.title,
    ).toBeNull();
  });

  it("Người bị khóa không thấy thông báo nào", async () => {
    await createTask("pm", {
      title: "Giao trước khi khóa",
      assignee_id: users.locked,
    });
    const lock = await service
      .from("profiles")
      .update({ is_active: false })
      .eq("id", users.locked);
    expect(lock.error).toBeNull();
    expect(await unread("locked")).toBe(0);
    expect((await list("locked")).data).toHaveLength(0);
  });

  it("Phân trang con trỏ: mới nhất trước, không trùng, không sót", async () => {
    for (let i = 0; i < 3; i++) {
      await createTask("pm", {
        title: `Trang ${i}`,
        assignee_id: users.member,
      });
    }
    const all = await list("member");
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page: NotificationListResponse = await list(
        "member",
        `?limit=2${cursor ? `&cursor=${cursor}` : ""}`,
      );
      expect(page.data.length).toBeLessThanOrEqual(2);
      seen.push(...page.data.map((n) => n.id));
      cursor = page.next_cursor;
    } while (cursor);
    expect(seen).toEqual(all.data.map((n) => n.id));
    expect(new Set(seen).size).toBe(seen.length);
    expect(all.data[0].title).toBe("Trang 2");
  });

  it("Thứ tự kiểm: Origin 403, phiên 401, id lạ 404, trường lạ 400", async () => {
    const id = memberNotification.id;
    expect(
      (await markRead("member", id, undefined, "https://evil.example")).status,
    ).toBe(403);
    const anon = { session: sessionClient(new CookieJar()) };
    expect(
      (
        await handleMarkRead(
          send("POST", `/api/v1/notifications/${id}/read`),
          id,
          anon,
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await handleUnreadCount(
          new Request(url("/api/v1/notifications/unread-count")),
          anon,
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await handleListNotifications(
          new Request(url("/api/v1/notifications")),
          anon,
        )
      ).status,
    ).toBe(401);
    expect((await markRead("member", "khong-phai-uuid")).status).toBe(404);
    expect((await markRead("member", randomUUID())).status).toBe(404);
    // Không thấy (của người khác) là 404 kể cả khi thân sai: không lộ sự tồn tại.
    const pmNote = (await list("pm")).data[0];
    expect((await markRead("member", pmNote.id, { read: true })).status).toBe(
      404,
    );
    const bad = await markRead("member", id, { read: true });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as ErrorBody).error.details).toEqual([
      { field: "read", issue: "unknown_field" },
    ]);
    const badAll = await handleMarkAllRead(
      send("POST", "/api/v1/notifications/read-all", { user_id: users.pm }),
      deps("member"),
    );
    expect(badAll.status).toBe(400);
    const badList = await handleListNotifications(
      new Request(url("/api/v1/notifications?user_id=x")),
      deps("member"),
    );
    expect(badList.status).toBe(400);
    const badUnread = await handleListNotifications(
      new Request(url("/api/v1/notifications?unread=yes")),
      deps("member"),
    );
    expect(badUnread.status).toBe(400);
  });
});
