import type { SupabaseClient } from "@supabase/supabase-js";
import { expect, test, type Locator, type Page } from "@playwright/test";
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
  projectStatuses,
  type FlowUser,
} from "./support";

/**
 * Luồng 6 (test-strategy.md mục 4): đặt quan hệ "Bị chặn bởi" và "Đứng trước", thử tạo vòng (bị từ
 * chối), hoàn thành task bị chặn (được, kèm cảnh báo); lưu chế độ xem rồi dùng lại ở lần mở sau.
 * Luồng Gantt để đợt sau cùng E12.
 *
 * Chi tiết: task-relations.spec.ts (trùng, bỏ quan hệ, quyền), blocked-tasks.spec.ts (Kanban, banner),
 * saved-views-manage.spec.ts (đổi tên, công khai, 409).
 */
const tag = newTag();
const createdUsers: string[] = [];
const projectIds: string[] = [];
let service: SupabaseClient | null = null;
let pm: FlowUser;
let projectId = "";
const projectName = `E2E ${tag} Luồng 6`;
const titles = {
  main: `Triển khai cổng thông tin ${tag}`,
  blocker: `Kiểm thử đăng nhập ${tag}`,
  next: `Đào tạo người dùng ${tag}`,
};
const ids: Record<string, string> = {};
const viewName = `Việc ưu tiên cao ${tag}`;

test.beforeAll(async () => {
  service = serviceClient();
  ({ pm } = await createFlowUsers(
    service,
    6,
    tag,
    { pm: `E2E PM ${tag}` },
    createdUsers,
  ));
  projectId = await createProject(service, projectName, pm.id);
  projectIds.push(projectId);
  const [todo] = await projectStatuses(service, projectId);
  const base = { project_id: projectId, created_by: pm.id, status_id: todo.id };
  const { data, error } = await service
    .from("tasks")
    .insert([
      { ...base, title: titles.main, priority: "high" },
      { ...base, title: titles.blocker, priority: "medium" },
      { ...base, title: titles.next, priority: "low" },
    ])
    .select("id, title");
  if (error) throw error;
  for (const r of data) ids[r.title as string] = r.id as string;
});

test.afterAll(async () => {
  await cleanupTempData(service, { projectIds, userIds: createdUsers });
});

const td = strings.taskDetail;
const ui = strings.taskRelationsUi;
const kinds = td.relations.kinds;

const panelOf = (page: Page) =>
  page.getByRole("complementary", { name: td.panelLabel });

/** Mở hộp thoại thêm quan hệ, chọn kiểu, gõ tìm và chọn task đích bằng bàn phím. */
async function startRelation(
  page: Page,
  panel: Locator,
  kindLabel: string,
  search: string,
  target: string,
) {
  await panel.getByRole("button", { name: `+ ${ui.add}` }).click();
  const dialog = page.getByRole("dialog", { name: ui.dialogTitle });
  await dialog.getByLabel(ui.kindLabel).selectOption({ label: kindLabel });
  const combo = dialog.getByRole("combobox", { name: ui.targetLabel });
  await combo.fill(search);
  await expect(
    dialog.getByRole("listbox", { name: ui.resultsLabel }).getByRole("option"),
  ).toHaveText([new RegExp(target)]);
  await combo.press("ArrowDown");
  await combo.press("Enter");
  await expect(dialog.getByTestId("relation-target-selected")).toContainText(
    target,
  );
  return dialog;
}

async function relationRows(from: string, to: string) {
  const { data, error } = await service!
    .from("task_relations")
    .select("kind, lag_days")
    .eq("from_task_id", from)
    .eq("to_task_id", to);
  if (error) throw error;
  return data;
}

