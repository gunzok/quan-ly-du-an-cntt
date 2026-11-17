import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { type SupabaseClient } from "@supabase/supabase-js";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { vi as strings } from "@/lib/i18n/messages/vi";
import { cleanupTempData, createTempUsers, serviceClient } from "./temp-data";
import { signInWithPassword } from "./login";

/**
 * Story E3-2 (QLDA-51): bảng phân cấp thu gọn, nhóm, chọn cột (S04, S12).
 *
 * Dự án và tài khoản tạm tạo bằng khóa service của stack CỤC BỘ (make test-e2e đặt
 * SUPABASE_SERVICE_ROLE_KEY), mật khẩu ngẫu nhiên; afterAll xóa. Vai trò: pm (người tạo dự án),
 * viewer (Người xem). Dựng cây, nhóm, lọc, sắp xếp có unit test riêng (lib/task-list/*.test.ts).
 */
const t = strings.taskList;
const BLOCKING_IMPACTS = new Set(["critical", "serious"]);
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const tag = randomUUID().slice(0, 8);
const password = `E2e-${randomUUID()}`;
const projectName = `E2E ${tag} Danh sách`;
const projectId = randomUUID();
const emptyProjectId = randomUUID();
const bigProjectId = randomUUID();
const BIG_COUNT = 320;
const emails = {
  pm: `e2e-e3-2-pm-${tag}@example.com`,
  viewer: `e2e-e3-2-viewer-${tag}@example.com`,
};
const users: Record<string, string> = {};
let statuses: { id: string; name: string; category: string }[] = [];
const labelName = `Nhãn ${tag}`;
const titles = {
  root: `Gốc ${tag}`,
  child: `Con một ${tag}`,
  grandchild: `Việc cấp ba ${tag}`,
  sibling: `Con hai ${tag}`,
  urgent: `Khẩn ${tag}`,
  other: `Khác ${tag}`,
};
const ids: Record<string, string> = {};
let service: SupabaseClient | null = null;

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
  const projects = await service.from("projects").insert([
    { id: projectId, name: projectName, created_by: users.pm },
    { id: emptyProjectId, name: `${projectName} trống`, created_by: users.pm },
    { id: bigProjectId, name: `${projectName} lớn`, created_by: users.pm },
  ]);
  if (projects.error) throw projects.error;
  const members = await service
    .from("project_members")
    .insert([{ project_id: projectId, user_id: users.viewer, role: "viewer" }]);
  if (members.error) throw members.error;
  const st = await service
    .from("task_statuses")
    .select("id, name, category, position")
    .eq("project_id", projectId)
    .order("position");
  if (st.error) throw st.error;
  statuses = st.data as typeof statuses;
  const label = await service
    .from("labels")
    .insert({ project_id: projectId, name: labelName, color: "#2054F0" })
    .select("id")
    .single();
  if (label.error) throw label.error;

  const insert = async (
    key: keyof typeof titles,
    row: Record<string, unknown>,
  ) => {
    const { data, error } = await service!
      .from("tasks")
      .insert({
        project_id: projectId,
        title: titles[key],
        created_by: users.pm,
        status_id: statuses[0].id,
        ...row,
      })
      .select("id")
      .single();
    if (error) throw error;
    ids[key] = data.id as string;
  };
  await insert("root", {});
  await insert("child", { parent_id: ids.root });
  await insert("grandchild", { parent_id: ids.child });
  await insert("sibling", { parent_id: ids.root, status_id: statuses[1].id });
  await insert("urgent", { priority: "urgent", due_date: "2020-01-01" });
  await insert("other", { assignee_id: users.pm });
  const tl = await service
    .from("task_labels")
    .insert({ task_id: ids.urgent, label_id: label.data.id });
  if (tl.error) throw tl.error;

  const bigStatus = await service
    .from("task_statuses")
    .select("id")
    .eq("project_id", bigProjectId)
    .order("position")
    .limit(1)
    .single();
  if (bigStatus.error) throw bigStatus.error;
  const big = await service.from("tasks").insert(
    Array.from({ length: BIG_COUNT }, (_, i) => ({
      project_id: bigProjectId,
      title: `Task lớn ${String(i + 1).padStart(3, "0")} ${tag}`,
      created_by: users.pm,
      status_id: bigStatus.data.id,
    })),
  );
  if (big.error) throw big.error;
});

test.afterAll(async () => {
  await cleanupTempData(service, {
    projectIds: [projectId, emptyProjectId, bigProjectId],
    userIds: Object.values(users),
  });
});

