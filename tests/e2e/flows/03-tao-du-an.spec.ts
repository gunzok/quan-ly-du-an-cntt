import type { SupabaseClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";
import { vi as strings } from "@/lib/i18n/messages/vi";
import {
  cleanupTempData,
  serviceClient,
  TEMP_PROJECT_PREFIX,
} from "../temp-data";
import {
  createFlowUsers,
  createProject,
  expectNoA11yViolations,
  loginState,
  newTag,
  OPEN_DIALOG,
  openAs,
  type FlowUser,
} from "./support";

/**
 * Luồng 3 (test-strategy.md mục 4): PM tạo dự án, thêm thành viên; thành viên đăng nhập thấy dự án.
 *
 * PM ở đây là người đang làm PM một dự án khác (điều kiện để có nút "Tạo dự án").
 * CHƯA KIỂM "tạo dự án từ template": tính năng thuộc Story E7-1 chưa làm (màn tạo dự án chưa có lựa
 * chọn template). Khi E7-1 xong, thêm bước chọn template vào luồng này.
 * Chi tiết: projects.spec.ts (sửa, lưu trữ, xóa vĩnh viễn), project-members.spec.ts (đổi vai trò, gỡ).
 */
const tag = newTag();
const createdUsers: string[] = [];
let service: SupabaseClient | null = null;
let pm: FlowUser;
let member: FlowUser;
const projectName = `${TEMP_PROJECT_PREFIX}${tag} Cổng thông tin nội bộ`;
const projectIds: string[] = [];

test.beforeAll(async () => {
  service = serviceClient();
  ({ pm, member } = await createFlowUsers(
    service,
    3,
    tag,
    { pm: `E2E PM ${tag}`, member: `E2E Thành viên ${tag}` },
    createdUsers,
  ));
  // Chỉ Admin hoặc người đang là PM ở ít nhất một dự án mới tạo được dự án (lib/projects/policy.ts).
  projectIds.push(
    await createProject(
      service,
      `${TEMP_PROJECT_PREFIX}${tag} Dự án cũ`,
      pm.id,
    ),
  );
});

test.afterAll(async () => {
  // Dự án tạo qua giao diện: tìm theo tên có tag của lần chạy.
  const ids = [...projectIds];
  if (service) {
    const { data } = await service
      .from("projects")
      .select("id")
      .eq("name", projectName);
    ids.push(...(data ?? []).map((r) => r.id as string));
  }
  await cleanupTempData(service, { projectIds: ids, userIds: createdUsers });
});

const card = (page: Page, name: string) =>
  page
    .getByRole("list", { name: strings.projects.listLabel })
    .getByRole("listitem")
    .filter({ has: page.getByRole("heading", { name, exact: true }) });

test("Luồng 3: PM tạo dự án → thêm thành viên → thành viên thấy dự án đúng vai trò", async ({
  browser,
  baseURL,
}) => {
  const t = strings.projects;
  const pmMembers = strings.projectMembers;

  await test.step("PM tạo dự án ở trang chủ, trở thành PM của dự án", async () => {
    const state = await loginState(browser, baseURL!, pm);
    const { page, close } = await openAs(browser, baseURL!, state);
    await page.goto("/");
    await expect(
      page.getByRole("heading", { level: 1, name: t.pageTitle }),
    ).toBeVisible();
    await page.getByRole("button", { name: t.create }).click();
    const dialog = page.getByRole("dialog", { name: t.form.createTitle });
    await expect(dialog.getByLabel(t.form.name)).toBeFocused();
    await dialog.getByLabel(t.form.name).fill(projectName);
    await dialog
      .getByLabel(t.form.descriptionLabel)
      .fill("Dự án thử của luồng 3.");
    await dialog.getByLabel(t.form.startDate).fill("2027-01-04");
    await dialog.getByLabel(t.form.endDate).fill("2027-06-30");
    await expectNoA11yViolations(page, "hộp thoại tạo dự án", OPEN_DIALOG);
    await dialog.getByRole("button", { name: t.form.submitCreate }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText(t.done.created(projectName))).toBeVisible();
    const created = card(page, projectName);
    await expect(created).toContainText(`${t.card.eyebrow} / ${t.roles.pm}`);
    await expect(created.getByText(t.card.members(1))).toBeVisible();
    await expectNoA11yViolations(page, "trang chủ có dự án mới");

    // Mở dự án từ thẻ → Cấu hình → Thành viên → thêm thành viên.
    const { data } = await service!
      .from("projects")
      .select("id")
      .eq("name", projectName)
      .single();
    const projectId = data!.id as string;
    await page.goto(`/projects/${projectId}/settings`);
    await page.getByRole("tab", { name: pmMembers.tab }).click();
    const list = page.getByRole("list", { name: pmMembers.listLabel });
    await expect(list.getByRole("listitem")).toHaveCount(1);
    await page.getByRole("button", { name: `+ ${pmMembers.add}` }).click();
    const add = page.getByRole("dialog", { name: pmMembers.addDialog.title });
    await add.getByLabel(pmMembers.addDialog.search).fill(member.name);
    await add.getByRole("radio", { name: new RegExp(member.name) }).check();
    await add.getByLabel(pmMembers.addDialog.role).selectOption("member");
    await add.getByRole("button", { name: pmMembers.addDialog.submit }).click();
    await expect(add).toBeHidden();
    await expect(
      page.getByText(pmMembers.done.added(member.name, t.roles.member)),
    ).toBeVisible();
    await expect(list.getByRole("listitem")).toHaveCount(2);
    await expectNoA11yViolations(page, "tab Thành viên");

    // Thẻ dự án ở trang chủ cập nhật số thành viên.
    await page.goto("/");
    await expect(
      card(page, projectName).getByText(t.card.members(2)),
    ).toBeVisible();
    await close();
  });

  await test.step("Thành viên đăng nhập thấy dự án với vai trò Thành viên, vào được Dashboard và Bảng", async () => {
    const state = await loginState(browser, baseURL!, member);
    const { page, close } = await openAs(browser, baseURL!, state, {
      colorScheme: "dark",
    });
    await page.goto("/");
    const shared = card(page, projectName);
    await expect(shared).toContainText(`${t.card.eyebrow} / ${t.roles.member}`);
    await expectNoA11yViolations(page, "trang chủ thành viên (tối)");
    // Vào dự án từ thẻ (liên kết Dashboard) rồi sang Bảng.
    await shared
      .getByRole("link", {
        name: `${strings.dashboard.open} ${projectName}`,
        exact: true,
      })
      .click();
    await expect(
      page.getByRole("heading", { level: 1, name: strings.dashboard.heading }),
    ).toBeVisible();
    await page
      .getByRole("navigation", { name: strings.projectNav.navLabel })
      .getByRole("link", { name: strings.projectNav.board })
      .click();
    await expect(
      page.getByRole("heading", { level: 1, name: projectName }),
    ).toBeVisible();
    await close();
  });
});