test("Luồng 6: chặn và đứng trước → vòng bị từ chối → hoàn thành task bị chặn có cảnh báo → lưu và dùng lại chế độ xem", async ({
  browser,
  baseURL,
}) => {
  const state = await loginState(browser, baseURL!, pm);
  const { page, close } = await openAs(browser, baseURL!, state);
  const panel = panelOf(page);

  await test.step("Đặt 'Bị chặn bởi' (tìm không dấu) và 'Đứng trước' kèm độ trễ", async () => {
    await page.goto(`/projects/${projectId}/tasks/${ids[titles.main]}`);
    await expect(panel.locator('[data-field="label_ids"]')).toBeVisible();
    const blocked = await startRelation(
      page,
      panel,
      kinds.blocked_by,
      `kiem thu dang nhap ${tag}`,
      titles.blocker,
    );
    await expectNoA11yViolations(page, "hộp thoại thêm quan hệ", OPEN_DIALOG);
    await blocked.getByRole("button", { name: ui.submit }).click();
    await expect(blocked).toHaveCount(0);
    const list = panel.getByRole("list", { name: td.relations.listLabel });
    await expect(list.locator('[data-relation="blocked_by"]')).toContainText(
      titles.blocker,
    );
    // Cảnh báo bị chặn hiện ngay ở ngăn chi tiết.
    await expect(panel.getByTestId("blocked-banner")).toContainText(
      titles.blocker,
    );

    const precedes = await startRelation(
      page,
      panel,
      kinds.precedes,
      `dao tao ${tag}`,
      titles.next,
    );
    await precedes.getByLabel(ui.lagLabel).fill("2");
    await precedes.getByRole("button", { name: ui.submit }).click();
    await expect(precedes).toHaveCount(0);
    await expect(list.locator('[data-relation="precedes"]')).toContainText(
      ui.lag(2),
    );
    expect(await relationRows(ids[titles.blocker], ids[titles.main])).toEqual([
      { kind: "blocks", lag_days: 0 },
    ]);
    expect(await relationRows(ids[titles.main], ids[titles.next])).toEqual([
      { kind: "precedes", lag_days: 2 },
    ]);
    await expectNoA11yViolations(page, "ngăn chi tiết có quan hệ");
  });

  await test.step("Tạo vòng (task đang bị chặn lại chặn task chặn nó) bị từ chối", async () => {
    const cycle = await startRelation(
      page,
      panel,
      kinds.blocks,
      `kiem thu ${tag}`,
      titles.blocker,
    );
    await cycle.getByRole("button", { name: ui.submit }).click();
    await expect(cycle.getByTestId("add-relation-error")).toContainText(
      ui.errors.cycle,
    );
    expect(await relationRows(ids[titles.main], ids[titles.blocker])).toEqual(
      [],
    );
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await expect(cycle).toHaveCount(0);
  });

  await test.step("Hoàn thành task đang bị chặn: lưu được, kèm cảnh báo nêu task chặn", async () => {
    const statuses = await projectStatuses(service!, projectId);
    const done = statuses.find((s) => s.category === "done")!;
    await panel.getByLabel(td.fields.status_id).selectOption(done.id);
    const toast = page.getByRole("status").filter({
      hasText: strings.blockedTask.toastTitle(titles.main),
    });
    await expect(toast).toBeVisible();
    await expect(toast).toContainText(titles.blocker);
    await expect(panel.getByTestId("task-save-status")).toContainText(
      td.save.saved(td.fields.status_id),
    );
    await expect
      .poll(async () => {
        const { data } = await service!
          .from("tasks")
          .select("completed_at")
          .eq("id", ids[titles.main])
          .single();
        return data?.completed_at ?? null;
      })
      .not.toBeNull();
  });

  await test.step("Lưu chế độ xem từ bộ lọc, mở lại ở trang mới và dùng lại", async () => {
    const tl = strings.taskList;
    const m = strings.savedViewsManage;
    const sv = strings.savedViewsMenu;
    const titlesOnList = () =>
      page
        .getByRole("table", { name: tl.tableLabel })
        .locator('[data-testid="task-list-row"] a')
        .evaluateAll((els) =>
          els.map((e) => e.querySelector("span")?.textContent ?? ""),
        );
    await page.goto(`/projects/${projectId}/list`);
    await expect.poll(async () => (await titlesOnList()).length).toBe(3);
    await page
      .getByRole("combobox", { name: tl.filters.priority })
      .selectOption("high");
    await expect.poll(titlesOnList).toEqual([titles.main]);
    const actions = page.getByRole("group", { name: m.actionsLabel });
    await actions.getByRole("button", { name: m.saveNew, exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel(m.dialog.name).fill(viewName);
    await dialog
      .getByRole("button", { name: m.dialog.save, exact: true })
      .click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByTestId("current-view-name")).toHaveText(viewName);

    // Lần mở sau (trang mới, không có ?view=): chọn lại từ mục "Của tôi".
    const again = await page.context().newPage();
    await again.goto(`/projects/${projectId}/list`);
    const listAgain = () =>
      again
        .getByRole("table", { name: tl.tableLabel })
        .locator('[data-testid="task-list-row"] a')
        .evaluateAll((els) =>
          els.map((e) => e.querySelector("span")?.textContent ?? ""),
        );
    await expect.poll(async () => (await listAgain()).length).toBe(3);
    await again
      .getByRole("complementary", { name: sv.regionLabel })
      .getByRole("region", { name: sv.sections.mine })
      .getByRole("button", { name: viewName, exact: true })
      .click();
    await expect(again.getByTestId("current-view-name")).toHaveText(viewName);
    await expect.poll(listAgain).toEqual([titles.main]);
    await expect(
      again.getByRole("combobox", { name: tl.filters.priority }),
    ).toHaveValue("high");
    await expectNoA11yViolations(again, "chế độ xem đã lưu");
  });

  await close();
});