type Cookies = Awaited<ReturnType<BrowserContext["cookies"]>>;
/** Cookie phiên theo vai trò: mỗi vai trò chỉ đăng nhập MỘT lần cho cả tệp (giới hạn loginIp 50 lần/5 phút dùng chung cho mọi spec chạy từ cùng IP). */
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
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  return results.violations
    .filter((v) => v.impact && BLOCKING_IMPACTS.has(v.impact))
    .flatMap((v) => v.nodes.map((n) => `${v.id} @ ${n.target.join(" ")}`));
}

const table = (page: Page) => page.getByRole("table", { name: t.tableLabel });
const row = (page: Page, title: string) =>
  table(page)
    .getByRole("row")
    .filter({ has: page.getByRole("link", { name: new RegExp(title) }) });
const toggle = (page: Page, title: string, count: number) =>
  page.getByRole("button", {
    name: new RegExp(
      `^(${escape(t.row.collapse(title, count))}|${escape(t.row.expand(title, count))})$`,
    ),
  });
/** Tên truy cập của nút nhóm: tên nhóm + số task (chữ ẩn cho trình đọc màn hình). */
const groupName = (name: string, count: number) =>
  new RegExp(`^${escape(name)}\\s*${escape(t.groupCount(count))}$`);
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

async function openList(page: Page, id = projectId) {
  await page.goto(`/projects/${id}/list`);
  await expect(
    page.getByRole("heading", { level: 1, name: new RegExp(projectName) }),
  ).toBeVisible();
}

/** Tiêu đề các hàng task đang hiện, theo thứ tự. */
async function visibleTitles(page: Page) {
  return table(page)
    .locator('[data-testid="task-list-row"] a')
    .evaluateAll((els) =>
      els.map((e) => e.querySelector("span")?.textContent ?? ""),
    );
}

