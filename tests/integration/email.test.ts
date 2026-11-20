/**
 * Test tích hợp Story E4-2 (QLDA-66) với Supabase cục bộ: email giao việc.
 * Đi qua API thật (tạo/sửa task bằng client phiên) → trigger thông báo → hàng đợi email_outbox →
 * worker /api/internal/email/dispatch (lõi Route Handler, service_role) → Mailpit cục bộ.
 *
 * AC1: người nhận bật email, được giao việc → nhận email có tên task và liên kết tuyệt đối.
 * AC2: email lỗi → thử lại (pending, attempts tăng, giãn cách), thao tác giao việc không hỏng.
 * Ca biên: tắt email theo loại (không vào hàng đợi), mặc định đổi trạng thái tắt, mẫu en theo
 * locale, chống chèn HTML, mất quyền dự án trước lúc gửi → skipped, CRON_SECRET sai → 401,
 * API GET/PUT /api/v1/me/notification-preferences (403 Origin, 401 phiên, 400 trường lạ).
 *
 * CSDL cục bộ dùng chung: worker có thể nhận cả dòng của lần chạy khác; test chỉ khẳng định trên
 * dòng/hộp thư của tài khoản tạm (địa chỉ có `tag`). Chạy: make db-start && make test-integration.
 */
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signInWithPassword } from "@/lib/auth/sign-in";
import { resolveEmailConfig } from "@/lib/email/config";
import { dispatchEmailBatch } from "@/lib/email/dispatch";
import { handleEmailDispatch } from "@/lib/email/dispatch-handler";
import type { EmailSender } from "@/lib/email/types";
import {
  handleGetNotificationPreferences,
  handlePutNotificationPreferences,
} from "@/lib/notifications/preferences-handlers";
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
const MAILPIT_URL = process.env.MAILPIT_URL || "http://127.0.0.1:54324";
const APP_BASE_URL = "https://qlda.example.test";
const CRON_SECRET = `it-cron-${randomUUID()}`;

let service: SupabaseClient;

interface ErrorBody {
  error: { code: string; details?: { field: string; issue: string }[] };
}

interface OutboxRow {
  id: string;
  user_id: string;
  type: string;
  task_id: string;
  status: string;
  attempts: number;
  last_error: string | null;
  next_attempt_at: string;
}

interface MailpitSummary {
  ID: string;
  Subject: string;
}

