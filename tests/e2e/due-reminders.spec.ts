import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { formatCalendarDate } from "@/lib/i18n/format";
import { vi as strings } from "@/lib/i18n/messages/vi";
import { cleanupTempData, createTempUsers, serviceClient } from "./temp-data";
import { waitForHydration } from "./hydration";
import { signInWithPassword } from "./login";

/**
 * Story E4-3 (QLDA-74): nhắc hạn trong ngăn thông báo và công tắc "Nhắc hạn" ở mục "Email thông
 * báo" trang /profile.
 *
 * Dữ liệu tạm tạo bằng khóa service của stack CỤC BỘ; nhắc hạn sinh ra bằng chính hàm lập lịch
 * public.run_due_reminders (như job pg_cron) GIỚI HẠN dự án tạm (p_project_id), nên không nhắc task
 * của người khác trên CSDL dùng chung. Một tài khoản, đăng nhập qua /login đúng một lần.
 */
const t = strings.notifications;
const ep = strings.emailPreferences;
const BLOCKING_IMPACTS = new Set(["critical", "serious"]);
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const tag = randomUUID().slice(0, 8);
const password = `E2e-${randomUUID()}`;
const projectId = randomUUID();
const emails = {
  pm: `e2e-e4-3-pm-${tag}@example.com`,
  member: `e2e-e4-3-member-${tag}@example.com`,
};
const users: Record<string, string> = {};
const titles = {
  tomorrow: `Nộp báo cáo tuần ${tag}`,
  inThree: `Chuẩn bị họp sprint ${tag}`,
};
const taskIds: Record<string, string> = {};

let service: SupabaseClient | null = null;
type StorageState = Awaited<ReturnType<BrowserContext["storageState"]>>;
let memberState: StorageState | null = null;

/** Ngày lịch YYYY-MM-DD theo giờ Việt Nam, cộng n ngày. */
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

const dueText = (title: string, days: number) =>
  t.dueSoon(title, days, formatCalendarDate(vnDate(days), "vi")!);

test.beforeAll(async ({ browser, baseURL }) => {
  service = serviceClient();
  await createTempUsers(
    service,
    Object.fromEntries(
      Object.entries(emails).map(([label, email]) => [
        label,
        { email, password, fullName: `E2E ${label} ${tag}` },
      ]),
    ),
    users,
  );
  const project = await service.from("projects").insert({
    id: projectId,
    name: `E2E ${tag} Nhắc hạn`,
    created_by: users.pm,
  });
  if (project.error) throw project.error;
  const member = await service
    .from("project_members")
    .insert({ project_id: projectId, user_id: users.member, role: "member" });
  if (member.error) throw member.error;
  for (const [key, title, days] of [
    ["tomorrow", titles.tomorrow, 1],
    ["inThree", titles.inThree, 3],
  ] as const) {
    const { data, error } = await service
      .from("tasks")
      .insert({
        project_id: projectId,
        title,
        created_by: users.pm,
        assignee_id: users.member,
        due_date: vnDate(days),
      })
      .select("id")
      .single();
    if (error) throw error;
    taskIds[key] = data.id as string;
  }
  // Chỉ giữ nhắc hạn trong ngăn (bỏ thông báo "được giao" do tạo task).
  const del = await service
    .from("notifications")
    .delete()
    .eq("user_id", users.member);
  if (del.error) throw del.error;
  const run = await service.rpc("run_due_reminders", {
    p_project_id: projectId,
  });
  if (run.error) throw run.error;
  expect(run.data).toBe(2);

  const context = await browser.newContext({ baseURL, locale: "vi-VN" });
  const page = await context.newPage();
  await signInWithPassword(page, emails.member, password);
  memberState = await context.storageState();
  await context.close();
});

test.afterAll(async () => {
  await cleanupTempData(service, {
    projectIds: [projectId],
    userIds: Object.values(users),
  });
});

async function open(browser: Browser, baseURL: string, path: string) {
  const context = await browser.newContext({
    baseURL,
    locale: "vi-VN",
    colorScheme: "light",
    storageState: memberState!,
  });
  const page = await context.newPage();
  await page.goto(path);
  return { page, close: () => context.close() };
}