test.describe.serial("Bảng phân cấp", () => {
  test("PM: cây 3 cấp, thu gọn/mở rộng (AC1), giữ khi lọc, sắp xếp, tab Danh sách (sáng)", async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await signInAs(page, "pm");
    await page.goto(`/projects/${projectId}`);
    const tab = page
      .getByRole("navigation", { name: strings.projectNav.navLabel })
      .getByRole("link", { name: new RegExp(`${t.navTab}$`) });
    await tab.click();
    await expect(page).toHaveURL(`/projects/${projectId}/list`);
    await expect(tab).toHaveAttribute("aria-current", "page");

    await expect(row(page, titles.grandchild)).toBeVisible();
    await expect(row(page, titles.grandchild)).toHaveAttribute(
      "data-level",
      "3",
    );
    await expect(row(page, titles.child)).toHaveAttribute("data-level", "2");
    // Hàng liên kết tới chi tiết task.
    await expect(
      row(page, titles.root).getByRole("link", {
        name: new RegExp(titles.root),
      }),
    ).toHaveAttribute("href", `/projects/${projectId}/tasks/${ids.root}`);

    // AC1: thu gọn task cha ẩn mọi hàng con cháu; mở lại thì hiện.
    const rootToggle = toggle(page, titles.root, 2);
    await expect(rootToggle).toHaveAttribute("aria-expanded", "true");
    await rootToggle.click();
    await expect(rootToggle).toHaveAttribute("aria-expanded", "false");
    for (const k of ["child", "grandchild", "sibling"] as const) {
      await expect(row(page, titles[k])).toHaveCount(0);
    }
    await rootToggle.click();
    await expect(row(page, titles.grandchild)).toBeVisible();

    // Thu gọn tất cả / mở rộng tất cả.
    await page.getByRole("button", { name: t.toolbar.collapseAll }).click();
    await expect(row(page, titles.child)).toHaveCount(0);
    await page.getByRole("button", { name: t.toolbar.expandAll }).click();
    await expect(row(page, titles.grandchild)).toBeVisible();

    // Trạng thái thu gọn giữ khi lọc: thu gọn "Con một", tìm "viec cap ba" (bỏ dấu).
    await toggle(page, titles.child, 1).click();
    await expect(row(page, titles.grandchild)).toHaveCount(0);
    await page
      .getByRole("searchbox", { name: t.filters.search })
      .fill("viec cap ba");
    await expect(
      page.getByRole("status").filter({ hasText: t.resultCount(1) }),
    ).toBeVisible();
    // Tổ tiên hiện làm ngữ cảnh, con vẫn ẩn vì cha đang thu gọn.
    await expect
      .poll(() => visibleTitles(page))
      .toEqual([titles.root, titles.child]);
    await toggle(page, titles.child, 1).click();
    await expect
      .poll(() => visibleTitles(page))
      .toEqual([titles.root, titles.child, titles.grandchild]);
    await page.getByRole("button", { name: t.clearFilters }).first().click();

    // Lọc ưu tiên.
    await page
      .getByRole("combobox", { name: t.filters.priority })
      .selectOption("urgent");
    await expect.poll(() => visibleTitles(page)).toEqual([titles.urgent]);
    await expect(row(page, titles.urgent)).toContainText(
      t.row.overdue("01/01/2020"),
    );
    await page
      .getByRole("combobox", { name: t.filters.priority })
      .selectOption("");

    // Sắp xếp theo tên tăng dần: "Con hai" lên trước "Con một" (mặc định theo ngày tạo thì ngược
    // lại), cây giữ nguyên (việc con vẫn nằm dưới task cha).
    const sortBtn = page.getByRole("button", {
      name: new RegExp(escape(t.sort.by(t.columns.title))),
    });
    const header = page.getByRole("columnheader", {
      name: new RegExp(t.columns.title),
    });
    await sortBtn.click();
    await expect(header).toHaveAttribute("aria-sort", "ascending");
    const order = await visibleTitles(page);
    expect(order.indexOf(titles.sibling)).toBeLessThan(
      order.indexOf(titles.child),
    );
    expect(order.indexOf(titles.root)).toBeLessThan(
      order.indexOf(titles.sibling),
    );
    await sortBtn.click();
    await expect(header).toHaveAttribute("aria-sort", "descending");
    await sortBtn.click(); // bỏ sắp
    await expect(header).not.toHaveAttribute("aria-sort", /.+/);

    expect(await blockingViolations(page)).toEqual([]);
  });

  test("PM: nhóm theo trạng thái thu gọn được (AC2), chọn cột được ghi nhớ, tạo task nhanh", async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await signInAs(page, "pm");
    await openList(page);

    // AC2: nhóm theo trạng thái → nhóm có thể thu gọn.
    await page
      .getByRole("combobox", { name: t.toolbar.groupBy })
      .selectOption("status_id");
    const firstGroup = page.getByRole("button", {
      name: groupName(statuses[0].name, 5),
    });
    await expect(firstGroup).toHaveAttribute("aria-expanded", "true");
    await expect(
      page.getByRole("button", {
        name: groupName(statuses[1].name, 1),
      }),
    ).toBeVisible();
    await expect(row(page, titles.urgent)).toBeVisible();
    await firstGroup.click();
    await expect(
      page.getByRole("button", {
        name: groupName(statuses[0].name, 5),
      }),
    ).toHaveAttribute("aria-expanded", "false");
    await expect(row(page, titles.urgent)).toHaveCount(0);
    await expect(row(page, titles.sibling)).toBeVisible();
    expect(await blockingViolations(page)).toEqual([]);

    // Nhóm theo nhãn: nhóm nhãn và "Không nhãn".
    await page
      .getByRole("combobox", { name: t.toolbar.groupBy })
      .selectOption("label_ids");
    await expect(
      page.getByRole("button", { name: groupName(labelName, 1) }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", {
        name: groupName(t.groupNone.label_ids, 5),
      }),
    ).toBeVisible();
    await page
      .getByRole("combobox", { name: t.toolbar.groupBy })
      .selectOption("");

    // Chọn cột: bật "Loại", tắt "Hạn"; tải lại trang vẫn giữ (localStorage).
    await page
      .getByRole("button", {
        name: new RegExp(`^${escape(t.toolbar.columns)}`),
      })
      .click();
    const dialog = page.getByRole("dialog", { name: t.columnDialog.title });
    await dialog.getByLabel(t.columns.type_id).check();
    await dialog.getByLabel(t.columns.due_date).uncheck();
    expect(await blockingViolations(page)).toEqual([]);
    await dialog.getByRole("button", { name: t.columnDialog.done }).click();
    const headers = table(page).getByRole("columnheader");
    await expect(headers.filter({ hasText: t.columns.type_id })).toHaveCount(1);
    await expect(headers.filter({ hasText: t.columns.due_date })).toHaveCount(
      0,
    );
    await page.reload();
    await expect(
      table(page)
        .getByRole("columnheader")
        .filter({ hasText: t.columns.type_id }),
    ).toHaveCount(1);
    await page
      .getByRole("button", {
        name: new RegExp(`^${escape(t.toolbar.columns)}`),
      })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: t.columnDialog.reset })
      .click();
    await page.keyboard.press("Escape");
    await expect(
      table(page)
        .getByRole("columnheader")
        .filter({ hasText: t.columns.due_date }),
    ).toHaveCount(1);

    // Tạo task nhanh (POST có sẵn): hàng mới hiện ngay.
    const newTitle = `Task nhanh ${tag}`;
    await page.getByRole("button", { name: t.create.action }).first().click();
    await page
      .getByRole("dialog", { name: t.create.title })
      .getByLabel(t.create.name)
      .fill(newTitle);
    await page
      .getByRole("dialog")
      .getByRole("button", { name: t.create.submit })
      .click();
    await expect(row(page, newTitle)).toBeVisible();
    const { data } = await service!
      .from("tasks")
      .select("id")
      .eq("project_id", projectId)
      .eq("title", newTitle);
    expect(data).toHaveLength(1);
  });

  test("Người xem: chỉ đọc, không có nút tạo task (tối)", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await signInAs(page, "viewer");
    await openList(page);
    await expect(page.getByText(t.readOnly, { exact: true })).toBeVisible();
    await expect(page.getByText(t.readOnlyNote)).toBeVisible();
    await expect(
      page.getByRole("button", { name: t.create.action }),
    ).toHaveCount(0);
    await expect(row(page, titles.grandchild)).toBeVisible();
    await page
      .getByRole("combobox", { name: t.toolbar.groupBy })
      .selectOption("priority");
    await expect(
      page.getByRole("button", {
        name: groupName(strings.ui.priority.urgent, 1),
      }),
    ).toBeVisible();
    expect(await blockingViolations(page)).toEqual([]);
  });

  test("360 px: bảng cuộn ngang trong khung, trang không tràn, vùng bấm 44 px (tối)", async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.setViewportSize({ width: 360, height: 740 });
    await signInAs(page, "pm");
    await openList(page);
    await expect(row(page, titles.grandchild)).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow, "Trang tràn ngang ở 360 px").toBeLessThanOrEqual(0);
    const scroller = page.getByTestId("task-list-scroll");
    const inner = await scroller.evaluate((el) => ({
      scroll: el.scrollWidth,
      client: el.clientWidth,
    }));
    expect(inner.scroll, "Bảng phải cuộn ngang trong khung").toBeGreaterThan(
      inner.client,
    );
    const box = (await toggle(page, titles.root, 2).boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(await blockingViolations(page)).toEqual([]);
  });

  test("Nhiều task: chỉ dựng hàng trong khung nhìn, cuộn tới cuối vẫn thấy task cuối", async ({
    page,
  }) => {
    await signInAs(page, "pm");
    await openList(page, bigProjectId);
    await expect(table(page)).toHaveAttribute(
      "aria-rowcount",
      String(BIG_COUNT + 1),
    );
    const rendered = await page.getByTestId("task-list-row").count();
    expect(rendered).toBeGreaterThan(0);
    expect(rendered).toBeLessThan(BIG_COUNT);
    // Sắp theo tên tăng dần, cuộn xuống cuối khung: task cuối được dựng.
    await page
      .getByRole("button", {
        name: new RegExp(escape(t.sort.by(t.columns.title))),
      })
      .click();
    await page
      .getByTestId("task-list-scroll")
      .evaluate((el) => el.scrollTo(0, el.scrollHeight));
    await expect(
      row(page, `Task lớn ${String(BIG_COUNT).padStart(3, "0")} ${tag}`),
    ).toBeVisible();
  });

  test("Trạng thái rỗng, lỗi tải có nút thử lại, dự án không thuộc về mình là 404", async ({
    page,
  }) => {
    await signInAs(page, "pm");
    await page.goto(`/projects/${emptyProjectId}/list`);
    await expect(
      page.getByRole("heading", { name: t.emptyTitle }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: t.emptyAction }),
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
    await page.goto(`/projects/${projectId}/list`);
    await expect(
      page.getByRole("heading", { name: t.loadError }),
    ).toBeVisible();
    fail = false;
    await page.getByRole("button", { name: t.retry }).click();
    await expect(row(page, titles.root)).toBeVisible();

    await page.goto(`/projects/${randomUUID()}/list`);
    await expect(page.getByRole("heading", { name: "404" })).toBeVisible();
  });
});
