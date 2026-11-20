/**
 * Test tích hợp Story E4-3 (QLDA-74) với Supabase cục bộ: nhắc hạn.
 * Đi qua đường thật: public.run_due_reminders (như job pg_cron, bằng service_role) → thông báo
 * task_due_soon → trigger hàng đợi email (E4-2) → worker /api/internal/email/dispatch → Mailpit.
 *
 * AC1: task sắp đến hạn (1 và 3 ngày), đến thời điểm nhắc → nhắc trong app và email.
 * AC2: tắt "Nhắc hạn" (PUT /api/v1/me/notification-preferences) → vẫn có thông báo trong app, không
 *      có email.
 * Ca biên: chạy lại không nhắc trùng; task đã xong, hạn sau 2 ngày không nhắc; email theo locale.
 *
 * CSDL cục bộ dùng chung: hàm chạy với p_project_id của dự án tạm để không nhắc task của người khác;
 * "hôm nay" là ngày giờ Việt Nam lúc chạy test. Chạy: make db-start && make test-integration.
 */
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signInWithPassword } from "@/lib/auth/sign-in";
import { handleEmailDispatch } from "@/lib/email/dispatch-handler";
import { handleListNotifications } from "@/lib/notifications/handlers";
import type { NotificationListResponse } from "@/lib/notifications/model";
import { handlePutNotificationPreferences } from "@/lib/notifications/preferences-handlers";
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

