import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { vi as strings } from "@/lib/i18n/messages/vi";
import { waitForHydration } from "./hydration";

/**
 * Story E8-3 (QLDA-58): cảnh báo task bị chặn (BR-06).
 *   AC1: task bị chặn hiển thị biểu tượng + chữ "Bị chặn" (thẻ Kanban), banner kèm liên kết tới
 *        task chặn (chi tiết task).
 *   AC2: chuyển task bị chặn sang cột hoàn thành (menu "Chuyển đến cột", và đổi trạng thái ở chi
 *        tiết) vẫn thành công, kèm toast cảnh báo.
 * axe sáng/tối không lỗi critical/serious.
 *
 * Dự án, tài khoản tạm tạo bằng khóa service của stack CỤC BỘ (make test-e2e), mật khẩu ngẫu
 * nhiên. Đăng nhập MỘT lần (giới hạn đăng nhập theo IP) rồi dùng lại storageState.
 */
const tb = strings.blockedTask;
const BLOCKING_IMPACTS = new Set(["critical", "serious"]);
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const tag = randomUUID().slice(0, 8);
const password = `E2e-${randomUUID()}`;
const projectName = `E2E ${tag} Bị chặn`;
const projectId = randomUUID();
const email = `e2e-e8-3-pm-${tag}@example.com`;
let userId = "";
let columns: { id: string; name: string; category: string }[] = [];
const titles = {
  blocker: `Dựng máy chủ ${tag}`,
  blocker2: `Cấp quyền mạng ${tag}`,
  blocked: `Cài ứng dụng ${tag}`,
  detail: `Kiểm thử tích hợp ${tag}`,
  free: `Viết tài liệu ${tag}`,
};
const ids: Record<keyof typeof titles, string> = {
  blocker: randomUUID(),
  blocker2: randomUUID(),
  blocked: randomUUID(),
  detail: randomUUID(),
  free: randomUUID(),
};

let service: SupabaseClient | null = null;
let storageState: Awaited<ReturnType<BrowserContext["storageState"]>>;

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

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  service = serviceClient();
  const { data, error } = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: `E2E pm ${tag}` },
  });
  if (error) throw error;
  userId = data.user.id;
  const project = await service
    .from("projects")
    .insert({ id: projectId, name: projectName, created_by: userId });
  if (project.error) throw project.error;
  const statuses = await service
    .from("task_statuses")
    .select("id, name, category, position")
    .eq("project_id", projectId)
    .order("position");
  if (statuses.error) throw statuses.error;
  columns = statuses.data as typeof columns;
  const todo = columns.find((c) => c.category === "todo")!;
  const tasks = await service.from("tasks").insert(
    (Object.keys(titles) as (keyof typeof titles)[]).map((k, i) => ({
      id: ids[k],
      project_id: projectId,
      title: titles[k],
      status_id: todo.id,
      created_by: userId,
      position: i + 1,
    })),
  );
  if (tasks.error) throw tasks.error;
  const rels = await service.from("task_relations").insert([
    { from_task_id: ids.blocker, to_task_id: ids.blocked, kind: "blocks" },
    { from_task_id: ids.blocker, to_task_id: ids.detail, kind: "blocks" },
    { from_task_id: ids.blocker2, to_task_id: ids.detail, kind: "blocks" },
    // precedes không chặn.
    { from_task_id: ids.blocker2, to_task_id: ids.free, kind: "precedes" },
  ]);
  if (rels.error) throw rels.error;

  // Đăng nhập một lần, giữ cookie cho mọi test.
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/login");
  await waitForHydration(page);
  await page.getByLabel(strings.login.emailLabel).fill(email);
  await page.getByLabel(strings.login.passwordLabel).fill(password);
  await page
    .getByRole("button", { name: strings.login.submit, exact: true })
    .click();
  await expect(page).toHaveURL("/");
  storageState = await context.storageState();
  await context.close();
});

test.afterAll(async () => {
  if (!service) return;
  await service.from("projects").delete().eq("id", projectId);
  if (userId) await service.auth.admin.deleteUser(userId);
});

test.use({ storageState: async ({}, provide) => provide(storageState) });

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

const board = (page: Page) =>
  page.getByRole("region", { name: strings.kanban.boardLabel });
const card = (page: Page, title: string) =>
  board(page)
    .getByRole("listitem")
    .filter({ has: page.getByRole("link", { name: title, exact: true }) });
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const column = (page: Page, name: string) =>
  board(page).getByRole("list", { name: new RegExp(`^${escape(name)}$`) });

async function completedAt(id: string) {
  const { data, error } = await service!
    .from("tasks")
    .select("completed_at")
    .eq("id", id)
    .single();
  if (error) throw error;
  return data.completed_at as string | null;
}

