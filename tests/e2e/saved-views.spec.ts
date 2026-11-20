import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { type SupabaseClient } from "@supabase/supabase-js";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { vi as strings } from "@/lib/i18n/messages/vi";
import { DEFAULT_VIEWS, type DefaultViewKey } from "@/lib/saved-views/defaults";
import { cleanupTempData, createTempUsers, serviceClient } from "./temp-data";
import { signInWithPassword } from "./login";

/**
 * Story E13-2 (QLDA-54): menu chế độ xem S12 trên bảng phân cấp, 7 chế độ xem mặc định.
 *
 * Dự án và tài khoản tạm tạo bằng khóa service của stack CỤC BỘ (make test-e2e đặt
 * SUPABASE_SERVICE_ROLE_KEY), mật khẩu ngẫu nhiên; afterAll xóa. Vai trò: pm (người tạo dự án),
 * viewer (Người xem). Ngữ nghĩa từng chế độ xem có test tích hợp riêng
 * (tests/integration/default-saved-views.test.ts); ở đây kiểm giao diện: chọn, áp dụng, link
 * ?view=, yêu thích, Người xem, link hỏng, 360 px, axe sáng/tối.
 */
const t = strings.savedViewsMenu;
const tl = strings.taskList;
const BLOCKING_IMPACTS = new Set(["critical", "serious"]);
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const tag = randomUUID().slice(0, 8);
const password = `E2e-${randomUUID()}`;
const projectName = `E2E ${tag} Chế độ xem`;
const projectId = randomUUID();
const emails = {
  pm: `e2e-e13-2-pm-${tag}@example.com`,
  viewer: `e2e-e13-2-viewer-${tag}@example.com`,
};
const users: Record<string, string> = {};
const titles = {
  mineOverdue: `Của PM quá hạn ${tag}`,
  done: `Đã xong ${tag}`,
  byViewer: `Người xem tạo ${tag}`,
};
let service: SupabaseClient | null = null;

const viewId = (key: DefaultViewKey) =>
  DEFAULT_VIEWS.find((d) => d.key === key)!.id;

test.beforeAll(async () => {
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
  const project = await service
    .from("projects")
    .insert({ id: projectId, name: projectName, created_by: users.pm });
  if (project.error) throw project.error;
  const member = await service
    .from("project_members")
    .insert({ project_id: projectId, user_id: users.viewer, role: "viewer" });
  if (member.error) throw member.error;
  const st = await service
    .from("task_statuses")
    .select("id, category, position")
    .eq("project_id", projectId)
    .order("position");
  if (st.error) throw st.error;
  const todo = st.data.find((s) => s.category === "todo")!.id;
  const done = st.data.find((s) => s.category === "done")!.id;
  const tasks = await service.from("tasks").insert([
    {
      project_id: projectId,
      title: titles.mineOverdue,
      created_by: users.pm,
      assignee_id: users.pm,
      due_date: "2020-01-01",
      status_id: todo,
    },
    {
      project_id: projectId,
      title: titles.done,
      created_by: users.pm,
      assignee_id: users.pm,
      due_date: "2020-01-01",
      status_id: done,
    },
    {
      project_id: projectId,
      title: titles.byViewer,
      created_by: users.viewer,
      status_id: todo,
    },
  ]);
  if (tasks.error) throw tasks.error;
});

test.afterAll(async () => {
  await cleanupTempData(service, {
    projectIds: [projectId],
    userIds: Object.values(users),
  });
});

type Cookies = Awaited<ReturnType<BrowserContext["cookies"]>>;
/** Mỗi vai trò chỉ đăng nhập MỘT lần cho cả tệp (giới hạn loginIp dùng chung cho mọi spec). */
const sessions: Partial<Record<keyof typeof emails, Cookies>> = {};

