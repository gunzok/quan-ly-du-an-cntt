import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { vi as strings } from "@/lib/i18n/messages/vi";

/**
 * Story E4-1 (QLDA-59): chuông thông báo trong khung ứng dụng và ngăn thông báo (S16, phần trong
 * app; cài đặt email là E4-2).
 *
 * Tài khoản và dự án tạm tạo bằng khóa service của stack CỤC BỘ (make test-e2e đặt
 * SUPABASE_SERVICE_ROLE_KEY), mật khẩu ngẫu nhiên; afterAll xóa. PM giao việc bằng API thật (phiên
 * của PM trong một context riêng) nên thông báo có tên người giao như ngoài đời.
 *
 * AC1: được giao → chuông có số chưa đọc, ngăn hiện thông báo. AC2: đánh dấu đã đọc → số giảm.
 * Thêm: bấm thông báo tới ngăn chi tiết task, đánh dấu tất cả, bộ lọc, trạng thái rỗng/lỗi, bàn
 * phím (mở, Esc trả focus), aria-live khi có thông báo mới, 360 px, axe sáng/tối.
 */
const t = strings.notifications;
const BLOCKING_IMPACTS = new Set(["critical", "serious"]);
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const tag = randomUUID().slice(0, 8);
const password = `E2e-${randomUUID()}`;
const projectId = randomUUID();
const emails = {
  pm: `e2e-e4-1-pm-${tag}@example.com`,
  member: `e2e-e4-1-member-${tag}@example.com`,
  member2: `e2e-e4-1-member2-${tag}@example.com`,
};
const pmName = `E2E pm ${tag}`;
const users: Record<string, string> = {};
const titles = {
  a: `Viết đặc tả ${tag}`,
  b: `Sửa lỗi đăng nhập ${tag}`,
  c: `Rà soát giao diện ${tag}`,
  d: `Việc cho người thứ hai ${tag}`,
  e: `Việc thông báo mới ${tag}`,
};
const taskIds: Record<string, string> = {};

let service: SupabaseClient | null = null;

function serviceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key || !/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(url)) {
    throw new Error(
      "Cần NEXT_PUBLIC_SUPABASE_URL (localhost) và SUPABASE_SERVICE_ROLE_KEY (make test-e2e).",
    );
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

test.beforeAll(async () => {
  service = serviceClient();
  for (const [label, email] of Object.entries(emails)) {
    const { data, error } = await service.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: `E2E ${label} ${tag}` },
    });
    if (error) throw error;
    users[label] = data.user.id;
  }
  const project = await service.from("projects").insert({
    id: projectId,
    name: `E2E ${tag} Thông báo`,
    created_by: users.pm,
  });
  if (project.error) throw project.error;
  const members = await service.from("project_members").insert([
    { project_id: projectId, user_id: users.member, role: "member" },
    { project_id: projectId, user_id: users.member2, role: "member" },
  ]);
  if (members.error) throw members.error;
  for (const [key, title] of Object.entries(titles)) {
    const { data, error } = await service
      .from("tasks")
      .insert({ project_id: projectId, title, created_by: users.pm })
      .select("id")
      .single();
    if (error) throw error;
    taskIds[key] = data.id as string;
  }
});

test.afterAll(async () => {
  if (!service) return;
  await service.from("projects").delete().eq("id", projectId);
  for (const id of Object.values(users))
    await service.auth.admin.deleteUser(id);
});

async function signInAs(page: Page, who: keyof typeof emails) {
  await page.goto("/login");
  await page.getByLabel(strings.login.emailLabel).fill(emails[who]);
  await page.getByLabel(strings.login.passwordLabel).fill(password);
  await page
    .getByRole("button", { name: strings.login.submit, exact: true })
    .click();
  await expect(page).toHaveURL("/");
}

