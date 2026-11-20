import type { SupabaseClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";
import { formatCalendarDate } from "@/lib/i18n/format";
import { vi as strings } from "@/lib/i18n/messages/vi";
import { waitForHydration } from "../hydration";
import { mailboxOf, waitForMail } from "../mailpit";
import { cleanupTempData, serviceClient } from "../temp-data";
import {
  createFlowUsers,
  createProject,
  dispatchEmails,
  expectNoA11yViolations,
  loginState,
  newTag,
  openAs,
  type FlowUser,
} from "./support";

/**
 * Luồng 7 (test-strategy.md mục 4): PM giao việc → người được giao thấy thông báo trong app và nhận
 * email (worker gửi vào Mailpit) → tắt email "Được giao việc" ở hồ sơ → lần giao sau vẫn có thông báo
 * trong app nhưng không có email → nhắc hạn: chạy public.run_due_reminders với thời điểm cố định
 * (08:00 giờ Việt Nam hôm nay, như pg_cron) → thông báo và email nhắc hạn.
 *
 * Email đi qua worker thật: POST /api/internal/email/dispatch (Bearer CRON_SECRET, `make test-e2e` đặt
 * CRON_SECRET và EMAIL_PROVIDER=mailpit cho ứng dụng). Worker nhận MỌI dòng đang chờ nên gọi dưới khóa
 * "email-outbox" dùng chung với test tích hợp email (tests/support/shared-lock.ts).
 * Chi tiết: notifications.spec.ts, profile.spec.ts (công tắc email), due-reminders.spec.ts,
 * tests/integration/email.test.ts, tests/integration/due-reminders.test.ts.
 */
const tag = newTag();
const createdUsers: string[] = [];
const projectIds: string[] = [];
let service: SupabaseClient | null = null;
let pm: FlowUser;
let member: FlowUser;
let projectId = "";
const projectName = `E2E ${tag} Luồng 7`;
const titles = {
  first: `Rà soát hợp đồng ${tag}`,
  second: `Cập nhật danh bạ ${tag}`,
  due: `Nộp báo cáo quý ${tag}`,
};
const ids: Record<string, string> = {};

/** Ngày lịch YYYY-MM-DD theo giờ Việt Nam hôm nay, cộng n ngày. */
function vnDate(n: number): string {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const [y, m, d] = today.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

test.beforeAll(async () => {
  service = serviceClient();
  ({ pm, member } = await createFlowUsers(
    service,
    7,
    tag,
    { pm: `E2E PM ${tag}`, member: `E2E Thành viên ${tag}` },
    createdUsers,
  ));
  projectId = await createProject(service, projectName, pm.id, [
    { user: member.id, role: "member" },
  ]);
  projectIds.push(projectId);
  const base = { project_id: projectId, created_by: pm.id };
  const { data, error } = await service
    .from("tasks")
    .insert([
      { ...base, title: titles.first },
      { ...base, title: titles.second },
      // Hạn ngày mai, đã giao sẵn: dùng cho bước nhắc hạn.
      {
        ...base,
        title: titles.due,
        assignee_id: member.id,
        due_date: vnDate(1),
      },
    ])
    .select("id, title");
  if (error) throw error;
  for (const r of data) ids[r.title as string] = r.id as string;
  // Bắt đầu sạch: bỏ thông báo và email chờ gửi do tạo task đã giao sẵn.
  for (const table of ["notifications", "email_outbox"]) {
    const del = await service.from(table).delete().eq("user_id", member.id);
    if (del.error) throw del.error;
  }
});

test.afterAll(async () => {
  await cleanupTempData(service, { projectIds, userIds: createdUsers });
});

const n = strings.notifications;
const bell = (page: Page) =>
  page.getByTestId("notification-bell").locator("visible=true");
const panelOf = (page: Page) => page.getByRole("dialog", { name: n.heading });

/** PM giao task qua ngăn chi tiết (giao diện thật). */
async function assignInUi(page: Page, taskId: string) {
  const td = strings.taskDetail;
  await page.goto(`/projects/${projectId}/tasks/${taskId}`);
  const panel = page.getByRole("complementary", { name: td.panelLabel });
  await expect(panel.locator('[data-field="label_ids"]')).toBeVisible();
  await panel.getByLabel(td.fields.assignee_id).selectOption(member.id);
  await expect(panel.getByTestId("task-save-status")).toContainText(
    td.save.saved(td.fields.assignee_id),
  );
}

test("Luồng 7: giao việc → thông báo trong app và email → tắt email → nhắc hạn theo thời điểm cố định", async ({
  browser,
  baseURL,
  request,
}) => {
  const [pmState, memberState] = await Promise.all([
    loginState(browser, baseURL!, pm),
    loginState(browser, baseURL!, member),
  ]);
  const pmPage = await openAs(browser, baseURL!, pmState);
  const memberPage = await openAs(browser, baseURL!, memberState);
  const mp = memberPage.page;

  await test.step("PM giao việc → người được giao thấy chuông có số, mở thông báo tới task", async () => {
    await mp.goto("/");
    await expect(bell(mp)).toHaveAttribute("data-count-ready", "true");
    await expect(bell(mp)).toHaveAccessibleName(n.bellLabel);

    await assignInUi(pmPage.page, ids[titles.first]);

    await mp.reload();
    await expect(bell(mp)).toHaveAccessibleName(n.bellLabelUnread(1));
    await bell(mp).click();
    const text = n.assigned(pm.name, titles.first);
    const item = panelOf(mp)
      .getByTestId("notification-item")
      .filter({ hasText: text });
    await expect(item).toBeVisible();
    await expectNoA11yViolations(mp, "ngăn thông báo");
    await item.getByRole("link").click();
    await expect(mp).toHaveURL(
      `/projects/${projectId}/tasks/${ids[titles.first]}`,
    );
    await expect(bell(mp)).toHaveAccessibleName(n.bellLabel);
  });

  await test.step("Worker gửi email giao việc vào Mailpit, có liên kết tới task", async () => {
    await dispatchEmails(request);
    const mail = await waitForMail(member.email, {
      subject: strings.email.assignedSubject(titles.first),
    });
    expect(mail.Text).toContain(
      `${new URL(baseURL!).origin}/projects/${projectId}/tasks/${ids[titles.first]}`,
    );
  });

  await test.step("Người được giao tắt email 'Được giao việc' ở hồ sơ", async () => {
    const ep = strings.emailPreferences;
    await mp.goto("/profile");
    await waitForHydration(mp);
    const section = mp.getByRole("region", { name: ep.heading });
    const assigned = section.getByRole("switch", {
      name: ep.types.task_assigned,
      exact: true,
    });
    await expect(assigned).toBeChecked();
    const saved = mp.waitForResponse(
      (r) =>
        r.url().endsWith("/api/v1/me/notification-preferences") &&
        r.request().method() === "PUT",
    );
    await assigned.click();
    expect((await saved).status()).toBe(200);
    await expect(assigned).not.toBeChecked();
    await expectNoA11yViolations(mp, "hồ sơ: email thông báo");
  });

  await test.step("Giao việc lần hai: vẫn có thông báo trong app, KHÔNG có email", async () => {
    await assignInUi(pmPage.page, ids[titles.second]);
    await mp.goto("/");
    await expect(bell(mp)).toHaveAccessibleName(n.bellLabelUnread(1));
    const outbox = await service!
      .from("email_outbox")
      .select("id")
      .eq("user_id", member.id)
      .eq("task_id", ids[titles.second]);
    expect(outbox.error).toBeNull();
    expect(outbox.data).toEqual([]);
    await dispatchEmails(request);
    const subjects = (await mailboxOf(member.email)).map((m) => m.Subject);
    expect(subjects.join("\n")).not.toContain(titles.second);
  });

  await test.step("Nhắc hạn: run_due_reminders lúc 08:00 giờ VN hôm nay → thông báo và email 'đến hạn ngày mai'", async () => {
    const now = `${vnDate(0)}T08:00:00+07:00`;
    const run = await service!.rpc("run_due_reminders", {
      p_now: now,
      p_project_id: projectId,
    });
    expect(run.error).toBeNull();
    expect(run.data).toBe(1);
    // Chạy lại cùng thời điểm: không nhắc trùng.
    const again = await service!.rpc("run_due_reminders", {
      p_now: now,
      p_project_id: projectId,
    });
    expect(again.data).toBe(0);

    await mp.reload();
    await expect(bell(mp)).toHaveAccessibleName(n.bellLabelUnread(2));
    await bell(mp).click();
    await expect(
      panelOf(mp)
        .getByTestId("notification-item")
        .filter({
          hasText: n.dueSoon(
            titles.due,
            1,
            formatCalendarDate(vnDate(1), "vi")!,
          ),
        }),
    ).toBeVisible();
    await dispatchEmails(request);
    await waitForMail(member.email, {
      subject: strings.email.dueSoonSubject(titles.due, 1),
    });
  });

  await pmPage.close();
  await memberPage.close();
});
