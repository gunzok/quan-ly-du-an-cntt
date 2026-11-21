import { randomUUID } from "node:crypto";
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
 * Luồng 3 (test-strategy.md mục 4): PM tạo dự án, thêm thành viên; thành viên đăng nhập thấy dự án;
 * PM lưu dự án cũ thành template rồi tạo dự án mới từ template (Story E7-1).
 *
 * PM ở đây là người đang làm PM một dự án khác (điều kiện để có nút "Tạo dự án").
 * Chi tiết: projects.spec.ts (sửa, lưu trữ, xóa vĩnh viễn), project-members.spec.ts (đổi vai trò, gỡ);
 * phân quyền và lỗi biên của template: tests/integration/project-templates.test.ts, pgTAP
 * project-templates.test.sql. Template dự án không phải trạng thái toàn hệ thống (tên có tag riêng)
 * nên không cần khóa dùng chung.
 */
const tag = newTag();
const createdUsers: string[] = [];
let service: SupabaseClient | null = null;
let pm: FlowUser;
let member: FlowUser;
const projectName = `${TEMP_PROJECT_PREFIX}${tag} Cổng thông tin nội bộ`;
const fromTemplateName = `${TEMP_PROJECT_PREFIX}${tag} Từ template`;
const templateName = `${TEMP_PROJECT_PREFIX}${tag} Mẫu triển khai`;
const projectIds: string[] = [];
let oldProjectId = "";

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
  oldProjectId = await createProject(
    service,
    `${TEMP_PROJECT_PREFIX}${tag} Dự án cũ`,
    pm.id,
    [{ user: member.id, role: "member" }],
  );
  projectIds.push(oldProjectId);
  // Dự án cũ có nhãn và cây task 2 cấp (một task giao cho thành viên) để lưu thành template.
  const label = await service
    .from("labels")
    .insert({ project_id: oldProjectId, name: "Hạ tầng", color: "#2054F0" })
    .select("id")
    .single();
  if (label.error) throw label.error;
  const parent = randomUUID();
  const rows = [
    {
      id: parent,
      parent_id: null,
      title: "Chuẩn bị máy chủ",
      assignee_id: member.id,
    },
    {
      id: randomUUID(),
      parent_id: parent,
      title: "Cài hệ điều hành",
      assignee_id: null,
    },
  ];
  for (const row of rows) {
    const { error } = await service
      .from("tasks")
      .insert({ ...row, project_id: oldProjectId, created_by: pm.id });
    if (error) throw error;
  }
  const tl = await service
    .from("task_labels")
    .insert({ task_id: parent, label_id: label.data.id });
  if (tl.error) throw tl.error;
});

test.afterAll(async () => {
  // Dự án, template tạo qua giao diện: tìm theo tên có tag của lần chạy.
  const ids = [...projectIds];
  if (service) {
    const { data } = await service
      .from("projects")
      .select("id")
      .in("name", [projectName, fromTemplateName]);
    ids.push(...(data ?? []).map((r) => r.id as string));
    const { error } = await service
      .from("project_templates")
      .delete()
      .eq("name", templateName);
    if (error) console.warn(`[e2e] Chưa xóa được template: ${error.message}`);
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
  await test.step("PM lưu dự án cũ thành template rồi tạo dự án mới từ template", async () => {
    const tt = strings.projectTemplates;
    const state = await loginState(browser, baseURL!, pm);
    const { page, close } = await openAs(browser, baseURL!, state);

    // Cấu hình dự án cũ → "Lưu thành template".
    await page.goto(`/projects/${oldProjectId}/settings`);
    await page.getByRole("button", { name: tt.save.action }).click();
    const save = page.getByRole("dialog", { name: tt.save.title });
    await expect(save.getByText(tt.save.sharedWarning)).toBeVisible();
    await save.getByLabel(tt.save.nameLabel).fill(templateName);
    await expectNoA11yViolations(
      page,
      "hộp thoại lưu thành template",
      OPEN_DIALOG,
    );
    await save.getByRole("button", { name: tt.save.submit }).click();
    await expect(save).toBeHidden();
    await expect(page.getByText(tt.save.saved(templateName))).toBeVisible();

    // Trang Template dự án (S17): dòng mới có tóm tắt 7 trạng thái, 4 loại, 1 nhãn, 2 task.
    await page
      .getByRole("navigation", { name: t.navLabel })
      .getByRole("link", { name: tt.navLink })
      .click();
    await expect(
      page.getByRole("heading", { level: 1, name: tt.heading }),
    ).toBeVisible();
    const row = page.getByRole("row").filter({
      has: page.getByRole("rowheader", { name: templateName, exact: true }),
    });
    await expect(row).toContainText(tt.summary("7", "4", "1", "2"));
    await expect(
      row.getByRole("button", { name: tt.actions.renameLabel(templateName) }),
    ).toBeVisible();
    await expectNoA11yViolations(page, "trang Template dự án");

    // Trang chủ → Tạo dự án → "Bắt đầu từ" template vừa lưu.
    await page.goto("/");
    await page.getByRole("button", { name: t.create }).click();
    const dialog = page.getByRole("dialog", { name: t.form.createTitle });
    await dialog.getByLabel(t.form.name).fill(fromTemplateName);
    await dialog.getByLabel(t.form.startDate).fill("2027-02-01");
    const group = dialog.getByRole("group", { name: tt.create.startFrom });
    await expect(
      group.getByRole("radio", { name: new RegExp(tt.create.blank) }),
    ).toBeChecked();
    await group.getByRole("radio", { name: new RegExp(templateName) }).check();
    await expect(dialog.getByText(tt.create.datesHint)).toBeVisible();
    await expectNoA11yViolations(
      page,
      "hộp thoại tạo dự án từ template",
      OPEN_DIALOG,
    );
    await dialog.getByRole("button", { name: t.form.submitCreate }).click();
    await expect(dialog).toBeHidden();
    await expect(
      page.getByText(t.done.created(fromTemplateName)),
    ).toBeVisible();
    await expect(card(page, fromTemplateName)).toContainText(
      `${t.card.eyebrow} / ${t.roles.pm}`,
    );

    // Cấu trúc được nhân bản: cây task, nhãn; không sao chép người phụ trách, thành viên.
    const { data: created } = await service!
      .from("projects")
      .select("id, template_id")
      .eq("name", fromTemplateName)
      .single();
    const newId = created!.id as string;
    const [tasks, members, labels] = await Promise.all([
      service!
        .from("tasks")
        .select("id, parent_id, title, assignee_id, depth")
        .eq("project_id", newId)
        .order("depth"),
      service!
        .from("project_members")
        .select("user_id, role")
        .eq("project_id", newId),
      service!.from("labels").select("name").eq("project_id", newId),
    ]);
    expect(tasks.data?.map((r) => [r.title, r.depth, r.assignee_id])).toEqual([
      ["Chuẩn bị máy chủ", 1, null],
      ["Cài hệ điều hành", 2, null],
    ]);
    expect(tasks.data?.[1].parent_id).toBe(tasks.data?.[0].id);
    expect(members.data).toEqual([{ user_id: pm.id, role: "pm" }]);
    expect(labels.data).toEqual([{ name: "Hạ tầng" }]);

    // Bảng của dự án mới hiện task đã nhân bản.
    await page.goto(`/projects/${newId}`);
    await expect(
      page.getByRole("heading", { level: 1, name: fromTemplateName }),
    ).toBeVisible();
    await expect(
      page.getByText("Chuẩn bị máy chủ", { exact: true }).first(),
    ).toBeVisible();
    await close();
  });
});
