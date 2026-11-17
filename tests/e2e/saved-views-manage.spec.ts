import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { vi as strings } from "@/lib/i18n/messages/vi";

/**
 * Story E13-3 (QLDA-63): lưu, đổi tên, lưu thay đổi, công khai, xóa chế độ xem trên bảng phân cấp.
 *
 * Dự án và tài khoản tạm tạo bằng khóa service của stack CỤC BỘ (make test-e2e đặt
 * SUPABASE_SERVICE_ROLE_KEY), mật khẩu ngẫu nhiên; afterAll xóa. Vai trò: pm (người tạo dự án),
 * member (Thành viên), viewer (Người xem). Mỗi vai trò đăng nhập MỘT lần cho cả tệp. Quyền API từng
 * vai trò có test tích hợp (tests/integration/saved-views.test.ts); ở đây kiểm giao diện và một lần
 * API 403 bằng phiên của Thành viên (AC2).
 */
const t = strings.savedViewsMenu;
const m = strings.savedViewsManage;
const tl = strings.taskList;
const errors = strings.savedViews.errors;
const BLOCKING_IMPACTS = new Set(["critical", "serious"]);
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const tag = randomUUID().slice(0, 8);
const password = `E2e-${randomUUID()}`;
const projectName = `E2E ${tag} Quản lý chế độ xem`;
const projectId = randomUUID();
const emails = {
  pm: `e2e-e13-3-pm-${tag}@example.com`,
  member: `e2e-e13-3-member-${tag}@example.com`,
  viewer: `e2e-e13-3-viewer-${tag}@example.com`,
};
const users: Record<string, string> = {};
const titles = {
  high: `Ưu tiên cao ${tag}`,
  low: `Ưu tiên thấp ${tag}`,
};
const names = {
  pmFirst: `Việc gấp ${tag}`,
  pmRenamed: `Việc gấp của PM ${tag}`,
  member: `Thành viên ${tag}`,
  viewer: `Người xem ${tag}`,
};
let service: SupabaseClient | null = null;
/** id chế độ xem công khai PM tạo ở test đầu (các test sau dùng tiếp, chạy tuần tự). */
let pmViewId = "";

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
  const project = await service
    .from("projects")
    .insert({ id: projectId, name: projectName, created_by: users.pm });
  if (project.error) throw project.error;
  const member = await service.from("project_members").insert([
    { project_id: projectId, user_id: users.member, role: "member" },
    { project_id: projectId, user_id: users.viewer, role: "viewer" },
  ]);
  if (member.error) throw member.error;
  const tasks = await service.from("tasks").insert([
    {
      project_id: projectId,
      title: titles.high,
      created_by: users.pm,
      priority: "high",
    },
    {
      project_id: projectId,
      title: titles.low,
      created_by: users.pm,
      priority: "low",
    },
  ]);
  if (tasks.error) throw tasks.error;
});

test.afterAll(async () => {
  if (!service) return;
  await service.from("projects").delete().eq("id", projectId);
  for (const id of Object.values(users))
    await service.auth.admin.deleteUser(id);
});

type Cookies = Awaited<ReturnType<BrowserContext["cookies"]>>;
const sessions: Partial<Record<keyof typeof emails, Cookies>> = {};