test.describe.serial("Cảnh báo task bị chặn", () => {
  test("Kanban: thẻ bị chặn có biểu tượng + chữ; chuyển sang cột hoàn thành vẫn được kèm cảnh báo (sáng, tối)", async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto(`/projects/${projectId}`);
    await expect(card(page, titles.blocked)).toBeVisible();

    // AC1: chữ "Bị chặn" (không chỉ màu) trên thẻ bị chặn; thẻ khác không có.
    await expect(
      card(page, titles.blocked).getByTestId("blocked-badge"),
    ).toContainText(tb.badge);
    await expect(
      card(page, titles.blocked).getByTestId("blocked-badge"),
    ).toHaveAttribute("title", tb.badgeTitle(1));
    await expect(
      card(page, titles.detail).getByTestId("blocked-badge"),
    ).toHaveAttribute("title", tb.badgeTitle(2));
    await expect(
      card(page, titles.free).getByTestId("blocked-badge"),
    ).toHaveCount(0);
    await expect(
      card(page, titles.blocker).getByTestId("blocked-badge"),
    ).toHaveCount(0);
    expect(await blockingViolations(page)).toEqual([]);

    await page.emulateMedia({ colorScheme: "dark" });
    expect(await blockingViolations(page)).toEqual([]);
    await page.emulateMedia({ colorScheme: "light" });

    // AC2: menu "Chuyển đến cột" → cột hoàn thành: thành công + toast cảnh báo nêu task chặn.
    const done = columns.find((c) => c.category === "done")!;
    await page
      .getByRole("button", {
        name: strings.kanban.card.moveMenu(titles.blocked),
      })
      .click();
    await page
      .getByRole("dialog", { name: strings.kanban.move.title })
      .getByRole("button", { name: done.name, exact: true })
      .click();
    const toast = page.getByRole("status").filter({
      hasText: tb.toastTitle(titles.blocked),
    });
    await expect(toast).toBeVisible();
    await expect(toast).toContainText(titles.blocker);
    await expect(column(page, done.name)).toContainText(titles.blocked);
    await expect.poll(() => completedAt(ids.blocked)).not.toBeNull();
    // Task đã xong không còn hiện "Bị chặn".
    await expect(
      card(page, titles.blocked).getByTestId("blocked-badge"),
    ).toHaveCount(0);

    // Hoàn thành task chặn: task phụ thuộc (chỉ bị nó chặn) hết "Bị chặn" mà không tải lại.
    await page
      .getByRole("button", {
        name: strings.kanban.card.moveMenu(titles.blocker),
      })
      .click();
    await page
      .getByRole("dialog", { name: strings.kanban.move.title })
      .getByRole("button", { name: done.name, exact: true })
      .click();
    await expect(
      page.getByText(strings.kanban.move.moved(titles.blocker, done.name)),
    ).toBeVisible();
    await expect(
      card(page, titles.detail).getByTestId("blocked-badge"),
    ).toHaveAttribute("title", tb.badgeTitle(1));
  });

  test("Chi tiết task: banner liên kết task chặn; đổi trạng thái sang hoàn thành vẫn lưu kèm cảnh báo (sáng, tối)", async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto(`/projects/${projectId}/tasks/${ids.detail}`);
    const panel = page.getByRole("complementary", {
      name: strings.taskDetail.panelLabel,
    });
    await expect(panel.locator('[data-field="label_ids"]')).toBeVisible();

    // AC1: banner có tiêu đề chữ và liên kết tới task chặn còn mở (blocker đã xong ở test trước).
    const banner = panel.getByTestId("blocked-banner");
    await expect(banner).toBeVisible();
    await expect(
      banner.getByRole("heading", { name: tb.bannerTitle }),
    ).toBeVisible();
    const list = banner.getByRole("list", { name: tb.listLabel });
    await expect(list.getByRole("link")).toHaveCount(1);
    await expect(
      list.getByRole("link", { name: titles.blocker2, exact: true }),
    ).toHaveAttribute("href", `/projects/${projectId}/tasks/${ids.blocker2}`);
    expect(await blockingViolations(page)).toEqual([]);
    await page.emulateMedia({ colorScheme: "dark" });
    expect(await blockingViolations(page)).toEqual([]);
    await page.emulateMedia({ colorScheme: "light" });

    // AC2: đổi trạng thái sang nhóm hoàn thành: lưu được, toast cảnh báo, banner ẩn.
    const done = columns.find((c) => c.category === "done")!;
    await panel
      .getByLabel(strings.taskDetail.fields.status_id)
      .selectOption(done.id);
    const toast = page.getByRole("status").filter({
      hasText: tb.toastTitle(titles.detail),
    });
    await expect(toast).toBeVisible();
    await expect(toast).toContainText(titles.blocker2);
    await expect(panel.getByTestId("task-save-status")).toContainText(
      strings.taskDetail.save.saved(strings.taskDetail.fields.status_id),
    );
    await expect.poll(() => completedAt(ids.detail)).not.toBeNull();
    await expect(banner).toHaveCount(0);

    // Liên kết banner dẫn tới task chặn (mở lại task cho banner hiện lại).
    await panel
      .getByLabel(strings.taskDetail.fields.status_id)
      .selectOption(columns.find((c) => c.category === "todo")!.id);
    await expect(banner).toBeVisible();
    await list
      .getByRole("link", { name: titles.blocker2, exact: true })
      .click();
    await expect(page).toHaveURL(
      `/projects/${projectId}/tasks/${ids.blocker2}`,
    );
  });

  test("360 px: thẻ và banner không tràn ngang, liên kết banner đủ 44 px (tối)", async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.setViewportSize({ width: 360, height: 780 });
    const noOverflow = () =>
      page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      );

    // Task chi tiết đã mở lại ở test trước: vẫn bị blocker2 chặn.
    await page.goto(`/projects/${projectId}/tasks/${ids.detail}`);
    const banner = page.getByTestId("blocked-banner");
    await expect(banner).toBeVisible();
    expect(await noOverflow()).toBe(true);
    const link = banner.getByRole("link", {
      name: titles.blocker2,
      exact: true,
    });
    const box = await link.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    expect(await blockingViolations(page)).toEqual([]);

    await page.goto(`/projects/${projectId}`);
    await expect(
      card(page, titles.detail).getByTestId("blocked-badge"),
    ).toBeVisible();
    expect(await noOverflow()).toBe(true);
  });
});
