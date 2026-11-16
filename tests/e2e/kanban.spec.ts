import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";
import { vi as strings } from "@/lib/i18n/messages/vi";

/**
 * Story E3-1 (QLDA-47): bảng Kanban (S03), Kanban trên điện thoại (S09), chế độ tối (S10).
 *
 * Dự án và tài khoản tạm tạo bằng khóa service của stack CỤC BỘ (make test-e2e đặt
 * SUPABASE_SERVICE_ROLE_KEY), mật khẩu ngẫu nhiên nên không phụ thuộc tài khoản seed; afterAll xóa
 * dự án và tài khoản. Vai trò: pm (người tạo dự án = PM), member (Thành viên), viewer (Người xem).
 *
 * Kéo thả bằng chuột chạy thật qua @dnd-kit (PointerSensor); kéo bằng bàn phím (Space + mũi tên)
 * và menu "Chuyển đến cột" cũng được kiểm. Hàm tính position có unit test riêng
 * (lib/kanban/position.test.ts); integration (tests/integration/kanban.test.ts) kiểm nhật ký.
 */
const t = strings.kanban;
const BLOCKING_IMPACTS = new Set(["critical", "serious"]);
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const tag = randomUUID().slice(0, 8);
const password = `E2e-${randomUUID()}`;
const projectName = `E2E ${tag} Kanban`;
const projectId = randomUUID();
const emptyProjectId = randomUUID();
const emails = {
  pm: `e2e-e3-1-pm-${tag}@example.com`,
  member: `e2e-e3-1-member-${tag}@example.com`,
  viewer: `e2e-e3-1-viewer-${tag}@example.com`,
};
const users: Record<string, string> = {};
/** Trạng thái mặc định theo thứ tự cột: tên và id. */
let columns: { id: string; name: string; category: string }[] = [];
const titles = {
  mine: `Việc của tôi ${tag}`,
  keyboard: `Kéo bàn phím ${tag}`,
  others: `Việc của PM ${tag}`,
  drag: `Kéo chuột ${tag}`,
  parent: `Task cha ${tag}`,
  child: `Việc con ${tag}`,
  urgent: `Sửa lỗi đăng nhập ${tag}`,
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
  const projects = await service.from("projects").insert([
    { id: projectId, name: projectName, created_by: users.pm },
    { id: emptyProjectId, name: `${projectName} trống`, created_by: users.pm },
  ]);
  if (projects.error) throw projects.error;
  const members = await service.from("project_members").insert([
    { project_id: projectId, user_id: users.member, role: "member" },
    { project_id: projectId, user_id: users.viewer, role: "viewer" },
  ]);
  if (members.error) throw members.error;
  const statuses = await service
    .from("task_statuses")
    .select("id, name, category, position")
    .eq("project_id", projectId)
    .order("position");
  if (statuses.error) throw statuses.error;
  columns = statuses.data as typeof columns;
  const first = columns[0].id;
  const insert = async (
    key: keyof typeof titles,
    row: Record<string, unknown>,
  ) => {
    const { data, error } = await service!
      .from("tasks")
      .insert({
        project_id: projectId,
        title: titles[key],
        status_id: first,
        ...row,
      })
      .select("id")
      .single();
    if (error) throw error;
    taskIds[key] = data.id as string;
  };
  await insert("mine", {
    created_by: users.pm,
    assignee_id: users.member,
    position: 1,
  });
  await insert("keyboard", { created_by: users.member, position: 2 });
  await insert("others", {
    created_by: users.pm,
    assignee_id: users.pm,
    position: 3,
  });
  await insert("drag", {
    created_by: users.pm,
    position: 4,
    due_date: "2020-01-01",
  });
  await insert("parent", { created_by: users.member, position: 5 });
  await insert("child", {
    created_by: users.member,
    parent_id: taskIds.parent,
    position: 6,
  });
  await insert("urgent", {
    created_by: users.pm,
    status_id: columns[1].id,
    priority: "urgent",
  });
});

