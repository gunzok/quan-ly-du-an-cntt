import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { vi as strings } from "@/lib/i18n/messages/vi";

/**
 * Story E8-2 (QLDA-57): thêm, bỏ quan hệ trong ngăn chi tiết task (S05 v2).
 *
 * Như tests/e2e/task-detail.spec.ts: dự án và TÀI KHOẢN TẠM tạo bằng khóa service của stack CỤC BỘ,
 * mật khẩu ngẫu nhiên, không phụ thuộc SEED_PASSWORD. afterAll xóa dự án (kéo theo task, quan hệ)
 * và tài khoản tạm.
 */
const td = strings.taskDetail;
const ui = strings.taskRelationsUi;
const kinds = td.relations.kinds;
const BLOCKING_IMPACTS = new Set(["critical", "serious"]);
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const tag = randomUUID().slice(0, 8);
const password = `E2e-${randomUUID()}`;
const projectId = randomUUID();
const emails = {
  pm: `e2e-e8-2-pm-${tag}@example.com`,
  member: `e2e-e8-2-member-${tag}@example.com`,
  viewer: `e2e-e8-2-viewer-${tag}@example.com`,
};
type Who = keyof typeof emails;
const users = {} as Record<Who, string>;
const ids = {
  main: randomUUID(),
  login: randomUUID(),
  deploy: randomUUID(),
  docs: randomUUID(),
  memberOwn: randomUUID(),
  memberOther: randomUUID(),
};
const titles = {
  main: `Trang chủ ${tag}`,
  login: `Kiểm thử đăng nhập ${tag}`,
  deploy: `Triển khai máy chủ ${tag}`,
  docs: `Viết tài liệu ${tag}`,
  memberOwn: `Việc của thành viên ${tag}`,
  memberOther: `Việc của PM ${tag}`,
};

let service: SupabaseClient | null = null;

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
  for (const who of Object.keys(emails) as Who[]) {
    const { data, error } = await service.auth.admin.createUser({
      email: emails[who],
      password,
      email_confirm: true,
      user_metadata: { full_name: `${who} ${tag}` },
    });
    if (error) throw error;
    users[who] = data.user.id;
  }
  const project = await service.from("projects").insert({
    id: projectId,
    name: `E2E ${tag} Quan hệ`,
    created_by: users.pm,
  });
  if (project.error) throw project.error;
  const members = await service.from("project_members").insert([
    { project_id: projectId, user_id: users.member, role: "member" },
    { project_id: projectId, user_id: users.viewer, role: "viewer" },
  ]);
  if (members.error) throw members.error;
  const statuses = await service
    .from("task_statuses")
    .select("id, category")
    .eq("project_id", projectId);
  if (statuses.error) throw statuses.error;
  const todo = statuses.data.find((s) => s.category === "todo")!;
  const base = {
    project_id: projectId,
    created_by: users.pm,
    status_id: todo.id,
    priority: "medium",
    assignee_id: null as string | null,
  };
  const tasks = await service.from("tasks").insert([
    { ...base, id: ids.main, title: titles.main },
    { ...base, id: ids.login, title: titles.login },
    { ...base, id: ids.deploy, title: titles.deploy },
    { ...base, id: ids.docs, title: titles.docs },
    {
      ...base,
      id: ids.memberOwn,
      title: titles.memberOwn,
      assignee_id: users.member,
    },
    { ...base, id: ids.memberOther, title: titles.memberOther },
  ]);
  if (tasks.error) throw tasks.error;
  // Thành viên phụ trách memberOwn; memberOther (PM tạo, không giao) chặn memberOwn.
  const rel = await service.from("task_relations").insert({
    from_task_id: ids.memberOther,
    to_task_id: ids.memberOwn,
    kind: "blocks",
    created_by: users.pm,
  });
  if (rel.error) throw rel.error;
});

test.afterAll(async () => {
  if (!service) return;
  await service.from("projects").delete().eq("id", projectId);
  for (const id of Object.values(users)) {
    if (id) await service.auth.admin.deleteUser(id);
  }
});