/** Ngày lịch YYYY-MM-DD theo giờ Việt Nam, cộng n ngày. */
function vnDate(n: number, now = new Date()): string {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const [y, m, d] = today.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** YYYY-MM-DD → dd/mm/yyyy (mẫu email tiếng Việt). */
function viDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

interface MailpitSummary {
  ID: string;
  Subject: string;
}

describe.skipIf(!enabled)("Nhắc hạn (Supabase cục bộ + Mailpit)", () => {
  const tag = randomUUID().slice(0, 8);
  const password = `It-${randomUUID()}`;
  const created: string[] = [];
  const users: Record<string, string> = {};
  const jars: Record<string, CookieJar> = {};
  const tasks: Record<string, string> = {};
  let service: SupabaseClient;
  let projectId: string;

  const email = (label: string) => `it-e4-3-${label}-${tag}@example.com`;
  const deps = (who: string) => ({ session: sessionClient(jars[who]) });
  const url = (path: string) => new URL(path, APP_ORIGIN);

  async function createUser(label: string, locale = "vi") {
    const { data, error } = await service.auth.admin.createUser({
      email: email(label),
      password,
      email_confirm: true,
      user_metadata: { full_name: `IT ${label} ${tag}` },
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

  async function insertTask(
    key: string,
    assignee: string,
    dueInDays: number,
    title = `Nhắc ${key} ${tag}`,
  ) {
    const id = randomUUID();
    const r = await service.from("tasks").insert({
      id,
      project_id: projectId,
      title,
      assignee_id: users[assignee],
      due_date: vnDate(dueInDays),
      created_by: users.pm,
    });
    if (r.error) throw r.error;
    tasks[key] = id;
  }

  function runReminders() {
    return service.rpc("run_due_reminders", { p_project_id: projectId });
  }

  async function list(who: string): Promise<NotificationListResponse> {
    const res = await handleListNotifications(
      new Request(url("/api/v1/notifications?limit=50")),
      deps(who),
    );
    expect(res.status).toBe(200);
    return (await res.json()) as NotificationListResponse;
  }

  async function dueOutbox(taskId: string) {
    const { data, error } = await service
      .from("email_outbox")
      .select("user_id, status")
      .eq("task_id", taskId)
      .eq("type", "task_due_soon");
    if (error) throw error;
    return data as { user_id: string; status: string }[];
  }

  async function mailbox(label: string): Promise<MailpitSummary[]> {
    const query = encodeURIComponent(`to:"${email(label)}"`);
    const res = await fetch(`${MAILPIT_URL}/api/v1/search?query=${query}`);
    expect(res.ok).toBe(true);
    return ((await res.json()) as { messages: MailpitSummary[] }).messages;
  }

  async function mailText(id: string): Promise<string> {
    const res = await fetch(`${MAILPIT_URL}/api/v1/message/${id}`);
    expect(res.ok).toBe(true);
    return ((await res.json()) as { Text: string }).Text;
  }

  function dispatch() {
    return handleEmailDispatch(
      new Request(url("/api/internal/email/dispatch"), {
        method: "POST",
        headers: { authorization: `Bearer ${CRON_SECRET}` },
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
    await createUser("on");
    await createUser("off");
    await createUser("english", "en");

    projectId = randomUUID();
    const project = await service
      .from("projects")
      .insert({ id: projectId, name: `IT E4-3 ${tag}`, created_by: users.pm });
    if (project.error) throw project.error;
    const members = await service.from("project_members").insert(
      ["on", "off", "english"].map((label) => ({
        project_id: projectId,
        user_id: users[label],
        role: "member",
      })),
    );
    if (members.error) throw members.error;

    // AC2: người "off" tắt email nhắc hạn qua API thật (client phiên, RLS chính chủ).
    const put = await handlePutNotificationPreferences(
      new Request(url("/api/v1/me/notification-preferences"), {
        method: "PUT",
        headers: { "content-type": "application/json", origin: APP_ORIGIN },
        body: JSON.stringify({ email: { task_due_soon: false } }),
      }),
      deps("off"),
    );
    expect(put.status).toBe(200);
    expect(await put.json()).toEqual({
      data: {
        email: {
          task_assigned: true,
          task_status_changed: false,
          task_due_soon: false,
        },
      },
    });

    await insertTask("on1", "on", 1, `Nộp <b>báo cáo</b> ${tag}`);
    await insertTask("on3", "on", 3);
    await insertTask("on2", "on", 2);
    await insertTask("off1", "off", 1);
    await insertTask("en3", "english", 3, `Ship report ${tag}`);
    await insertTask("done1", "on", 1);
    const done = await service
      .from("task_statuses")
      .select("id")
      .eq("project_id", projectId)
      .eq("category", "done")
      .order("position")
      .limit(1)
      .single();
    if (done.error) throw done.error;
    const r = await service
      .from("tasks")
      .update({ status_id: done.data.id })
      .eq("id", tasks.done1);
    if (r.error) throw r.error;
  });

  afterAll(async () => {
    if (!service) return;
    if (projectId) await service.from("projects").delete().eq("id", projectId);
    for (const id of created) await service.auth.admin.deleteUser(id);
  });

  it("Trình duyệt (client phiên) không gọi được hàm lập lịch", async () => {
    const { error } = await sessionClient(jars.on).rpc("run_due_reminders", {
      p_project_id: projectId,
    });
    expect(error?.code).toBe("42501");
  });

  it("Chạy hàm: 4 nhắc (1 và 3 ngày), chạy lại không nhắc trùng", async () => {
    const first = await runReminders();
    expect(first.error).toBeNull();
    expect(first.data).toBe(4);
    const again = await runReminders();
    expect(again.error).toBeNull();
    expect(again.data).toBe(0);
  });

  it("AC1: người phụ trách thấy nhắc trong app kèm hạn và số ngày còn lại", async () => {
    const { data } = await list("on");
    const due = data.filter((n) => n.type === "task_due_soon");
    expect(due.map((n) => n.task_id).sort()).toEqual(
      [tasks.on1, tasks.on3].sort(),
    );
    expect(due.find((n) => n.task_id === tasks.on1)).toMatchObject({
      task_visible: true,
      title: `Nộp <b>báo cáo</b> ${tag}`,
      due_date: vnDate(1),
      days_left: 1,
      actor: null,
      status_name: null,
    });
    expect(due.find((n) => n.task_id === tasks.on3)).toMatchObject({
      due_date: vnDate(3),
      days_left: 3,
    });
  });

  it("AC2: tắt nhắc hạn → vẫn có thông báo trong app, không vào hàng đợi email", async () => {
    const { data } = await list("off");
    expect(
      data.filter((n) => n.type === "task_due_soon").map((n) => n.task_id),
    ).toEqual([tasks.off1]);
    expect(await dueOutbox(tasks.off1)).toEqual([]);
    expect(await dueOutbox(tasks.on1)).toEqual([
      { user_id: users.on, status: "pending" },
    ]);
  });

  it("AC1: worker gửi email nhắc đúng mốc (vi, en); người tắt không nhận", async () => {
    const res = await dispatch();
    expect(res.status).toBe(200);
    expect(await dueOutbox(tasks.on1)).toEqual([
      { user_id: users.on, status: "sent" },
    ]);

    const onMails = (await mailbox("on")).filter((m) =>
      m.Subject.includes("đến hạn"),
    );
    const tomorrow = onMails.find((m) =>
      m.Subject.includes(`Nộp <b>báo cáo</b> ${tag} đến hạn ngày mai`),
    );
    expect(tomorrow).toBeDefined();
    const text = await mailText(tomorrow!.ID);
    expect(text).toContain("Task bạn phụ trách đến hạn vào ngày mai.");
    expect(text).toContain(`Hạn: ${viDate(vnDate(1))}`);
    expect(text).toContain(
      `${APP_BASE_URL}/projects/${projectId}/tasks/${tasks.on1}`,
    );
    expect(
      onMails.some((m) =>
        m.Subject.includes(`Nhắc on3 ${tag} còn 3 ngày đến hạn`),
      ),
    ).toBe(true);
    expect(onMails).toHaveLength(2);

    const en = await mailbox("english");
    expect(
      en.some((m) => m.Subject.includes(`Ship report ${tag} is due in 3 days`)),
    ).toBe(true);

    const off = await mailbox("off");
    expect(off.filter((m) => m.Subject.includes("đến hạn"))).toEqual([]);
  });
});