describe.skipIf(!enabled)("Email giao việc (Supabase cục bộ + Mailpit)", () => {
  const tag = randomUUID().slice(0, 8);
  const password = `It-${randomUUID()}`;
  const created: string[] = [];
  const users: Record<string, string> = {};
  const jars: Record<string, CookieJar> = {};
  let projectId: string;
  let statusInProgress: string;

  const email = (label: string) => `it-e4-2-${label}-${tag}@example.com`;
  const fullName = (label: string) => `IT ${label} ${tag}`;
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

  async function createUser(label: string, locale = "vi") {
    const { data, error } = await service.auth.admin.createUser({
      email: email(label),
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName(label) },
    });
    if (error) throw error;
    created.push(data.user.id);
    users[label] = data.user.id;
    if (locale !== "vi") {
      const r = await service
        .from("profiles")
        .update({ locale })
        .eq("id", data.user.id);
      if (r.error) throw r.error;
    }
    const jar = new CookieJar();
    const result = await signInWithPassword(sessionClient(jar), {
      email: email(label),
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

  async function outbox(taskId: string): Promise<OutboxRow[]> {
    const { data, error } = await service
      .from("email_outbox")
      .select(
        "id, user_id, type, task_id, status, attempts, last_error, next_attempt_at",
      )
      .eq("task_id", taskId)
      .order("created_at");
    if (error) throw error;
    return data as OutboxRow[];
  }

  async function mailbox(label: string): Promise<MailpitSummary[]> {
    const query = encodeURIComponent(`to:"${email(label)}"`);
    const res = await fetch(`${MAILPIT_URL}/api/v1/search?query=${query}`);
    expect(res.ok).toBe(true);
    return ((await res.json()) as { messages: MailpitSummary[] }).messages;
  }

  async function mailBody(id: string) {
    const res = await fetch(`${MAILPIT_URL}/api/v1/message/${id}`);
    expect(res.ok).toBe(true);
    return (await res.json()) as { Text: string; HTML: string };
  }

  /** Gọi lõi Route Handler như pg_cron (POST + Bearer CRON_SECRET), gửi vào Mailpit. */
  function dispatch(secret = CRON_SECRET) {
    return handleEmailDispatch(
      new Request(url("/api/internal/email/dispatch"), {
        method: "POST",
        headers: { authorization: `Bearer ${secret}` },
      }),
      {
        env: {
          CRON_SECRET,
          EMAIL_PROVIDER: "mailpit",
          MAILPIT_URL,
          APP_BASE_URL,
        },
        createDb: () => service,
        limit: 100,
        log: () => {},
      },
    );
  }

  beforeAll(async () => {
    assertLocalSupabase();
    assertLocalSupabase(MAILPIT_URL);
    service = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    await createUser("pm");
    await createUser("member");
    await createUser("member2");
    await createUser("english", "en");
    await createUser("leaver");

    projectId = randomUUID();
    const project = await service
      .from("projects")
      .insert({ id: projectId, name: `IT E4-2 ${tag}`, created_by: users.pm });
    if (project.error) throw project.error;
    const members = await service.from("project_members").insert(
      ["member", "member2", "english", "leaver"].map((label) => ({
        project_id: projectId,
        user_id: users[label],
        role: "member",
      })),
    );
    if (members.error) throw members.error;
    const statuses = await service
      .from("task_statuses")
      .select("id, category, position")
      .eq("project_id", projectId)
      .order("position");
    if (statuses.error) throw statuses.error;
    statusInProgress = statuses.data.find((x) => x.category === "in_progress")!
      .id as string;
  });

  afterAll(async () => {
    if (!service) return;
    if (projectId) await service.from("projects").delete().eq("id", projectId);
    for (const id of created) await service.auth.admin.deleteUser(id);
  });

  describe("API /api/v1/me/notification-preferences", () => {
    const path = "/api/v1/me/notification-preferences";

    it("GET mặc định: giao việc bật, đổi trạng thái tắt", async () => {
      const res = await handleGetNotificationPreferences(
        new Request(url(path)),
        deps("member"),
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        data: {
          email: {
            task_assigned: true,
            task_status_changed: false,
            task_due_soon: true,
          },
        },
      });
    });

    it("Không có phiên → 401", async () => {
      const res = await handleGetNotificationPreferences(
        new Request(url(path)),
        {
          session: sessionClient(new CookieJar()),
        },
      );
      expect(res.status).toBe(401);
    });

    it("PUT khác Origin → 403; trường lạ → 400; giá trị không phải boolean → 400", async () => {
      const cross = await handlePutNotificationPreferences(
        send(
          "PUT",
          path,
          { email: { task_assigned: false } },
          "https://evil.example",
        ),
        deps("member2"),
      );
      expect(cross.status).toBe(403);

      const unknown = await handlePutNotificationPreferences(
        send("PUT", path, { email: { task_assigned: false, due_soon: true } }),
        deps("member2"),
      );
      expect(unknown.status).toBe(400);
      expect(((await unknown.json()) as ErrorBody).error.details).toEqual([
        { field: "email.due_soon", issue: "unknown_field" },
      ]);

      const wrongType = await handlePutNotificationPreferences(
        send("PUT", path, { email: { task_assigned: "no" } }),
        deps("member2"),
      );
      expect(wrongType.status).toBe(400);
    });

    it("PUT một loại: lưu, loại kia giữ nguyên; chỉ ảnh hưởng chính chủ", async () => {
      const res = await handlePutNotificationPreferences(
        send("PUT", path, { email: { task_assigned: false } }),
        deps("member2"),
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        data: {
          email: {
            task_assigned: false,
            task_status_changed: false,
            task_due_soon: true,
          },
        },
      });
      const other = await handleGetNotificationPreferences(
        new Request(url(path)),
        deps("member"),
      );
      expect(
        ((await other.json()) as { data: { email: unknown } }).data.email,
      ).toEqual({
        task_assigned: true,
        task_status_changed: false,
        task_due_soon: true,
      });
    });
  });

  describe("Hàng đợi và gửi", () => {
    let assignedTask: string;
    const title = `Đặc tả <b>email</b> & "trích dẫn" ${tag}`;

    it("AC1: giao việc cho người bật email → một dòng pending trong hàng đợi", async () => {
      assignedTask = await createTask("pm", {
        title,
        assignee_id: users.member,
      });
      const rows = await outbox(assignedTask);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        user_id: users.member,
        type: "task_assigned",
        status: "pending",
        attempts: 0,
      });
    });

    it("Tắt email giao việc → có thông báo trong app nhưng không vào hàng đợi", async () => {
      const t = await createTask("pm", {
        title: `Việc của member2 ${tag}`,
        assignee_id: users.member2,
      });
      expect(await outbox(t)).toEqual([]);
      const n = await service
        .from("notifications")
        .select("type")
        .eq("task_id", t)
        .eq("user_id", users.member2);
      expect(n.data).toEqual([{ type: "task_assigned" }]);
    });

    it("Đổi trạng thái: mặc định tắt email nên không vào hàng đợi", async () => {
      await patchTask("member", assignedTask, { status_id: statusInProgress });
      const rows = await outbox(assignedTask);
      expect(rows.map((r) => r.type)).toEqual(["task_assigned"]);
    });

    it("Worker: CRON_SECRET sai → 401, không gửi", async () => {
      const res = await dispatch("sai-bi-mat");
      expect(res.status).toBe(401);
      expect((await outbox(assignedTask))[0].status).toBe("pending");
    });

    it("AC1: worker gửi vào Mailpit: tên task, liên kết tuyệt đối, HTML đã thoát ký tự", async () => {
      const res = await dispatch();
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        data: { status: string; sent: number };
      };
      expect(body.data.status).toBe("ok");
      expect(body.data.sent).toBeGreaterThanOrEqual(1);

      const [row] = await outbox(assignedTask);
      expect(row).toMatchObject({ status: "sent", attempts: 1 });

      const messages = await mailbox("member");
      expect(messages).toHaveLength(1);
      expect(messages[0].Subject).toBe(
        `[Quản lý dự án] Bạn được giao task: ${title}`,
      );
      const message = await mailBody(messages[0].ID);
      const link = `${APP_BASE_URL}/projects/${projectId}/tasks/${assignedTask}`;
      expect(message.Text).toContain(title);
      expect(message.Text).toContain(link);
      expect(message.Text).toContain(fullName("pm"));
      expect(message.HTML).toContain(`href="${link}"`);
      expect(message.HTML).toContain("Đặc tả &lt;b&gt;email&lt;/b&gt; &amp;");
      expect(message.HTML).not.toContain("<b>email</b>");
    });

    it("Mẫu tiếng Anh theo profiles.locale", async () => {
      const t = await createTask("pm", {
        title: `English task ${tag}`,
        assignee_id: users.english,
      });
      expect((await dispatch()).status).toBe(200);
      expect((await outbox(t))[0].status).toBe("sent");
      const messages = await mailbox("english");
      expect(messages.map((m) => m.Subject)).toEqual([
        `[Project Manager] You were assigned: English task ${tag}`,
      ]);
    });

    it("Mất quyền dự án trước lúc gửi → skipped, không có email", async () => {
      const t = await createTask("pm", {
        title: `Việc người rời dự án ${tag}`,
        assignee_id: users.leaver,
      });
      expect(await outbox(t)).toHaveLength(1);
      const removed = await service
        .from("project_members")
        .delete()
        .eq("project_id", projectId)
        .eq("user_id", users.leaver);
      if (removed.error) throw removed.error;

      expect((await dispatch()).status).toBe(200);
      expect((await outbox(t))[0]).toMatchObject({
        status: "skipped",
        last_error: "recipient_not_eligible",
      });
      expect(await mailbox("leaver")).toEqual([]);
    });

    it("AC2: gửi lỗi → thử lại sau (pending, attempts 1, giãn cách), giao việc vẫn thành công", async () => {
      const t = await createTask("pm", {
        title: `Việc gửi lỗi ${tag}`,
        assignee_id: users.member,
      });
      // Task và thông báo trong app vẫn có dù email chưa gửi được.
      const task = await service
        .from("tasks")
        .select("assignee_id")
        .eq("id", t);
      expect(task.data).toEqual([{ assignee_id: users.member }]);

      const mailpit = resolveEmailConfig({
        EMAIL_PROVIDER: "mailpit",
        MAILPIT_URL,
        APP_BASE_URL,
      });
      if (!mailpit.enabled) throw new Error("Mailpit chưa cấu hình được");
      // Lỗi tạm thời chỉ với địa chỉ của test này; dòng của lần chạy khác vẫn gửi Mailpit thật.
      const flaky: EmailSender = {
        name: "flaky",
        send: async (message) =>
          message.to === email("member")
            ? { ok: false, retryable: true, code: "flaky_503" }
            : mailpit.sender.send(message),
      };
      const before = Date.now();
      await dispatchEmailBatch({
        db: service,
        sender: flaky,
        appBaseUrl: APP_BASE_URL,
        limit: 100,
        log: () => {},
      });
      const [row] = await outbox(t);
      expect(row).toMatchObject({
        status: "pending",
        attempts: 1,
        last_error: "flaky_503",
      });
      // Lần thử lại đầu sau ~1 phút: chưa đến hạn nên lần chạy kế tiếp không nhận lại.
      expect(Date.parse(row.next_attempt_at)).toBeGreaterThan(before + 50_000);
      await dispatchEmailBatch({
        db: service,
        sender: flaky,
        appBaseUrl: APP_BASE_URL,
        limit: 100,
        log: () => {},
      });
      expect((await outbox(t))[0].attempts).toBe(1);
      // Chỉ có email của task đầu, không có email của task gửi lỗi.
      expect((await mailbox("member")).map((m) => m.Subject)).not.toContain(
        `[Quản lý dự án] Bạn được giao task: Việc gửi lỗi ${tag}`,
      );
    });
  });
});