async function signInAs(page: Page, who: Who) {
  await page.goto("/login");
  await page.getByLabel(strings.login.emailLabel).fill(emails[who]);
  await page.getByLabel(strings.login.passwordLabel).fill(password);
  await page
    .getByRole("button", { name: strings.login.submit, exact: true })
    .click();
  await expect(page).toHaveURL("/");
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

const panel = (page: Page) =>
  page.getByRole("complementary", { name: td.panelLabel });

/** Mở task, chờ phần quan hệ tải xong (danh sách hoặc dòng rỗng). */
async function openTask(page: Page, id: string) {
  await page.goto(`/projects/${projectId}/tasks/${id}`);
  const p = panel(page);
  await expect(p).toBeVisible();
  await expect(p.locator('[data-field="label_ids"]')).toBeVisible();
  await expect(
    p
      .getByRole("list", { name: td.relations.listLabel })
      .or(p.getByText(td.relations.empty)),
  ).toBeVisible();
  return p;
}

const relationList = (p: Locator) =>
  p.getByRole("list", { name: td.relations.listLabel });

const addButton = (p: Locator) =>
  p.getByRole("button", { name: `+ ${ui.add}` });

/** Mở hộp thoại, chọn kiểu, tìm và chọn task đích bằng bàn phím. */
async function addRelation(
  page: Page,
  p: Locator,
  kindLabel: string,
  search: string,
  targetTitle: string,
) {
  await addButton(p).click();
  const dialog = page.getByRole("dialog", { name: ui.dialogTitle });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel(ui.kindLabel).selectOption({ label: kindLabel });
  const combo = dialog.getByRole("combobox", { name: ui.targetLabel });
  await combo.fill(search);
  const listbox = dialog.getByRole("listbox", { name: ui.resultsLabel });
  await expect(listbox.getByRole("option")).toHaveText([
    new RegExp(targetTitle),
  ]);
  await combo.press("ArrowDown");
  await combo.press("Enter");
  await expect(dialog.getByTestId("relation-target-selected")).toContainText(
    targetTitle,
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

test.describe.serial("Quan hệ trong ngăn chi tiết task", () => {
  test("AC1: PM thêm 'Bị chặn bởi' bằng tìm không dấu và bàn phím, hiện ngay; đứng trước kèm độ trễ (sáng)", async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.setViewportSize({ width: 1280, height: 900 });
    await signInAs(page, "pm");
    const p = await openTask(page, ids.main);
    await expect(p.getByText(td.relations.empty)).toBeVisible();

    // Tìm gõ không dấu: "kiem thu dang nhap" khớp "Kiểm thử đăng nhập".
    const dialog = await addRelation(
      page,
      p,
      kinds.blocked_by,
      `kiem thu dang nhap ${tag}`,
      titles.login,
    );
    // Chính task đang xem không có trong gợi ý.
    expect(await blockingViolations(page)).toEqual([]);
    await dialog.getByRole("button", { name: ui.submit }).click();
    await expect(dialog).toHaveCount(0);

    const list = relationList(p);
    await expect(list.locator('[data-relation="blocked_by"]')).toContainText(
      titles.login,
    );
    await expect(p.getByRole("note")).toContainText(titles.login);
    // Lưu một chiều: task đích chặn task đang xem.
    expect(await relationRows(ids.login, ids.main)).toEqual([
      { kind: "blocks", lag_days: 0 },
    ]);

    // Đứng trước kèm độ trễ 2 ngày.
    const d2 = await addRelation(
      page,
      p,
      kinds.precedes,
      `trien khai ${tag}`,
      titles.deploy,
    );
    await d2.getByLabel(ui.lagLabel).fill("2");
    await d2.getByRole("button", { name: ui.submit }).click();
    await expect(d2).toHaveCount(0);
    await expect(list.locator('[data-relation="precedes"]')).toContainText(
      ui.lag(2),
    );
    expect(await relationRows(ids.main, ids.deploy)).toEqual([
      { kind: "precedes", lag_days: 2 },
    ]);

    // Tải lại vẫn còn, nhãn hai chiều đúng ở task đích.
    await page.reload();
    await expect(
      relationList(await openTask(page, ids.main)).locator("li"),
    ).toHaveCount(2);
    const other = await openTask(page, ids.login);
    await expect(
      relationList(other).locator('[data-relation="blocks"]'),
    ).toContainText(titles.main);
  });

  test("Tạo vòng bị từ chối với thông báo rõ; trùng cũng được giải thích", async ({
    page,
  }) => {
    await signInAs(page, "pm");
    const p = await openTask(page, ids.main);
    // Đăng nhập đã chặn Trang chủ; giờ Trang chủ chặn Đăng nhập → vòng.
    const dialog = await addRelation(
      page,
      p,
      kinds.blocks,
      `kiem thu ${tag}`,
      titles.login,
    );
    await dialog.getByRole("button", { name: ui.submit }).click();
    const alert = dialog.getByTestId("add-relation-error");
    await expect(alert).toContainText("tạo vòng");
    await expect(alert).toContainText(ui.errors.cycle);
    expect(await relationRows(ids.main, ids.login)).toEqual([]);

    // Cùng hộp thoại: đổi sang "Bị chặn bởi" (đã có) → 409 trùng.
    await dialog
      .getByLabel(ui.kindLabel)
      .selectOption({ label: kinds.blocked_by });
    await dialog.getByRole("button", { name: ui.submit }).click();
    await expect(alert).toContainText(ui.errors.duplicate);

    // Esc đóng hộp, danh sách không đổi.
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(relationList(p).locator("li")).toHaveCount(2);
  });

  test("Bỏ quan hệ có xác nhận, danh sách cập nhật ngay", async ({ page }) => {
    await signInAs(page, "pm");
    const p = await openTask(page, ids.main);
    const remove = p.getByRole("button", {
      name: ui.removeLabel(kinds.precedes, titles.deploy),
    });
    await remove.click();
    const confirm = page.getByRole("alertdialog");
    await expect(confirm).toContainText(
      ui.removeBody(kinds.precedes, titles.deploy),
    );
    // Hủy: không xóa.
    await confirm.getByRole("button", { name: strings.ui.cancel }).click();
    await expect(relationList(p).locator("li")).toHaveCount(2);

    await remove.click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: ui.removeConfirm })
      .click();
    await expect(
      relationList(p).locator('[data-relation="precedes"]'),
    ).toHaveCount(0);
    await expect(page.getByRole("status").getByText(ui.removed)).toBeVisible();
    expect(await relationRows(ids.main, ids.deploy)).toEqual([]);
  });

  test("AC2: Người xem không thấy nút thêm hoặc bỏ (tối)", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await signInAs(page, "viewer");
    const p = await openTask(page, ids.main);
    await expect(relationList(p).locator("li")).toHaveCount(1);
    await expect(addButton(p)).toHaveCount(0);
    await expect(p.getByTestId("add-relation")).toHaveCount(0);
    await expect(
      p.getByRole("button", { name: new RegExp(`^${ui.remove}`) }),
    ).toHaveCount(0);
    await expect(p.getByText(ui.locked)).toHaveCount(0);
    expect(await blockingViolations(page)).toEqual([]);
  });

  test("Thành viên: task không sửa được thì nút khóa kèm giải thích; task đích không sửa được bị khóa; bỏ quan hệ thiếu quyền báo 403", async ({
    page,
  }) => {
    await signInAs(page, "member");
    // Task của PM: nút bị khóa, có giải thích, không có nút bỏ.
    const other = await openTask(page, ids.main);
    await expect(addButton(other)).toHaveAttribute("aria-disabled", "true");
    await expect(other.getByText(ui.locked)).toBeVisible();
    // Bấm vẫn không mở hộp thoại (aria-disabled: nút giữ focus được, trình đọc màn hình đọc lý do).
    await addButton(other).click({ force: true });
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(
      other.getByRole("button", { name: new RegExp(`^${ui.remove}`) }),
    ).toHaveCount(0);

    // Task mình phụ trách: thêm được, nhưng task đích của PM bị khóa trong danh sách chọn.
    const own = await openTask(page, ids.memberOwn);
    await expect(addButton(own)).not.toHaveAttribute("aria-disabled", "true");
    await addButton(own).click();
    const dialog = page.getByRole("dialog", { name: ui.dialogTitle });
    const combo = dialog.getByRole("combobox", { name: ui.targetLabel });
    await combo.fill(`viet tai lieu ${tag}`);
    const option = dialog.getByRole("option", {
      name: new RegExp(titles.docs),
    });
    await expect(option).toHaveAttribute("aria-disabled", "true");
    await expect(option).toContainText(ui.cannotEditTarget);
    await combo.press("ArrowDown");
    await combo.press("Enter");
    await expect(dialog.getByTestId("relation-target-selected")).toHaveCount(0);
    await dialog.getByRole("button", { name: ui.submit }).click();
    await expect(dialog).toContainText(ui.targetRequired);
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);

    // Bỏ quan hệ với task PM (không sửa được): API 403, thông báo giải thích, dòng còn nguyên.
    await own
      .getByRole("button", {
        name: ui.removeLabel(kinds.blocked_by, titles.memberOther),
      })
      .click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: ui.removeConfirm })
      .click();
    await expect(page.getByText(ui.errors.forbidden)).toBeVisible();
    await expect(
      relationList(own).locator('[data-relation="blocked_by"]'),
    ).toContainText(titles.memberOther);
    expect(await relationRows(ids.memberOther, ids.memberOwn)).toHaveLength(1);
  });

  test("360 px, bàn phím: hộp thoại không tràn ngang, axe sạch (tối)", async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.setViewportSize({ width: 360, height: 780 });
    await signInAs(page, "pm");
    const p = await openTask(page, ids.docs);
    const add = addButton(p);
    await add.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: ui.dialogTitle });
    await expect(dialog).toBeVisible();
    await dialog
      .getByLabel(ui.kindLabel)
      .selectOption({ label: kinds.follows });
    await expect(dialog.getByLabel(ui.lagLabel)).toBeVisible();
    const combo = dialog.getByRole("combobox", { name: ui.targetLabel });
    await combo.focus();
    await page.keyboard.type(`trang chu ${tag}`);
    await expect(
      dialog
        .getByRole("listbox", { name: ui.resultsLabel })
        .getByRole("option"),
    ).toHaveCount(1);
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(dialog.getByTestId("relation-target-selected")).toContainText(
      titles.main,
    );
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      ),
    ).toBe(true);
    expect(await blockingViolations(page)).toEqual([]);

    await dialog.getByRole("button", { name: ui.submit }).focus();
    await page.keyboard.press("Enter");
    await expect(dialog).toHaveCount(0);
    await expect(
      relationList(p).locator('[data-relation="follows"]'),
    ).toContainText(titles.main);
    // Đứng sau Trang chủ = Trang chủ đứng trước Viết tài liệu.
    expect(await relationRows(ids.main, ids.docs)).toEqual([
      { kind: "precedes", lag_days: 0 },
    ]);
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      ),
    ).toBe(true);
    expect(await blockingViolations(page)).toEqual([]);
  });
});
