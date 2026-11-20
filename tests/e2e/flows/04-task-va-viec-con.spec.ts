import type { SupabaseClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";
import { vi as strings } from "@/lib/i18n/messages/vi";
import { cleanupTempData, serviceClient } from "../temp-data";
import {
  createFlowUsers,
  createProject,
  expectNoA11yViolations,
  loginState,
  newTag,
  OPEN_DIALOG,
  openAs,
  originHeader,
  type FlowUser,
} from "./support";

/**
 * Luồng 4 (test-strategy.md mục 4): tạo task, việc con 3 cấp (cấp 4 bị từ chối), giao việc, đặt hạn;
 * xóa task cha còn việc con bị chặn (quyết định của sếp 2026-11-18).
 *
 * Mọi thao tác qua giao diện thật (bảng Danh sách, ngăn chi tiết task) bằng phiên PM tạm; cấp 4 kiểm
 * cả giao diện (không có ô thêm) lẫn API (422) vì giao diện chỉ ẩn ô. Chi tiết từng phần:
 * task-detail.spec.ts, task-list.spec.ts, tests/integration/subtasks.test.ts.
 */
const tag = newTag();
const createdUsers: string[] = [];
const projectIds: string[] = [];
let service: SupabaseClient | null = null;
let pm: FlowUser;
let member: FlowUser;
let projectId = "";
const projectName = `E2E ${tag} Luồng 4`;
const titles = {
  root: `Nâng cấp máy chủ ${tag}`,
  child: `Chuẩn bị phần cứng ${tag}`,
  grandchild: `Kiểm kê ổ đĩa ${tag}`,
  tooDeep: `Cấp bốn ${tag}`,
};

test.beforeAll(async () => {
  service = serviceClient();
  ({ pm, member } = await createFlowUsers(
    service,
    4,
    tag,
    { pm: `E2E PM ${tag}`, member: `E2E Thành viên ${tag}` },
    createdUsers,
  ));
  projectId = await createProject(service, projectName, pm.id, [
    { user: member.id, role: "member" },
  ]);
  projectIds.push(projectId);
});

test.afterAll(async () => {
  await cleanupTempData(service, { projectIds, userIds: createdUsers });
});

async function taskByTitle(title: string) {
  const { data, error } = await service!
    .from("tasks")
    .select("id, parent_id, depth, assignee_id, due_date")
    .eq("project_id", projectId)
    .eq("title", title)
    .single();
  if (error) throw error;
  return data as {
    id: string;
    parent_id: string | null;
    depth: number;
    assignee_id: string | null;
    due_date: string | null;
  };
}

const td = strings.taskDetail;
const panel = (page: Page) =>
  page.getByRole("complementary", { name: td.panelLabel });
const subtaskList = (page: Page) =>
  panel(page).getByRole("list", { name: td.subtasks.listLabel });

/** Thêm việc con nhanh ở ngăn chi tiết rồi mở việc con đó. */
async function addAndOpenSubtask(page: Page, title: string) {
  await panel(page).getByLabel(td.subtasks.addLabel).fill(title);
  await panel(page)
    .getByRole("button", { name: `+ ${td.subtasks.add}` })
    .click();
  const link = subtaskList(page).getByRole("link", {
    name: title,
    exact: true,
  });
  await expect(link).toBeVisible();
  await link.click();
  await expect(
    panel(page).getByRole("heading", { level: 1, name: title }),
  ).toBeVisible();
}

test("Luồng 4: tạo task → việc con 3 cấp (cấp 4 bị từ chối) → giao việc, đặt hạn → xóa task cha bị chặn", async ({
  browser,
  baseURL,
}) => {
  const tl = strings.taskList;
  const state = await loginState(browser, baseURL!, pm);
  const { page, close } = await openAs(browser, baseURL!, state);

  await test.step("PM tạo task ở bảng Danh sách", async () => {
    await page.goto(`/projects/${projectId}/list`);
    await page.getByRole("button", { name: tl.create.action }).first().click();
    const dialog = page.getByRole("dialog", { name: tl.create.title });
    await dialog.getByLabel(tl.create.name).fill(titles.root);
    await expectNoA11yViolations(page, "hộp thoại tạo task", OPEN_DIALOG);
    await dialog.getByRole("button", { name: tl.create.submit }).click();
    const row = page
      .getByRole("table", { name: tl.tableLabel })
      .getByRole("link", { name: new RegExp(titles.root) });
    await expect(row).toBeVisible();
    await row.click();
    await expect(
      panel(page).getByRole("heading", { level: 1, name: titles.root }),
    ).toBeVisible();
    await expect(panel(page).locator('[data-field="label_ids"]')).toBeVisible();
  });

  await test.step("Giao việc cho thành viên và đặt hạn", async () => {
    const saveStatus = panel(page).getByTestId("task-save-status");
    await panel(page).getByLabel(td.fields.assignee_id).selectOption(member.id);
    await expect(saveStatus).toContainText(
      td.save.saved(td.fields.assignee_id),
    );
    const due = panel(page).getByLabel(td.fields.due_date);
    await due.fill("2027-03-15");
    await due.press("Enter");
    await expect(saveStatus).toContainText(td.save.saved(td.fields.due_date));
    await expectNoA11yViolations(page, "ngăn chi tiết task");
    await expect
      .poll(async () => {
        const t = await taskByTitle(titles.root);
        return [t.assignee_id, t.due_date];
      })
      .toEqual([member.id, "2027-03-15"]);
  });

  await test.step("Việc con cấp 2 và cấp 3; cấp 3 không thêm được việc con", async () => {
    await addAndOpenSubtask(page, titles.child);
    await addAndOpenSubtask(page, titles.grandchild);
    await expect(panel(page).getByText(td.subtasks.maxDepth)).toBeVisible();
    await expect(panel(page).getByLabel(td.subtasks.addLabel)).toHaveCount(0);
    const [root, child, grand] = await Promise.all(
      [titles.root, titles.child, titles.grandchild].map(taskByTitle),
    );
    expect([root.depth, child.depth, grand.depth]).toEqual([1, 2, 3]);
    expect(child.parent_id).toBe(root.id);
    expect(grand.parent_id).toBe(child.id);

    // Cấp 4 qua API (giao diện chỉ ẩn ô): máy chủ từ chối 422 theo quy tắc nghiệp vụ.
    const res = await page.request.post(`/api/v1/projects/${projectId}/tasks`, {
      headers: originHeader(baseURL!),
      data: { title: titles.tooDeep, parent_id: grand.id },
    });
    expect(res.status()).toBe(422);
    const body = (await res.json()) as {
      error: { code: string; message: string };
    };
    expect(body.error.code).toBe("business_rule_violated");
    expect(body.error.message).toBe(strings.subtasks.errors.depthExceeded);

    // Bảng Danh sách hiện cây 3 cấp.
    await page.goto(`/projects/${projectId}/list`);
    const table = page.getByRole("table", { name: tl.tableLabel });
    const rowOf = (title: string) =>
      table
        .getByRole("row")
        .filter({ has: page.getByRole("link", { name: new RegExp(title) }) });
    await expect(rowOf(titles.grandchild)).toHaveAttribute("data-level", "3");
    await expect(rowOf(titles.child)).toHaveAttribute("data-level", "2");
    await expect(rowOf(titles.tooDeep)).toHaveCount(0);
  });

  await test.step("Xóa task cha còn việc con bị chặn, có giải thích", async () => {
    const root = await taskByTitle(titles.root);
    await page.goto(`/projects/${projectId}/tasks/${root.id}`);
    await expect(panel(page).locator('[data-field="label_ids"]')).toBeVisible();
    await panel(page).getByRole("button", { name: td.delete.action }).click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog.getByRole("heading")).toHaveText(
      strings.taskDelete.blockedTitle(titles.root),
    );
    await expect(
      dialog.getByRole("button", { name: td.delete.confirm }),
    ).toHaveCount(0);
    await expectNoA11yViolations(page, "hộp thoại chặn xóa", OPEN_DIALOG);
    await dialog.getByRole("button", { name: strings.ui.close }).click();
    await expect(dialog).toHaveCount(0);
    // Cả cây vẫn còn.
    const { data } = await service!
      .from("tasks")
      .select("id")
      .eq("project_id", projectId);
    expect(data).toHaveLength(3);
  });

  await close();
});
