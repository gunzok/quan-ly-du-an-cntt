import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { type SupabaseClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";
import { en } from "@/lib/i18n/messages/en";
import { vi as strings } from "@/lib/i18n/messages/vi";
import { waitForHydration } from "./hydration";
import { signInWithPassword } from "./login";
import {
  cleanupTempData,
  createTempUsers,
  serviceClient,
  TEMP_PROJECT_PREFIX,
} from "./temp-data";

/**
 * Story E7-1 (QLDA-78): S17 "Template dự án" ở /project-templates (PM, Admin) và tab ở
 * /admin/report-templates (Admin). Kiểm chỉ đọc (template của PM khác), 360 px, sáng/tối, tiếng Anh,
 * rỗng/lỗi (giả lập API), bàn phím (đổi tên, chọn template trong hộp thoại tạo dự án), axe.
 * Luồng đầy đủ lưu → tạo dự án: tests/e2e/flows/03-tao-du-an.spec.ts.
 *
 * Template tạo thẳng bằng khóa service (chèn trực tiếp: service_role vẫn qua CHECK structure), tên có
 * tag riêng nên không cần khóa dùng chung. afterAll xóa template, dự án, tài khoản.
 */
const t = strings.projectTemplates;
const BLOCKING_IMPACTS = new Set(["critical", "serious"]);
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const tag = randomUUID().slice(0, 8);
const password = `E2e-${randomUUID()}`;
const emails = {
  admin: `e2e-e7-1-admin-${tag}@example.com`,
  pm: `e2e-e7-1-pm-${tag}@example.com`,
  pm2: `e2e-e7-1-pm2-${tag}@example.com`,
  member: `e2e-e7-1-member-${tag}@example.com`,
};
const users: Record<string, string> = {};
const projectIds = [randomUUID(), randomUUID()];
const templateId = randomUUID();
const templateName = `${TEMP_PROJECT_PREFIX}${tag} Mẫu S17`;
const renamed = `${TEMP_PROJECT_PREFIX}${tag} Mẫu S17 mới`;

const structure = {
  version: 1,
  statuses: [
    { key: "s1", name: "Mới", category: "todo", color: "#8A93A6", position: 1 },
    {
      key: "s2",
      name: "Xong",
      category: "done",
      color: "#137035",
      position: 2,
    },
  ],
  task_types: [
    {
      key: "y1",
      name: "Task",
      is_milestone: false,
      color: "#2054F0",
      position: 1,
    },
  ],
  labels: [],
  tasks: [
    {
      key: "t1",
      parent: null,
      title: "Việc mẫu",
      description: null,
      type: "y1",
      status: "s1",
      priority: "medium",
      labels: [],
      position: 1,
      start_offset: null,
      due_offset: null,
    },
  ],
};

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
  const admin = await service
    .from("profiles")
    .update({ is_admin: true })
    .eq("id", users.admin);
  if (admin.error) throw admin.error;
  const projects = await service.from("projects").insert([
    {
      id: projectIds[0],
      name: `${TEMP_PROJECT_PREFIX}${tag} E7-1 A`,
      created_by: users.pm,
    },
    {
      id: projectIds[1],
      name: `${TEMP_PROJECT_PREFIX}${tag} E7-1 B`,
      created_by: users.pm2,
    },
  ]);
  if (projects.error) throw projects.error;
  const member = await service.from("project_members").insert({
    project_id: projectIds[0],
    user_id: users.member,
    role: "member",
  });
  if (member.error) throw member.error;
  const tpl = await service.from("project_templates").insert({
    id: templateId,
    name: templateName,
    structure,
    created_by: users.pm,
  });
  if (tpl.error) throw tpl.error;
});

test.afterAll(async () => {
  if (!service) return;
  await service.from("project_templates").delete().eq("id", templateId);
  await cleanupTempData(service, {
    projectIds,
    userIds: Object.values(users),
  });
});

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

async function dismissToasts(page: Page) {
  const buttons = page.getByRole("button", { name: strings.ui.toast.dismiss });
  while ((await buttons.count()) > 0) await buttons.first().click();
}

const row = (page: Page, name: string) =>
  page.getByRole("row").filter({
    has: page.getByRole("rowheader", { name, exact: true }),
  });

async function openTemplates(page: Page, heading = t.heading) {
  await page.goto("/project-templates");
  await expect(
    page.getByRole("heading", { level: 1, name: heading }),
  ).toBeVisible();
  await waitForHydration(page);
}