test.afterAll(async () => {
  if (!service) return;
  await service.from("projects").delete().in("id", [projectId, emptyProjectId]);
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

const board = (page: Page) => page.getByRole("region", { name: t.boardLabel });
const column = (page: Page, name: string) =>
  board(page).getByRole("list", { name: new RegExp(`^${escape(name)}$`) });
const card = (page: Page, title: string) =>
  board(page)
    .getByRole("listitem")
    .filter({ has: page.getByRole("link", { name: title }) });
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

async function openBoard(page: Page) {
  await page.goto(`/projects/${projectId}`);
  await expect(
    page.getByRole("heading", { level: 1, name: projectName }),
  ).toBeVisible();
  await expect(card(page, titles.mine)).toBeVisible();
}

async function statusOf(id: string) {
  const { data, error } = await service!
    .from("tasks")
    .select("status_id")
    .eq("id", id)
    .single();
  if (error) throw error;
  return data.status_id as string;
}

test.describe.serial("Bảng Kanban", () => {
  test("PM: cột theo trạng thái, thẻ, lọc nhanh, tìm bỏ dấu, kéo chuột đổi cột (sáng)", async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await signInAs(page, "pm");
    await openBoard(page);

    // Thanh điều hướng con.
    const nav = page.getByRole("navigation", {
      name: strings.projectNav.navLabel,
    });
    await expect(
      nav.getByRole("link", { name: strings.projectNav.board }),
    ).toHaveAttribute("aria-current", "page");
    await expect(
      nav.getByRole("link", { name: strings.projectNav.dashboard }),
    ).toHaveAttribute("href", `/projects/${projectId}/dashboard`);
    await expect(
      nav.getByRole("link", { name: strings.projectNav.settings }),
    ).toHaveAttribute("href", `/projects/${projectId}/settings`);

    // Mỗi trạng thái một cột, đúng thứ tự position.
    const headings = board(page).getByRole("heading", { level: 2 });
    await expect(headings).toHaveCount(columns.length);
    for (const [i, c] of columns.entries()) {
      await expect(headings.nth(i)).toContainText(c.name);
    }
    // Thẻ: liên kết chi tiết task, trễ hạn, số việc con, ưu tiên.
    await expect(
      card(page, titles.mine).getByRole("link", { name: titles.mine }),
    ).toHaveAttribute("href", `/projects/${projectId}/tasks/${taskIds.mine}`);
    await expect(card(page, titles.drag)).toContainText(t.card.overdueLabel);
    await expect(card(page, titles.parent)).toContainText(
      t.card.subtasks(0, 1),
    );
    await expect(column(page, columns[1].name)).toContainText(titles.urgent);

    // Lọc nhanh theo ưu tiên.
    await page.getByLabel(t.filters.priority).selectOption("urgent");
    await expect(card(page, titles.urgent)).toBeVisible();
    await expect(card(page, titles.mine)).toHaveCount(0);
    await page.getByLabel(t.filters.priority).selectOption("");
    // Tìm không dấu khớp tiêu đề có dấu (q của E3-3).
    await page.getByLabel(t.filters.search).fill(`sua loi dang nhap ${tag}`);
    await expect(page.getByText(t.filters.resultCount(1))).toBeVisible();
    await expect(card(page, titles.urgent)).toBeVisible();
    await expect(card(page, titles.mine)).toHaveCount(0);
    await page.getByLabel(t.filters.search).fill("khong-co-gi-khop-xyz");
    await expect(
      page.getByRole("heading", { name: t.noMatchTitle }),
    ).toBeVisible();
    await page.getByRole("button", { name: t.clearFilters }).click();
    await expect(card(page, titles.mine)).toBeVisible();

    expect(await blockingViolations(page)).toEqual([]);

    // Kéo bằng chuột: thẻ "Kéo chuột" sang cột 3 (rỗng).
    const handle = page.getByRole("button", {
      name: t.card.dragHandle(titles.drag),
    });
    const target = column(page, columns[2].name);
    const from = (await handle.boundingBox())!;
    const to = (await target.boundingBox())!;
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(from.x + 20, from.y + 20, { steps: 5 });
    await page.mouse.move(to.x + to.width / 2, to.y + 30, { steps: 15 });
    await page.mouse.move(to.x + to.width / 2, to.y + 32, { steps: 2 });
    await page.mouse.up();
    await expect(target).toContainText(titles.drag);
    await expect.poll(() => statusOf(taskIds.drag)).toBe(columns[2].id);
  });

  test("Thành viên: menu Chuyển đến cột và kéo bằng bàn phím; lỗi BR-04 hoàn tác (sáng)", async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await signInAs(page, "member");
    await openBoard(page);
    await expect(page.getByText(t.memberNote)).toBeVisible();

    // Task không phụ trách, không tạo: không có tay nắm, không có menu.
    await expect(
      page.getByRole("button", { name: t.card.moveMenu(titles.others) }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: t.card.dragHandle(titles.others) }),
    ).toHaveCount(0);

    // AC2: menu bằng bàn phím.
    const menuButton = page.getByRole("button", {
      name: t.card.moveMenu(titles.mine),
    });
    await menuButton.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: t.move.title });
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: new RegExp(escape(columns[0].name)) }),
    ).toHaveAttribute("aria-current", "true");
    await dialog
      .getByRole("button", { name: columns[1].name, exact: true })
      .focus();
    await page.keyboard.press("Enter");
    await expect(dialog).toBeHidden();
    await expect(
      page.getByText(t.move.moved(titles.mine, columns[1].name)),
    ).toBeVisible();
    await expect(column(page, columns[1].name)).toContainText(titles.mine);
    await expect.poll(() => statusOf(taskIds.mine)).toBe(columns[1].id);

    // Kéo bằng bàn phím: Space nhấc, mũi tên phải sang cột kế, Space thả.
    const handle = page.getByRole("button", {
      name: t.card.dragHandle(titles.keyboard),
    });
    await handle.focus();
    await page.keyboard.press("Space");
    await page.keyboard.press("ArrowRight");
    // Chờ thẻ sang cột kế (như người dùng nghe thông báo) rồi mới thả.
    await expect(column(page, columns[1].name)).toContainText(titles.keyboard);
    await page.keyboard.press("Space");
    await expect(
      page.locator(`[data-task-id="${taskIds.keyboard}"]`),
    ).not.toHaveClass(/shadow-pop/);
    await expect.poll(() => statusOf(taskIds.keyboard)).toBe(columns[1].id);

    // BR-04: đưa task cha sang cột hoàn thành khi việc con chưa xong → báo lỗi, thẻ về chỗ cũ.
    const done = columns.find((c) => c.category === "done")!;
    await page
      .getByRole("button", { name: t.card.moveMenu(titles.parent) })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: done.name, exact: true })
      .click();
    await expect(page.getByText(t.move.openSubtasks)).toBeVisible();
    await expect(column(page, columns[0].name)).toContainText(titles.parent);
    await expect(column(page, done.name)).not.toContainText(titles.parent);
    expect(await statusOf(taskIds.parent)).toBe(columns[0].id);

    // Tải lại: thay đổi đã lưu.
    await page.reload();
    await expect(column(page, columns[1].name)).toContainText(titles.mine);
    expect(await blockingViolations(page)).toEqual([]);
  });

  test("403 từ API (quyền đổi giữa chừng) → báo lỗi và hoàn tác", async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await signInAs(page, "member");
    await openBoard(page);
    await page.route(`**/api/v1/tasks/${taskIds.keyboard}`, (route) =>
      route.request().method() === "PATCH"
        ? route.fulfill({
            status: 403,
            contentType: "application/json",
            body: JSON.stringify({
              error: { code: "forbidden", message: "x", request_id: "e2e" },
            }),
          })
        : route.continue(),
    );
    await page
      .getByRole("button", { name: t.card.moveMenu(titles.keyboard) })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: columns[0].name, exact: true })
      .click();
    await expect(page.getByText(t.move.forbidden)).toBeVisible();
    await expect(column(page, columns[1].name)).toContainText(titles.keyboard);
  });

  test("Người xem: chỉ đọc, không kéo, không menu (tối)", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await signInAs(page, "viewer");
    await openBoard(page);
    await expect(page.getByText(t.readOnlyNote)).toBeVisible();
    await expect(page.getByText(t.readOnly, { exact: true })).toBeVisible();
    await expect(
      board(page).getByRole("button", { name: /^Kéo để di chuyển/ }),
    ).toHaveCount(0);
    await expect(
      board(page).getByRole("button", { name: /^Chuyển task/ }),
    ).toHaveCount(0);
    expect(await blockingViolations(page)).toEqual([]);
  });

  test("360 px: không tràn ngang, vùng bấm 44 px, chip chọn cột, menu chạm (tối)", async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.setViewportSize({ width: 360, height: 740 });
    await signInAs(page, "pm");
    await openBoard(page);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow, "Trang tràn ngang ở 360 px").toBeLessThanOrEqual(0);

    const menuButton = page.getByRole("button", {
      name: t.card.moveMenu(titles.others),
    });
    const box = (await menuButton.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);

    // Chip chọn cột cuộn tới cột tương ứng.
    const jump = page.getByRole("navigation", { name: t.chooseColumn });
    await jump
      .getByRole("link", { name: new RegExp(escape(columns[1].name)) })
      .click();
    await expect(column(page, columns[1].name)).toBeInViewport();

    expect(await blockingViolations(page)).toEqual([]);

    // Chuyển bằng menu (chạm) ở điện thoại.
    await menuButton.click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: columns[2].name, exact: true })
      .click();
    await expect(column(page, columns[2].name)).toContainText(titles.others);
  });

  test("Trạng thái rỗng, lỗi tải có nút thử lại, dự án không thuộc về mình là 404", async ({
    page,
  }) => {
    await signInAs(page, "pm");
    await page.goto(`/projects/${emptyProjectId}`);
    await expect(
      page.getByRole("heading", { name: t.emptyTitle }),
    ).toBeVisible();
    expect(await blockingViolations(page)).toEqual([]);

    let fail = true;
    await page.route(`**/api/v1/projects/${projectId}/tasks*`, (route) =>
      fail
        ? route.fulfill({
            status: 500,
            contentType: "application/json",
            body: "{}",
          })
        : route.continue(),
    );
    await page.goto(`/projects/${projectId}`);
    await expect(
      page.getByRole("heading", { name: t.loadError }),
    ).toBeVisible();
    fail = false;
    await page.getByRole("button", { name: t.retry }).click();
    await expect(card(page, titles.mine)).toBeVisible();

    await page.goto(`/projects/${randomUUID()}`);
    await expect(page.getByRole("heading", { name: "404" })).toBeVisible();
  });
});