async function signInAs(page: Page, who: keyof typeof emails) {
  const saved = sessions[who];
  if (saved) {
    await page.context().addCookies(saved);
    return;
  }
  await signInWithPassword(page, emails[who], password);
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
  // Chọn chế độ xem đổi ?view= bằng điều hướng phía client: trong lúc Next.js nạp lại metadata,
  // <title> tạm rỗng và axe báo "document-title" (chập chờn trên CI, QLDA-56). Chờ có tiêu đề.
  await expect(page).toHaveTitle(/\S/);
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
const table = (page: Page) => page.getByRole("table", { name: tl.tableLabel });
async function visibleTitles(page: Page) {
  return table(page)
    .locator('[data-testid="task-list-row"] a')
    .evaluateAll((els) =>
      els.map((e) => e.querySelector("span")?.textContent ?? ""),
    );
}
const currentName = (page: Page) => page.getByTestId("current-view-name");

async function openList(page: Page, query = "") {
  await page.goto(`/projects/${projectId}/list${query}`);
  await expect(
    page.getByRole("heading", { level: 1, name: new RegExp(projectName) }),
  ).toBeVisible();
}

test.describe.serial("Chế độ xem đã lưu (S12)", () => {
  test("PM: 7 mặc định theo thứ tự, chọn áp dụng bộ lọc, ?view= giữ khi tải lại, yêu thích (sáng)", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.emulateMedia({ colorScheme: "light" });
    await signInAs(page, "pm");
    await openList(page);

    const defaults = section(page, t.sections.defaults);
    await expect(defaults.getByRole("listitem")).toHaveCount(7);
    // Nút chọn (không phải nút sao aria-pressed) theo đúng thứ tự OpenProject.
    await expect(defaults.locator("button:not([aria-pressed])")).toHaveText(
      DEFAULT_VIEWS.map((d) => t.names[d.key]),
    );

    // Giao cho tôi: chỉ task chưa xong giao cho PM.
    await viewButton(page, t.names.assignedToMe).click();
    await expect(page).toHaveURL(
      `/projects/${projectId}/list?view=${viewId("assignedToMe")}`,
    );
    await expect(currentName(page)).toHaveText(t.names.assignedToMe);
    await expect(viewButton(page, t.names.assignedToMe)).toHaveAttribute(
      "aria-current",
      "true",
    );
    await expect.poll(() => visibleTitles(page)).toEqual([titles.mineOverdue]);
    await expect(page.getByText(t.defaultNote)).toBeVisible();
    await expect(
      page.getByRole("list", { name: t.chips.label }).getByText(t.chips.open),
    ).toBeVisible();
    await expect(
      page.getByRole("combobox", { name: tl.filters.assignee }),
    ).toHaveValue("me");

    // Đổi bộ lọc → báo đã đổi, Đặt lại về chế độ xem.
    await page
      .getByRole("button", { name: t.chips.remove(t.chips.open) })
      .click();
    await expect(page.getByText(t.modified)).toBeVisible();
    await expect
      .poll(() => visibleTitles(page))
      .toEqual(expect.arrayContaining([titles.mineOverdue, titles.done]));
    await page.getByRole("button", { name: t.reset }).click();
    await expect(page.getByText(t.modified)).toHaveCount(0);
    await expect.poll(() => visibleTitles(page)).toEqual([titles.mineOverdue]);

    // Tạo bởi tôi (PM): task PM tạo, chưa xong.
    await viewButton(page, t.names.createdByMe).click();
    await expect(currentName(page)).toHaveText(t.names.createdByMe);
    await expect.poll(() => visibleTitles(page)).toEqual([titles.mineOverdue]);

    // Tóm tắt: nhóm theo trạng thái, đủ 3 task.
    await viewButton(page, t.names.summary).click();
    await expect(
      page.getByRole("combobox", { name: tl.toolbar.groupBy }),
    ).toHaveValue("status_id");
    await expect.poll(async () => (await visibleTitles(page)).length).toBe(3);

    // Yêu thích "Quá hạn" → hiện ở mục Yêu thích; giữ sau khi tải lại.
    const star = menu(page)
      .getByRole("button", { name: t.favoriteAdd(t.names.overdue) })
      .first();
    // Giao diện cập nhật lạc quan: chờ PATCH lưu xong rồi mới tải lại, nếu không (máy bận) điều
    // hướng sẽ đến trước khi yêu thích được ghi.
    const saved = page.waitForResponse(
      (r) =>
        r.request().method() === "PATCH" && r.url().includes("/api/v1/views/"),
    );
    await star.click();
    expect((await saved).ok()).toBe(true);
    const favorites = section(page, t.sections.favorites);
    await expect(
      favorites.getByRole("button", { name: t.names.overdue, exact: true }),
    ).toBeVisible();

    // Mở link ?view= (Quá hạn) trực tiếp: áp dụng ngay sau khi tải.
    await openList(page, `?view=${viewId("overdue")}`);
    await expect(currentName(page)).toHaveText(t.names.overdue);
    await expect.poll(() => visibleTitles(page)).toEqual([titles.mineOverdue]);
    await expect(
      section(page, t.sections.favorites).getByRole("button", {
        name: t.names.overdue,
        exact: true,
      }),
    ).toBeVisible();
    // Bỏ yêu thích (dọn trạng thái).
    await menu(page)
      .getByRole("button", { name: t.favoriteRemove(t.names.overdue) })
      .first()
      .click();
    await expect(section(page, t.sections.favorites)).toHaveCount(0);

    expect(await blockingViolations(page)).toEqual([]);
  });

  test("Người xem: dùng chế độ xem (chỉ đọc), 'me' là chính họ (tối)", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.emulateMedia({ colorScheme: "dark" });
    await signInAs(page, "viewer");
    await openList(page, `?view=${viewId("createdByMe")}`);
    await expect(currentName(page)).toHaveText(t.names.createdByMe);
    await expect.poll(() => visibleTitles(page)).toEqual([titles.byViewer]);
    await expect(
      page.getByText(t.readOnly, { exact: true }).first(),
    ).toBeVisible();

    // Giao cho tôi: Người xem không có task nào → trạng thái không khớp.
    await viewButton(page, t.names.assignedToMe).click();
    await expect(
      page.getByRole("heading", { name: tl.noMatchTitle }),
    ).toBeVisible();

    // Người xem cũng đánh dấu yêu thích được.
    await menu(page)
      .getByRole("button", { name: t.favoriteAdd(t.names.allOpen) })
      .first()
      .click();
    await expect(
      section(page, t.sections.favorites).getByRole("button", {
        name: t.names.allOpen,
        exact: true,
      }),
    ).toBeVisible();

    expect(await blockingViolations(page)).toEqual([]);
  });

  test("Link chế độ xem không đọc được: thông báo trung tính, bảng vẫn dùng được", async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await signInAs(page, "pm");
    await openList(page, `?view=${randomUUID()}`);
    await expect(page.getByText(t.missing)).toBeVisible();
    await expect(currentName(page)).toHaveCount(0);
    await expect.poll(async () => (await visibleTitles(page)).length).toBe(3);
    await page.getByRole("button", { name: t.dismiss }).click();
    await expect(page.getByText(t.missing)).toHaveCount(0);

    await openList(page, "?view=khong-phai-uuid");
    await expect(page.getByText(t.missing)).toBeVisible();
  });

  test("360 px: menu gom sau nút, vùng bấm 44 px, không tràn ngang (sáng, tối)", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    await signInAs(page, "pm");
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await openList(page);
      const toggle = menu(page).getByRole("button", {
        name: t.toggle(t.noneSelected),
      });
      await expect(toggle).toHaveAttribute("aria-expanded", "false");
      await expect(viewButton(page, t.names.overdue)).toBeHidden();
      await toggle.click();
      await expect(toggle).toHaveAttribute("aria-expanded", "true");

      const item = viewButton(page, t.names.overdue);
      const box = await item.boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(44);
      const starBox = await menu(page)
        .getByRole("button", { name: t.favoriteAdd(t.names.overdue) })
        .first()
        .boundingBox();
      expect(starBox!.width).toBeGreaterThanOrEqual(44);
      expect(starBox!.height).toBeGreaterThanOrEqual(44);

      await item.click();
      await expect(currentName(page)).toHaveText(t.names.overdue);
      // Chọn xong menu tự gom lại, nút hiện tên chế độ xem.
      await expect(
        menu(page).getByRole("button", { name: t.toggle(t.names.overdue) }),
      ).toHaveAttribute("aria-expanded", "false");
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
      expect(await blockingViolations(page)).toEqual([]);
    }
  });
});
