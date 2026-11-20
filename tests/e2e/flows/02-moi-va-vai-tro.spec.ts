import type { SupabaseClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";
import { vi as strings } from "@/lib/i18n/messages/vi";
import { waitForHydration } from "../hydration";
import { inviteLinkFromMailpit } from "../mailpit";
import { cleanupTempData, serviceClient } from "../temp-data";
import {
  createFlowUsers,
  createProject,
  expectNoA11yViolations,
  flowEmail,
  loginState,
  makeAdmin,
  newPassword,
  newTag,
  OPEN_DIALOG,
  openAs,
  type FlowUser,
  type StorageState,
} from "./support";

/**
 * Luồng 2 (test-strategy.md mục 4): Admin mời người dùng → người được mời nhận email ở Mailpit, đặt
 * mật khẩu, vào ứng dụng → PM gán vai trò theo dự án: cùng một người là PM ở dự án A, Người xem ở
 * dự án B; ở B không có nút sửa, ở A có.
 *
 * Admin và PM là tài khoản tạm (khóa service, stack cục bộ); người được mời được tạo bằng chính màn
 * /admin/users. Dự án A, B do PM tạo sẵn (khóa service). Chi tiết từng phần: accept-invite.spec.ts
 * (link hết hạn, link giả), project-members.spec.ts (PM cuối cùng, gỡ thành viên).
 */
const tag = newTag();
const createdUsers: string[] = [];
const projectIds: string[] = [];
let service: SupabaseClient | null = null;
let admin: FlowUser;
let pm: FlowUser;
const invitee = {
  email: flowEmail(2, "invitee", tag),
  name: `E2E Người mới ${tag}`,
  password: newPassword(),
};
const projectA = `E2E ${tag} Dự án A`;
const projectB = `E2E ${tag} Dự án B`;
const taskB = `Việc ở dự án B ${tag}`;
let idA = "";
let idB = "";
let inviteeState: StorageState | null = null;

test.beforeAll(async () => {
  service = serviceClient();
  ({ admin, pm } = await createFlowUsers(
    service,
    2,
    tag,
    { admin: `E2E Admin ${tag}`, pm: `E2E PM ${tag}` },
    createdUsers,
  ));
  await makeAdmin(service, admin.id);
  idA = await createProject(service, projectA, pm.id);
  projectIds.push(idA);
  idB = await createProject(service, projectB, pm.id);
  projectIds.push(idB);
  const task = await service
    .from("tasks")
    .insert({ project_id: idB, title: taskB, created_by: pm.id });
  if (task.error) throw task.error;
});

test.afterAll(async () => {
  // Người được mời được tạo qua giao diện: tìm theo email (chỉ email tạm mới bị xóa).
  if (service) {
    const { data } = await service
      .from("profiles")
      .select("id")
      .eq("email", invitee.email);
    for (const row of data ?? []) createdUsers.push(row.id as string);
  }
  await cleanupTempData(service, { projectIds, userIds: createdUsers });
});

const projectCard = (page: Page, name: string) =>
  page
    .getByRole("list", { name: strings.projects.listLabel })
    .getByRole("listitem")
    .filter({ has: page.getByRole("heading", { name, exact: true }) });

test("Luồng 2: Admin mời → nhận lời mời ở Mailpit → đặt mật khẩu → PM gán PM ở A, Người xem ở B → quyền theo dự án", async ({
  browser,
  baseURL,
}) => {
  const au = strings.adminUsers;
  const pmMembers = strings.projectMembers;
  const roles = strings.projects.roles;

  await test.step("Admin mời người dùng ở /admin/users", async () => {
    const state = await loginState(browser, baseURL!, admin);
    const { page, close } = await openAs(browser, baseURL!, state);
    await page.goto("/admin/users");
    await expect(
      page.getByRole("heading", { level: 1, name: au.heading }),
    ).toBeVisible();
    await waitForHydration(page, "main button");
    await page.getByRole("button", { name: au.invite.open }).click();
    const dialog = page.getByRole("dialog", { name: au.invite.title });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel(au.invite.emailLabel).fill(invitee.email);
    await dialog.getByLabel(au.invite.nameLabel).fill(invitee.name);
    await expectNoA11yViolations(page, "hộp thoại mời", OPEN_DIALOG);
    await dialog.getByRole("button", { name: au.invite.submit }).click();
    await expect(dialog).toBeHidden();
    await expect(
      page.getByText(au.invite.success(invitee.email)),
    ).toBeVisible();
    const row = page
      .getByRole("row")
      .filter({ has: page.getByText(invitee.email, { exact: true }) });
    await expect(row).toContainText(au.status.invited);
    await expectNoA11yViolations(page, "/admin/users");
    await close();
  });

  await test.step("Người được mời mở link trong email (Mailpit), đặt mật khẩu, vào ứng dụng", async () => {
    const link = await inviteLinkFromMailpit(invitee.email, baseURL!);
    const context = await browser.newContext({ baseURL, locale: "vi-VN" });
    const page = await context.newPage();
    await page.goto(link);
    const t = strings.acceptInvite;
    await expect(page.getByRole("heading", { name: t.heading })).toBeVisible();
    await waitForHydration(page);
    await expectNoA11yViolations(page, "/auth/accept-invite");
    await page.getByLabel(t.passwordLabel).fill(invitee.password);
    await page.getByLabel(t.confirmLabel).fill(invitee.password);
    await expect(page.getByLabel(t.passwordLabel)).toHaveValue(
      invitee.password,
    );
    await expect(page.getByLabel(t.confirmLabel)).toHaveValue(invitee.password);
    await page.getByRole("button", { name: t.submit }).click();
    await expect(page).toHaveURL("/");
    await expect(page.getByText(strings.home.signedInAs)).toContainText(
      invitee.email,
    );
    // Chưa thuộc dự án nào của luồng này.
    await expect(projectCard(page, projectA)).toHaveCount(0);
    inviteeState = await context.storageState();
    await context.close();
  });

  await test.step("PM thêm người mới: PM ở dự án A, Người xem ở dự án B", async () => {
    const state = await loginState(browser, baseURL!, pm);
    const { page, close } = await openAs(browser, baseURL!, state);
    for (const [id, role, roleName] of [
      [idA, "pm", roles.pm],
      [idB, "viewer", roles.viewer],
    ] as const) {
      await page.goto(`/projects/${id}/settings`);
      await page.getByRole("tab", { name: pmMembers.tab }).click();
      await expect(
        page.getByRole("list", { name: pmMembers.listLabel }),
      ).toBeVisible();
      await page.getByRole("button", { name: `+ ${pmMembers.add}` }).click();
      const dialog = page.getByRole("dialog", {
        name: pmMembers.addDialog.title,
      });
      await dialog.getByLabel(pmMembers.addDialog.search).fill(invitee.name);
      await dialog
        .getByRole("radio", { name: new RegExp(invitee.name) })
        .check();
      await dialog.getByLabel(pmMembers.addDialog.role).selectOption(role);
      if (role === "pm") {
        await expectNoA11yViolations(
          page,
          "hộp thoại thêm thành viên",
          OPEN_DIALOG,
        );
      }
      await dialog
        .getByRole("button", { name: pmMembers.addDialog.submit })
        .click();
      await expect(dialog).toBeHidden();
      await expect(
        page.getByText(pmMembers.done.added(invitee.name, roleName)),
      ).toBeVisible();
    }
    await close();
  });

  await test.step("Người mới: trang chủ thấy PM ở A, Người xem ở B", async () => {
    const { page, close } = await openAs(browser, baseURL!, inviteeState!);
    await page.goto("/");
    await expect(projectCard(page, projectA)).toContainText(
      `${strings.projects.card.eyebrow} / ${roles.pm}`,
    );
    await expect(projectCard(page, projectB)).toContainText(
      `${strings.projects.card.eyebrow} / ${roles.viewer}`,
    );
    await expectNoA11yViolations(page, "trang chủ người mới");

    // Dự án B (Người xem): không có nút tạo task, ngăn task chỉ đọc, không có nút sửa/xóa.
    await page.goto(`/projects/${idB}/list`);
    await expect(
      page.getByText(strings.taskList.readOnly, { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: strings.taskList.create.action }),
    ).toHaveCount(0);
    await page
      .getByRole("table", { name: strings.taskList.tableLabel })
      .getByRole("link", { name: new RegExp(taskB) })
      .click();
    const td = strings.taskDetail;
    const panel = page.getByRole("complementary", { name: td.panelLabel });
    await expect(panel.locator('[data-field="label_ids"]')).toBeVisible();
    await expect(panel.getByTestId("task-read-only")).toContainText(
      td.readOnly.viewer,
    );
    await expect(panel.getByRole("combobox")).toHaveCount(0);
    for (const name of [td.title.edit, td.delete.action]) {
      await expect(panel.getByRole("button", { name })).toHaveCount(0);
    }
    await expectNoA11yViolations(page, "task ở dự án B (Người xem)");

    // Dự án A (PM): có nút tạo task và vào được tab Thành viên với quyền sửa.
    await page.goto(`/projects/${idA}/list`);
    await expect(
      page
        .getByRole("button", { name: strings.taskList.create.action })
        .first(),
    ).toBeVisible();
    await page.goto(`/projects/${idA}/settings`);
    await page.getByRole("tab", { name: pmMembers.tab }).click();
    await expect(
      page.getByRole("button", { name: `+ ${pmMembers.add}` }),
    ).toBeVisible();
    await close();
  });
});