async function signInAs(page: Page, who: keyof typeof emails) {
  const saved = sessions[who];
  // Đổi vai trò trong cùng trang: bỏ cookie phiên cũ (Supabase chia cookie thành nhiều mảnh).
  await page.context().clearCookies();
  if (saved) {
    await page.context().addCookies(saved);
    return;
  }
  await page.goto("/login");
  await page.getByLabel(strings.login.emailLabel).fill(emails[who]);
  await page.getByLabel(strings.login.passwordLabel).fill(password);
  await page
    .getByRole("button", { name: strings.login.submit, exact: true })
    .click();
  await expect(page).toHaveURL("/");
  sessions[who] = await page.context().cookies();
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

const menu = (page: Page) =>
  page.getByRole("complementary", { name: t.regionLabel });
const section = (page: Page, name: string) =>
  menu(page).getByRole("region", { name });
const viewButton = (page: Page, name: string) =>
  menu(page).getByRole("button", { name, exact: true });
const actions = (page: Page) =>
  page.getByRole("group", { name: m.actionsLabel });
const action = (page: Page, name: string) =>
  actions(page).getByRole("button", { name, exact: true });
const currentName = (page: Page) => page.getByTestId("current-view-name");
const dialog = (page: Page) => page.getByRole("dialog");
const table = (page: Page) => page.getByRole("table", { name: tl.tableLabel });
async function visibleTitles(page: Page) {
  return table(page)
    .locator('[data-testid="task-list-row"] a')
    .evaluateAll((els) =>
      els.map((e) => e.querySelector("span")?.textContent ?? ""),
    );
}

async function openList(page: Page, query = "") {
  await page.goto(`/projects/${projectId}/list${query}`);
  await expect(
    page.getByRole("heading", { level: 1, name: new RegExp(projectName) }),
  ).toBeVisible();
}

/** Mở hộp thoại "Lưu thành chế độ xem mới", nhập tên, (tùy) chọn công khai, Lưu. */
async function saveNew(page: Page, name: string, visibility?: "public") {
  await action(page, m.saveNew).click();
  await expect(dialog(page)).toBeVisible();
  await dialog(page).getByLabel(m.dialog.name).fill(name);
  if (visibility === "public") {
    await dialog(page).getByRole("radio", { name: m.dialog.public }).check();
  }
  await dialog(page)
    .getByRole("button", { name: m.dialog.save, exact: true })
    .click();
}

test.describe.serial("Quản lý chế độ xem (E13-3)", () => {
  test("PM: lưu từ bộ lọc, trùng tên 409, đổi tên, lưu thay đổi, công khai (sáng)", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.emulateMedia({ colorScheme: "light" });
    await signInAs(page, "pm");
    await openList(page);
    await expect.poll(async () => (await visibleTitles(page)).length).toBe(2);

    // Bộ lọc ưu tiên cao → lưu thành chế độ xem riêng.
    await page
      .getByRole("combobox", { name: tl.filters.priority })
      .selectOption("high");
    await expect.poll(() => visibleTitles(page)).toEqual([titles.high]);
    await action(page, m.saveNew).click();
    // PM chọn được công khai; mặc định riêng tư.
    await expect(
      dialog(page).getByRole("radio", { name: m.dialog.private }),
    ).toBeChecked();
    expect(await blockingViolations(page)).toEqual([]);
    // Tên rỗng: báo ngay, không gửi.
    await dialog(page).getByLabel(m.dialog.name).fill("   ");
    await dialog(page)
      .getByRole("button", { name: m.dialog.save, exact: true })
      .click();
    await expect(dialog(page).getByText(m.dialog.nameRequired)).toBeVisible();
    await dialog(page).getByLabel(m.dialog.name).fill(names.pmFirst);
    await dialog(page)
      .getByRole("button", { name: m.dialog.save, exact: true })
      .click();
    await expect(dialog(page)).toHaveCount(0);
    await expect(currentName(page)).toHaveText(names.pmFirst);
    await expect(page).toHaveURL(/\?view=[0-9a-f-]{36}$/);
    pmViewId = new URL(page.url()).searchParams.get("view")!;
    await expect(
      section(page, t.sections.mine).getByRole("button", {
        name: names.pmFirst,
        exact: true,
      }),
    ).toBeVisible();

    // Trùng tên (không phân biệt hoa thường): 409 hiện dưới ô tên, hộp thoại vẫn mở.
    await saveNew(page, names.pmFirst.toUpperCase());
    await expect(dialog(page).getByText(errors.nameExists)).toBeVisible();
    await dialog(page).getByRole("button", { name: strings.ui.cancel }).click();
    await expect(dialog(page)).toHaveCount(0);

    // Đổi tên.
    await action(page, m.rename).click();
    await expect(dialog(page).getByLabel(m.dialog.name)).toHaveValue(
      names.pmFirst,
    );
    await dialog(page).getByLabel(m.dialog.name).fill(names.pmRenamed);
    await dialog(page)
      .getByRole("button", { name: m.dialog.save, exact: true })
      .click();
    await expect(currentName(page)).toHaveText(names.pmRenamed);
    await expect(viewButton(page, names.pmRenamed)).toBeVisible();

    // Đổi nhóm → "Lưu thay đổi" → hết báo đã đổi; tải lại vẫn giữ nhóm.
    await expect(action(page, m.saveChanges)).toHaveCount(0);
    await page
      .getByRole("combobox", { name: tl.toolbar.groupBy })
      .selectOption("priority");
    await expect(page.getByText(t.modified)).toBeVisible();
    await action(page, m.saveChanges).click();
    await expect(page.getByText(t.modified)).toHaveCount(0);
    await openList(page, `?view=${pmViewId}`);
    await expect(currentName(page)).toHaveText(names.pmRenamed);
    await expect(
      page.getByRole("combobox", { name: tl.toolbar.groupBy }),
    ).toHaveValue("priority");
    await expect.poll(() => visibleTitles(page)).toEqual([titles.high]);

    // Công khai → chuyển sang mục Công khai; PM là chủ nên có "Chuyển về riêng tư".
    await action(page, m.publish).click();
    await expect(
      section(page, t.sections.shared).getByRole("button", {
        name: names.pmRenamed,
        exact: true,
      }),
    ).toBeVisible();
    await expect(action(page, m.privatize)).toBeVisible();
    await expect(page.getByText(t.publicNote)).toBeVisible();

    // Chế độ xem mặc định: chỉ đọc, chỉ còn "Lưu thành chế độ xem mới" kèm giải thích.
    await viewButton(page, t.names.overdue).click();
    await expect(currentName(page)).toHaveText(t.names.overdue);
    await expect(page.getByTestId("view-read-only-reason")).toHaveText(
      m.readOnly.default,
    );
    await expect(actions(page).getByRole("button")).toHaveText([m.saveNew]);
    expect(await blockingViolations(page)).toEqual([]);
  });

  test("Thành viên: thấy chế độ xem công khai của PM, không sửa được (giao diện và API 403), chỉ lưu riêng tư (tối)", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.emulateMedia({ colorScheme: "dark" });
    await signInAs(page, "member");
    await openList(page);

    // AC1: người khác trong dự án thấy chế độ xem PM vừa công khai.
    await section(page, t.sections.shared)
      .getByRole("button", { name: names.pmRenamed, exact: true })
      .click();
    await expect(currentName(page)).toHaveText(names.pmRenamed);
    await expect.poll(() => visibleTitles(page)).toEqual([titles.high]);

    // AC2 (giao diện): chỉ đọc, không có Đổi tên, Xóa, Lưu thay đổi; giải thích lý do.
    await expect(page.getByText(t.readOnly, { exact: true })).toBeVisible();
    await expect(page.getByTestId("view-read-only-reason")).toHaveText(
      m.readOnly.public,
    );
    await expect(actions(page).getByRole("button")).toHaveText([m.saveNew]);
    await page
      .getByRole("combobox", { name: tl.toolbar.groupBy })
      .selectOption("");
    await expect(page.getByText(t.modified)).toBeVisible();
    await expect(action(page, m.saveChanges)).toHaveCount(0);

    // AC2 (API): gọi thẳng bằng phiên của Thành viên vẫn bị 403 kèm lý do.
    const origin = new URL(page.url()).origin;
    const res = await page.request.patch(`/api/v1/views/${pmViewId}`, {
      headers: { origin, "content-type": "application/json" },
      data: { name: "Thành viên đổi tên" },
    });
    expect(res.status()).toBe(403);
    expect((await res.json()).error.message).toBe(errors.publicForbidden);
    const del = await page.request.delete(`/api/v1/views/${pmViewId}`, {
      headers: { origin },
    });
    expect(del.status()).toBe(403);

    // Lưu thành chế độ xem mới: chỉ riêng tư (không có lựa chọn công khai), tên gợi ý "(bản sao)".
    await action(page, m.saveNew).click();
    await expect(dialog(page).getByLabel(m.dialog.name)).toHaveValue(
      `${names.pmRenamed} ${m.dialog.copySuffix}`,
    );
    await expect(dialog(page).getByRole("radio")).toHaveCount(0);
    await expect(dialog(page).getByText(m.dialog.privateOnly)).toBeVisible();
    expect(await blockingViolations(page)).toEqual([]);
    await dialog(page).getByLabel(m.dialog.name).fill(names.member);
    await dialog(page)
      .getByRole("button", { name: m.dialog.save, exact: true })
      .click();
    await expect(currentName(page)).toHaveText(names.member);
    // Chế độ xem riêng của mình: sửa được nhưng không công khai được.
    await expect(action(page, m.rename)).toBeVisible();
    await expect(action(page, m.publish)).toHaveCount(0);
    expect(await blockingViolations(page)).toEqual([]);
  });

  test("Người xem: tạo, xóa chế độ xem riêng; xóa khi đang xem thì về cách xem thường", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.emulateMedia({ colorScheme: "light" });
    await signInAs(page, "viewer");
    await openList(page);
    // Không thấy chế độ xem riêng của Thành viên.
    await expect(viewButton(page, names.member)).toHaveCount(0);

    await page
      .getByRole("combobox", { name: tl.filters.priority })
      .selectOption("low");
    await saveNew(page, names.viewer);
    await expect(currentName(page)).toHaveText(names.viewer);
    await expect.poll(() => visibleTitles(page)).toEqual([titles.low]);
    await expect(action(page, m.publish)).toHaveCount(0);

    await action(page, m.delete).click();
    const confirm = page.getByRole("alertdialog");
    await expect(confirm).toContainText(m.deleteTitle(names.viewer));
    expect(await blockingViolations(page)).toEqual([]);
    await confirm.getByRole("button", { name: m.deleteConfirm }).click();
    await expect(confirm).toHaveCount(0);
    await expect(currentName(page)).toHaveCount(0);
    await expect(page).toHaveURL(`/projects/${projectId}/list`);
    await expect(viewButton(page, names.viewer)).toHaveCount(0);
    await expect.poll(async () => (await visibleTitles(page)).length).toBe(2);
  });

  test("360 px: nút quản lý 44 px, hộp thoại không tràn ngang (sáng, tối); PM xóa chế độ xem công khai", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    await signInAs(page, "pm");
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await openList(page, `?view=${pmViewId}`);
      await expect(currentName(page)).toHaveText(names.pmRenamed);
      for (const name of [m.saveNew, m.rename, m.privatize, m.delete]) {
        const box = await action(page, name).boundingBox();
        expect(box!.height, name).toBeGreaterThanOrEqual(44);
      }
      const overflow = () =>
        page.evaluate(
          () => document.documentElement.scrollWidth - window.innerWidth,
        );
      expect(await overflow()).toBeLessThanOrEqual(0);
      expect(await blockingViolations(page)).toEqual([]);

      await action(page, m.rename).click();
      await expect(dialog(page)).toBeVisible();
      const dialogBox = await dialog(page).boundingBox();
      expect(dialogBox!.width).toBeLessThanOrEqual(360);
      expect(await overflow()).toBeLessThanOrEqual(0);
      expect(await blockingViolations(page)).toEqual([]);
      await dialog(page)
        .getByRole("button", { name: strings.ui.cancel })
        .click();
    }

    // Xóa chế độ xem công khai đang xem: về cách xem thường; người khác mở link thì báo trung tính.
    await action(page, m.delete).click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: m.deleteConfirm })
      .click();
    await expect(currentName(page)).toHaveCount(0);
    await expect(page).toHaveURL(`/projects/${projectId}/list`);
    await signInAs(page, "member");
    await openList(page, `?view=${pmViewId}`);
    await expect(page.getByText(t.missing)).toBeVisible();
    await expect(currentName(page)).toHaveCount(0);
  });
});