async function blockingViolations(page: Page) {
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getComputedTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => undefined)),
    ),
  );
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  return results.violations
    .filter((v) => v.impact && BLOCKING_IMPACTS.has(v.impact))
    .flatMap((v) => v.nodes.map((n) => `${v.id} @ ${n.target.join(" ")}`));
}

const bell = (page: Page) =>
  page.getByTestId("notification-bell").locator("visible=true");
const panel = (page: Page) => page.getByRole("dialog", { name: t.heading });
const item = (page: Page, text: string) =>
  panel(page).getByTestId("notification-item").filter({ hasText: text });

test.describe.configure({ mode: "serial" });

test("AC1: ngăn thông báo hiện nhắc hạn 1 và 3 ngày, mở được task (sáng, tối, 360 px, bàn phím)", async ({
  browser,
  baseURL,
}) => {
  const { page, close } = await open(browser, baseURL!, "/");
  await expect(bell(page)).toHaveAttribute("data-count-ready", "true");
  await expect(bell(page)).toHaveAccessibleName(t.bellLabelUnread(2));

  // Bàn phím: focus chuông, Enter mở ngăn.
  await bell(page).focus();
  await page.keyboard.press("Enter");
  await expect(panel(page)).toBeVisible();
  const tomorrow = dueText(titles.tomorrow, 1);
  await expect(item(page, tomorrow)).toHaveCount(1);
  await expect(item(page, tomorrow).getByRole("link")).toHaveText(
    `${t.unreadMark}: ${tomorrow}`,
  );
  await expect(item(page, dueText(titles.inThree, 3))).toHaveCount(1);
  expect(await blockingViolations(page)).toEqual([]);

  // Tối và 360 px: không tràn ngang, không vi phạm axe chặn.
  await page.emulateMedia({ colorScheme: "dark" });
  await page.setViewportSize({ width: 360, height: 800 });
  await expect(item(page, tomorrow)).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  expect(await blockingViolations(page)).toEqual([]);

  // Bấm nhắc hạn → tới task, số chưa đọc giảm.
  await item(page, tomorrow).getByRole("link").click();
  await expect(page).toHaveURL(
    `/projects/${projectId}/tasks/${taskIds.tomorrow}`,
  );
  await expect(bell(page)).toHaveAccessibleName(t.bellLabelUnread(1));
  await close();
});

test("AC2: công tắc Nhắc hạn mặc định bật, tắt bằng bàn phím thì lưu và giữ sau tải lại", async ({
  browser,
  baseURL,
}) => {
  const { page, close } = await open(browser, baseURL!, "/profile");
  await waitForHydration(page);
  const section = page.getByRole("region", { name: ep.heading });
  const due = section.getByRole("switch", {
    name: ep.types.task_due_soon,
    exact: true,
  });
  await expect(due).toBeChecked();
  await expect(due).toHaveAccessibleDescription(ep.typeHints.task_due_soon);
  expect(await blockingViolations(page)).toEqual([]);

  const put = () =>
    page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/v1/me/notification-preferences") &&
        r.request().method() === "PUT",
    );
  await due.focus();
  let saved = put();
  await page.keyboard.press("Space");
  expect((await saved).status()).toBe(200);
  await expect(due).not.toBeChecked();
  await expect(due).toBeFocused();
  await expect(
    section
      .getByRole("status")
      .filter({ hasText: ep.saved(ep.types.task_due_soon, false) }),
  ).toBeVisible();
  const { data, error } = await service!
    .from("notification_preferences")
    .select("type, email_enabled")
    .eq("user_id", users.member);
  if (error) throw error;
  expect(data).toEqual([{ type: "task_due_soon", email_enabled: false }]);

  await page.reload();
  await waitForHydration(page);
  await expect(due).not.toBeChecked();
  // Các công tắc khác giữ mặc định.
  await expect(
    section.getByRole("switch", { name: ep.types.task_assigned, exact: true }),
  ).toBeChecked();

  // Bật lại; kiểm axe ở giao diện tối.
  saved = put();
  await due.check();
  expect((await saved).status()).toBe(200);
  await expect(due).toBeChecked();
  await page.emulateMedia({ colorScheme: "dark" });
  expect(await blockingViolations(page)).toEqual([]);
  await close();
});
