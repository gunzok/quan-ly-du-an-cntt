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
  openAs,
  projectStatuses,
  type FlowUser,
} from "./support";

/**
 * Luồng 5 (test-strategy.md mục 4): kéo thả Kanban; chuyển sang bảng Danh sách phân cấp; tìm kiếm
 * không dấu và lọc; dùng chế độ xem đã lưu (mặc định "Trễ hạn"), giữ khi tải lại.
 *
 * Task dựng sẵn bằng khóa service; mọi thao tác của PM qua giao diện. Chi tiết: kanban.spec.ts (bàn
 * phím, menu chuyển cột, BR-04), task-list.spec.ts (thu gọn, nhóm, cột), saved-views.spec.ts.
 */
const tag = newTag();
const createdUsers: string[] = [];
const projectIds: string[] = [];
let service: SupabaseClient | null = null;
let pm: FlowUser;
let projectId = "";
const projectName = `E2E ${tag} Luồng 5`;
const titles = {
  urgent: `Sửa lỗi đăng nhập ${tag}`,
  parent: `Viết tài liệu vận hành ${tag}`,
  child: `Mục lục tài liệu ${tag}`,
  drag: `Cài đặt máy in ${tag}`,
};
let columns: { id: string; name: string; category: string }[] = [];
const ids: Record<string, string> = {};

test.beforeAll(async () => {
  service = serviceClient();
  ({ pm } = await createFlowUsers(
    service,
    5,
    tag,
    { pm: `E2E PM ${tag}` },
    createdUsers,
  ));
  projectId = await createProject(service, projectName, pm.id);
  projectIds.push(projectId);
  columns = await projectStatuses(service, projectId);
  const base = {
    project_id: projectId,
    created_by: pm.id,
    status_id: columns[0].id,
  };
  const rows = [
    {
      ...base,
      title: titles.urgent,
      priority: "urgent",
      assignee_id: pm.id,
      due_date: "2020-01-01",
    },
    { ...base, title: titles.parent, priority: "medium" },
    { ...base, title: titles.drag, priority: "low" },
  ];
  const { data, error } = await service
    .from("tasks")
    .insert(rows)
    .select("id, title");
  if (error) throw error;
  for (const r of data) ids[r.title as string] = r.id as string;
  const child = await service
    .from("tasks")
    .insert({ ...base, title: titles.child, parent_id: ids[titles.parent] })
    .select("id")
    .single();
  if (child.error) throw child.error;
});

test.afterAll(async () => {
  await cleanupTempData(service, { projectIds, userIds: createdUsers });
});

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

async function visibleTitles(page: Page) {
  return page
    .getByRole("table", { name: strings.taskList.tableLabel })
    .locator('[data-testid="task-list-row"] a')
    .evaluateAll((els) =>
      els.map((e) => e.querySelector("span")?.textContent ?? ""),
    );
}

test("Luồng 5: Kanban kéo thả → bảng Danh sách phân cấp → tìm không dấu, lọc → chế độ xem đã lưu", async ({
  browser,
  baseURL,
}) => {
  const kb = strings.kanban;
  const tl = strings.taskList;
  const sv = strings.savedViewsMenu;
  const state = await loginState(browser, baseURL!, pm);
  const { page, close } = await openAs(browser, baseURL!, state);
  const board = page.getByRole("region", { name: kb.boardLabel });
  const column = (name: string) =>
    board.getByRole("list", { name: new RegExp(`^${escape(name)}$`) });

  await test.step("Kanban: kéo thẻ bằng chuột sang cột kế, trạng thái được lưu", async () => {
    await page.goto(`/projects/${projectId}`);
    await expect(
      page.getByRole("heading", { level: 1, name: projectName }),
    ).toBeVisible();
    await expect(column(columns[0].name)).toContainText(titles.drag);
    await expectNoA11yViolations(page, "Kanban");

    const handle = page.getByRole("button", {
      name: kb.card.dragHandle(titles.drag),
    });
    const target = column(columns[1].name);
    const from = (await handle.boundingBox())!;
    const to = (await target.boundingBox())!;
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(from.x + 20, from.y + 20, { steps: 5 });
    await page.mouse.move(to.x + to.width / 2, to.y + 30, { steps: 15 });
    await page.mouse.move(to.x + to.width / 2, to.y + 32, { steps: 2 });
    await page.mouse.up();
    await expect(target).toContainText(titles.drag);
    await expect
      .poll(async () => {
        const { data } = await service!
          .from("tasks")
          .select("status_id")
          .eq("id", ids[titles.drag])
          .single();
        return data?.status_id;
      })
      .toBe(columns[1].id);
    await page.reload();
    await expect(column(columns[1].name)).toContainText(titles.drag);
  });

  await test.step("Chuyển sang bảng Danh sách: cây phân cấp", async () => {
    await page
      .getByRole("navigation", { name: strings.projectNav.navLabel })
      .getByRole("link", { name: new RegExp(`${tl.navTab}$`) })
      .click();
    await expect(page).toHaveURL(`/projects/${projectId}/list`);
    const table = page.getByRole("table", { name: tl.tableLabel });
    const rowOf = (title: string) =>
      table
        .getByRole("row")
        .filter({ has: page.getByRole("link", { name: new RegExp(title) }) });
    await expect(rowOf(titles.child)).toHaveAttribute("data-level", "2");
    await expect(rowOf(titles.parent)).toHaveAttribute("data-level", "1");
    await expect.poll(async () => (await visibleTitles(page)).length).toBe(4);
    await expectNoA11yViolations(page, "bảng Danh sách");
  });

  await test.step("Tìm kiếm không dấu và lọc theo ưu tiên", async () => {
    const search = page.getByRole("searchbox", { name: tl.filters.search });
    await search.fill(`sua loi dang nhap ${tag}`);
    await expect(
      page.getByRole("status").filter({ hasText: tl.resultCount(1) }),
    ).toBeVisible();
    await expect.poll(() => visibleTitles(page)).toEqual([titles.urgent]);
    // Tìm việc con: tổ tiên hiện làm ngữ cảnh.
    await search.fill(`muc luc tai lieu ${tag}`);
    await expect
      .poll(() => visibleTitles(page))
      .toEqual([titles.parent, titles.child]);
    await page.getByRole("button", { name: tl.clearFilters }).first().click();
    await page
      .getByRole("combobox", { name: tl.filters.priority })
      .selectOption("low");
    await expect.poll(() => visibleTitles(page)).toEqual([titles.drag]);
    await page.getByRole("button", { name: tl.clearFilters }).first().click();
    await expect.poll(async () => (await visibleTitles(page)).length).toBe(4);
  });

  await test.step("Dùng chế độ xem đã lưu 'Trễ hạn', giữ sau khi tải lại", async () => {
    const menu = page.getByRole("complementary", { name: sv.regionLabel });
    await menu
      .getByRole("button", { name: sv.names.overdue, exact: true })
      .click();
    const current = page.getByTestId("current-view-name");
    await expect(current).toHaveText(sv.names.overdue);
    await expect.poll(() => visibleTitles(page)).toEqual([titles.urgent]);
    await expect(page).toHaveURL(/\?view=[0-9a-f-]{36}$/);
    await page.reload();
    await expect(current).toHaveText(sv.names.overdue);
    await expect.poll(() => visibleTitles(page)).toEqual([titles.urgent]);
    await expectNoA11yViolations(page, "chế độ xem Trễ hạn");
  });

  await close();
});