/** PM giao task bằng API thật (phiên PM trong context riêng, header Origin như trình duyệt). */
async function assignAsPm(
  browser: Browser,
  baseURL: string,
  keys: (keyof typeof titles)[],
  to: keyof typeof emails,
) {
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();
  await signInAs(page, "pm");
  for (const key of keys) {
    const res = await page.request.patch(`/api/v1/tasks/${taskIds[key]}`, {
      data: { assignee_id: users[to] },
      headers: { origin: baseURL },
    });
    expect(res.status(), key).toBe(200);
  }
  await context.close();
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

// Next giữ trang trước ở dạng ẩn sau khi điều hướng phía client: chỉ lấy chuông đang hiện.
const bell = (page: Page) =>
  page.getByTestId("notification-bell").locator("visible=true");
const panel = (page: Page) => page.getByRole("dialog", { name: t.heading });
const item = (page: Page, text: string) =>
  panel(page).getByTestId("notification-item").filter({ hasText: text });

test.describe.configure({ mode: "serial" });

test("AC1, AC2: được giao → chuông có số; đánh dấu đã đọc → số giảm; bấm tới task (sáng)", async ({
  page,
  browser,
  baseURL,
}) => {
  await page.emulateMedia({ colorScheme: "light" });
  await signInAs(page, "member");
  await expect(bell(page)).toHaveAccessibleName(t.bellLabel);
  await expect(
    page.getByTestId("notification-badge").locator("visible=true"),
  ).toHaveCount(0);

  await assignAsPm(browser, baseURL!, ["a", "b"], "member");
  await page.reload();
  await expect(bell(page)).toHaveAccessibleName(t.bellLabelUnread(2));
  await expect(
    page.getByTestId("notification-badge").locator("visible=true"),
  ).toHaveText("2");
  expect(await blockingViolations(page)).toEqual([]);

  await bell(page).click();
  await expect(panel(page)).toBeVisible();
  await expect(panel(page).getByText(t.eyebrow(2))).toBeVisible();
  const textA = t.assigned(pmName, titles.a);
  await expect(item(page, textA)).toBeVisible();
  await expect(item(page, t.assigned(pmName, titles.b))).toBeVisible();
  expect(await blockingViolations(page)).toEqual([]);

  // AC2: đánh dấu đã đọc một thông báo → số chưa đọc còn 1.
  await item(page, textA)
    .getByRole("button", { name: t.markReadOf(textA) })
    .click();
  // Khi ngăn (modal) mở, phần nền kể cả chuông bị aria-hidden: kiểm nhãn bằng thuộc tính.
  await expect(bell(page)).toHaveAttribute("aria-label", t.bellLabelUnread(1));
  await expect(panel(page).getByText(t.eyebrow(1))).toBeVisible();
  await expect(
    page.getByTestId("notification-badge").locator("visible=true"),
  ).toHaveText("1");
  // Focus chuyển về chính thông báo vừa đánh dấu.
  await expect(item(page, textA).getByRole("link")).toBeFocused();

  // Bấm thông báo còn lại → tới ngăn chi tiết task, ngăn đóng, số về 0.
  await item(page, titles.b).getByRole("link").click();
  await expect(page).toHaveURL(`/projects/${projectId}/tasks/${taskIds.b}`);
  await expect(panel(page)).toHaveCount(0);
  await expect(bell(page)).toHaveAccessibleName(t.bellLabel);

  // Bộ lọc: Chưa đọc rỗng, Tất cả còn 2 thông báo đã đọc.
  await bell(page).click();
  await expect(
    panel(page).getByRole("heading", { name: t.emptyUnreadTitle }),
  ).toBeVisible();
  await panel(page)
    .getByRole("button", { name: t.filterAll, exact: true })
    .click();
  await expect(panel(page).getByTestId("notification-item")).toHaveCount(2);
  await expect(
    panel(page).getByRole("button", { name: t.filterAll, exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
});

test("Bàn phím, đánh dấu tất cả, aria-live khi có thông báo mới", async ({
  page,
  browser,
  baseURL,
}) => {
  await signInAs(page, "member");
  await assignAsPm(browser, baseURL!, ["c"], "member");
  // Tab hiện lại → hỏi số ngay (không chờ chu kỳ 60 giây) và đọc thông báo mới qua aria-live.
  await page.evaluate(() =>
    document.dispatchEvent(new Event("visibilitychange")),
  );
  await expect(bell(page)).toHaveAccessibleName(t.bellLabelUnread(1));
  await expect(
    page.getByRole("status").filter({ hasText: t.announceNew(1) }),
  ).toHaveCount(1);

  // Mở bằng bàn phím, Esc đóng và trả focus về chuông.
  await bell(page).focus();
  await page.keyboard.press("Enter");
  await expect(panel(page)).toBeVisible();
  await expect(item(page, titles.c)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(panel(page)).toHaveCount(0);
  await expect(bell(page)).toBeFocused();

  await assignAsPm(browser, baseURL!, ["e"], "member");
  await page.keyboard.press("Enter");
  await expect(panel(page).getByTestId("notification-item")).toHaveCount(2);
  await panel(page).getByRole("button", { name: t.markAllRead }).click();
  await expect(bell(page)).toHaveAttribute("aria-label", t.bellLabel);
  await expect(panel(page).getByText(t.eyebrow(0))).toBeVisible();
  await expect(panel(page).locator("[data-unread]")).toHaveCount(0);
  await expect(
    panel(page).getByRole("button", { name: t.markAllRead }),
  ).toHaveAttribute("aria-disabled", "true");
});

test("Rỗng và lỗi tải (có Thử lại)", async ({ page }) => {
  await signInAs(page, "member2");
  await bell(page).click();
  await expect(
    panel(page).getByRole("heading", { name: t.emptyUnreadTitle }),
  ).toBeVisible();
  await panel(page)
    .getByRole("button", { name: t.filterAll, exact: true })
    .click();
  await expect(
    panel(page).getByRole("heading", { name: t.emptyAllTitle }),
  ).toBeVisible();

  await page.route("**/api/v1/notifications?*", (route) => route.abort());
  await panel(page)
    .getByRole("button", { name: t.filterUnread(0) })
    .click();
  await expect(
    panel(page).getByRole("alert").filter({ hasText: t.loadError }),
  ).toBeVisible();
  await page.unroute("**/api/v1/notifications?*");
  await panel(page).getByRole("button", { name: t.retry }).click();
  await expect(
    panel(page).getByRole("heading", { name: t.emptyUnreadTitle }),
  ).toBeVisible();
});

test("360 px: không tràn ngang, vùng bấm 44 px, axe chế độ tối", async ({
  page,
  browser,
  baseURL,
}) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.setViewportSize({ width: 360, height: 740 });
  await assignAsPm(browser, baseURL!, ["d"], "member2");
  await signInAs(page, "member2");
  await expect(bell(page)).toHaveAccessibleName(t.bellLabelUnread(1));
  const bellBox = await bell(page).boundingBox();
  expect(bellBox!.width).toBeGreaterThanOrEqual(44);
  expect(bellBox!.height).toBeGreaterThanOrEqual(44);
  expect(await blockingViolations(page)).toEqual([]);

  await bell(page).click();
  const text = t.assigned(pmName, titles.d);
  await expect(item(page, text)).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow, "Trang tràn ngang ở 360 px").toBeLessThanOrEqual(0);
  for (const target of [
    item(page, text).getByRole("button", { name: t.markReadOf(text) }),
    item(page, text).getByRole("link"),
    panel(page).getByRole("button", { name: t.filterAll, exact: true }),
    panel(page).getByRole("button", { name: strings.ui.close }),
  ]) {
    const box = await target.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
  }
  expect(await blockingViolations(page)).toEqual([]);
});