test.describe.serial("Template dự án (S17)", () => {
  test("PM khác: chỉ đọc, 360 px, giao diện tối, axe", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.emulateMedia({ colorScheme: "dark" });
    await signInWithPassword(page, emails.pm2, password);
    await openTemplates(page);
    const r = row(page, templateName);
    await expect(r).toContainText(t.summary("2", "1", "0", "1"));
    await expect(r.getByText(t.readOnlyHint)).toBeVisible();
    await expect(r.getByRole("button")).toHaveCount(0);
    // Bảng cuộn ngang trong vùng riêng; trang không cuộn ngang ở 360 px.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    expect(await blockingViolations(page)).toEqual([]);
  });

  test("Người lưu: đổi tên bằng bàn phím, lưu trữ, khôi phục (sáng)", async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await signInWithPassword(page, emails.pm, password);
    await openTemplates(page);
    expect(await blockingViolations(page)).toEqual([]);

    const renameButton = row(page, templateName).getByRole("button", {
      name: t.actions.renameLabel(templateName),
    });
    await renameButton.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: t.renameDialog.title });
    const input = dialog.getByLabel(t.renameDialog.nameLabel);
    await expect(input).toHaveValue(templateName);
    expect(await blockingViolations(page)).toEqual([]);
    await input.fill("   ");
    await page.keyboard.press("Enter");
    await expect(dialog.getByText(t.errors.nameRequired)).toBeVisible();
    await input.fill(renamed);
    await page.keyboard.press("Enter");
    await expect(dialog).toBeHidden();
    await expect(page.getByText(t.renamed(renamed))).toBeVisible();
    await dismissToasts(page);

    await row(page, renamed)
      .getByRole("button", { name: t.actions.archiveLabel(renamed) })
      .click();
    await expect(page.getByText(t.archivedToast(renamed))).toBeVisible();
    await expect(row(page, renamed)).toHaveCount(0);
    await page.getByRole("switch", { name: t.showArchived }).check();
    const archived = row(page, renamed);
    await expect(archived.getByText(t.status.archived)).toBeVisible();
    await archived
      .getByRole("button", { name: t.actions.restoreLabel(renamed) })
      .click();
    await expect(archived.getByText(t.status.active)).toBeVisible();
    await dismissToasts(page);
    expect(await blockingViolations(page)).toEqual([]);
  });

  test("Chọn template trong hộp thoại tạo dự án bằng bàn phím", async ({
    page,
  }) => {
    await signInWithPassword(page, emails.pm, password);
    await waitForHydration(page);
    await page.getByRole("button", { name: strings.projects.create }).click();
    const dialog = page.getByRole("dialog", {
      name: strings.projects.form.createTitle,
    });
    const group = dialog.getByRole("group", { name: t.create.startFrom });
    const blank = group.getByRole("radio", {
      name: new RegExp(t.create.blank),
    });
    await expect(blank).toBeChecked();
    await expect(
      group.getByRole("radio", { name: new RegExp(renamed) }),
    ).toBeVisible();
    await blank.focus();
    await page.keyboard.press("ArrowDown");
    await expect(blank).not.toBeChecked();
    await expect(dialog.getByText(t.create.datesHint)).toBeVisible();
    await page.keyboard.press("ArrowUp");
    await expect(blank).toBeChecked();
  });

  test("Tiếng Anh; trạng thái rỗng và lỗi (giả lập API)", async ({ page }) => {
    // Ngôn ngữ trong hồ sơ được ưu tiên hơn cookie (lib/i18n/negotiate.ts): đặt hồ sơ tạm sang en.
    const locale = await service!
      .from("profiles")
      .update({ locale: "en" })
      .eq("id", users.pm);
    if (locale.error) throw locale.error;
    await signInWithPassword(page, emails.pm, password);
    await page.route("**/api/v1/project-templates*", (route) =>
      route.fulfill({ json: { data: [] } }),
    );
    await openTemplates(page, en.projectTemplates.heading);
    await expect(page.getByText(en.projectTemplates.empty.title)).toBeVisible();
    expect(await blockingViolations(page)).toEqual([]);

    await page.unroute("**/api/v1/project-templates*");
    await page.route("**/api/v1/project-templates*", (route) =>
      route.fulfill({
        status: 500,
        json: { error: { code: "internal_error", message: "Lỗi hệ thống" } },
      }),
    );
    await page.reload();
    const alert = page
      .getByRole("alert")
      .filter({ hasText: en.projectTemplates.loadFailed });
    await expect(alert).toBeVisible();
    await page.unroute("**/api/v1/project-templates*");
    await alert
      .getByRole("button", { name: en.projectTemplates.retry })
      .click();
    await expect(row(page, renamed)).toBeVisible();
  });

  test("Admin: tab Template dự án ở /admin/report-templates quản lý được template của PM", async ({
    page,
  }) => {
    await signInWithPassword(page, emails.admin, password);
    await page.goto("/admin/report-templates?tab=project");
    await waitForHydration(page, "[role=tablist]");
    const tab = page.getByRole("tab", { name: t.tabs.project });
    await expect(tab).toHaveAttribute("aria-selected", "true");
    await expect(
      row(page, renamed).getByRole("button", {
        name: t.actions.renameLabel(renamed),
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: strings.reportTemplates.upload.action }),
    ).toHaveCount(0);
    expect(await blockingViolations(page)).toEqual([]);
    await page.getByRole("tab", { name: t.tabs.report }).click();
    await expect(
      page.getByRole("button", { name: strings.reportTemplates.upload.action }),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/admin\/report-templates$/);
  });

  test("Thành viên: không có liên kết, trang hiện 404", async ({ page }) => {
    await signInWithPassword(page, emails.member, password);
    await expect(
      page
        .getByRole("navigation", { name: strings.projects.navLabel })
        .getByRole("link", { name: t.navLink }),
    ).toHaveCount(0);
    // notFound() trong Suspense: mã HTTP vẫn 200, nội dung là 404 (giống /admin/report-templates).
    await page.goto("/project-templates");
    await expect(page.getByRole("heading", { name: "404" })).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 1, name: t.heading }),
    ).toHaveCount(0);
  });
});
