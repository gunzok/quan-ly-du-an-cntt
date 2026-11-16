import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";
import { vi as strings } from "@/lib/i18n/messages/vi";

/**
 * Story E2-5 (QLDA-46): ngăn chi tiết task (S05 v2).
 *
 * Dùng dự án và TÀI KHOẢN TẠM tạo bằng khóa service của stack CỤC BỘ (make test-e2e đặt
 * SUPABASE_SERVICE_ROLE_KEY), mật khẩu ngẫu nhiên mỗi lần chạy: không đụng persona của db-seed nên
 * an toàn trên stack dùng chung. afterAll xóa dự án (kéo theo task, nhãn...) và tài khoản tạm.
 */
const t = strings.taskDetail;
const BLOCKING_IMPACTS = new Set(["critical", "serious"]);
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const tag = randomUUID().slice(0, 8);
const password = `E2e-${randomUUID()}`;
const projectId = randomUUID();
const projectName = `E2E ${tag} Chi tiết task`;
const emails = {
  pm: `e2e-e2-5-pm-${tag}@example.com`,
  member: `e2e-e2-5-member-${tag}@example.com`,
  viewer: `e2e-e2-5-viewer-${tag}@example.com`,
  outsider: `e2e-e2-5-outsider-${tag}@example.com`,
};
type Who = keyof typeof emails;
const users = {} as Record<Who, string>;
const ids = {
  main: randomUUID(),
  child: randomUUID(),
  grandchild: randomUUID(),
  memberOwn: randomUUID(),
  removable: randomUUID(),
  removableChild: randomUUID(),
};
const DESCRIPTION = "Dòng một\nDòng hai <b>không đậm</b>";

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

const names = {
  pm: `PM ${tag}`,
  member: `Thành viên ${tag}`,
  viewer: `Người xem ${tag}`,
  outsider: `Người ngoài ${tag}`,
};

test.beforeAll(async () => {
  service = serviceClient();
  for (const who of Object.keys(emails) as Who[]) {
    const { data, error } = await service.auth.admin.createUser({
      email: emails[who],
      password,
      email_confirm: true,
      user_metadata: { full_name: names[who] },
    });
    if (error) throw error;
    users[who] = data.user.id;
  }
  const project = await service
    .from("projects")
    .insert({ id: projectId, name: projectName, created_by: users.pm });
  if (project.error) throw project.error;
  const members = await service.from("project_members").insert([
    { project_id: projectId, user_id: users.member, role: "member" },
    { project_id: projectId, user_id: users.viewer, role: "viewer" },
  ]);
  if (members.error) throw members.error;

  const [statuses, types] = await Promise.all([
    service
      .from("task_statuses")
      .select("id, name, category")
      .eq("project_id", projectId),
    service.from("task_types").select("id, name").eq("project_id", projectId),
  ]);
  if (statuses.error) throw statuses.error;
  if (types.error) throw types.error;
  const todo = statuses.data.find((s) => s.category === "todo")!;
  const labels = await service
    .from("labels")
    .insert([
      { project_id: projectId, name: `Giao diện ${tag}` },
      { project_id: projectId, name: `Tính năng ${tag}` },
    ])
    .select("id");
  if (labels.error) throw labels.error;

  const base = {
    project_id: projectId,
    created_by: users.pm,
    status_id: todo.id,
    type_id: types.data[0].id,
    // Chèn nhiều dòng một lần: cột thiếu ở dòng nào thành null, nên đặt đủ cột NOT NULL ở đây.
    priority: "medium",
  };
  const tasks = await service.from("tasks").insert([
    {
      ...base,
      id: ids.main,
      title: `Task chính ${tag}`,
      description: DESCRIPTION,
      assignee_id: users.pm,
      priority: "high",
      start_date: "2026-12-01",
      due_date: "2026-12-10",
    },
    {
      ...base,
      id: ids.memberOwn,
      title: `Task của thành viên ${tag}`,
      assignee_id: users.member,
    },
    { ...base, id: ids.removable, title: `Task sẽ xóa ${tag}` },
  ]);
  if (tasks.error) throw tasks.error;
  const children = await service.from("tasks").insert([
    { ...base, id: ids.child, parent_id: ids.main, title: `Việc con ${tag}` },
    {
      ...base,
      id: ids.removableChild,
      parent_id: ids.removable,
      title: `Con của task sẽ xóa ${tag}`,
    },
  ]);
  if (children.error) throw children.error;
  const grand = await service.from("tasks").insert({
    ...base,
    id: ids.grandchild,
    parent_id: ids.child,
    title: `Việc cháu ${tag}`,
  });
  if (grand.error) throw grand.error;
  const tl = await service
    .from("task_labels")
    .insert(
      labels.data.map((l) => ({ task_id: ids.main, label_id: l.id as string })),
    );
  if (tl.error) throw tl.error;
  const rel = await service.from("task_relations").insert({
    from_task_id: ids.memberOwn,
    to_task_id: ids.main,
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
  page.getByRole("complementary", { name: t.panelLabel });

async function openTask(page: Page, id: string) {
  await page.goto(`/projects/${projectId}/tasks/${id}`);
  const p = panel(page);
  await expect(p).toBeVisible();
  // Chờ thuộc tính (cấu hình, thành viên) tải xong.
  await expect(p.locator('[data-field="label_ids"]')).toBeVisible();
  return p;
}

const field = (page: Page, name: string) =>
  panel(page).locator(`[data-field="${name}"]`);

test.describe.serial("Ngăn chi tiết task", () => {
  test("AC1: PM thấy đủ thông tin; sửa trạng thái rồi tải lại còn nguyên; lỗi 422 ngày hiện rõ (sáng)", async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.setViewportSize({ width: 1280, height: 900 });
    await signInAs(page, "pm");
    const p = await openTask(page, ids.main);

    await expect(
      p.getByRole("heading", { level: 1, name: `Task chính ${tag}` }),
    ).toBeVisible();
    // Loại, trạng thái, người phụ trách, ưu tiên, ngày, nhãn: PM sửa được nên là ô chọn/nhập.
    await expect(p.getByLabel(t.fields.type_id)).toBeVisible();
    await expect(p.getByLabel(t.fields.status_id)).toBeVisible();
    await expect(p.getByLabel(t.fields.assignee_id)).toHaveValue(users.pm);
    await expect(p.getByLabel(t.fields.priority)).toHaveValue("high");
    await expect(p.getByLabel(t.fields.start_date)).toHaveValue("2026-12-01");
    await expect(p.getByLabel(t.fields.due_date)).toHaveValue("2026-12-10");
    await expect(field(page, "label_ids")).toContainText(`Giao diện ${tag}`);
    await expect(field(page, "label_ids")).toContainText(`Tính năng ${tag}`);
    // Mô tả: văn bản thuần, giữ xuống dòng, không render HTML.
    const description = p.getByTestId("task-description");
    await expect(description).toHaveText(DESCRIPTION, { useInnerText: true });
    await expect(description.locator("b")).toHaveCount(0);
    // Việc con (cả cấp cháu), quan hệ hai chiều (chỉ xem), cảnh báo bị chặn.
    const subtasks = p.getByRole("list", { name: t.subtasks.listLabel });
    await expect(subtasks.getByRole("link")).toHaveText([
      `Việc con ${tag}`,
      `Việc cháu ${tag}`,
    ]);
    const relations = p.getByRole("list", { name: t.relations.listLabel });
    await expect(relations).toContainText(t.relations.kinds.blocked_by);
    await expect(relations).toContainText(`Task của thành viên ${tag}`);
    await expect(p.getByRole("button", { name: /quan hệ/i })).toHaveCount(0);
    await expect(p.getByRole("note")).toContainText(
      `Task của thành viên ${tag}`,
    );

    expect(await blockingViolations(page)).toEqual([]);

    // Sửa ưu tiên → đã lưu → tải lại vẫn còn.
    await p.getByLabel(t.fields.priority).selectOption("low");
    await expect(p.getByTestId("task-save-status")).toContainText(
      t.save.saved(t.fields.priority),
    );
    await page.reload();
    await expect(
      (await openTask(page, ids.main)).getByLabel(t.fields.priority),
    ).toHaveValue("low");

    // Hoàn tác: về giá trị cũ.
    await p.getByLabel(t.fields.priority).selectOption("urgent");
    await p.getByRole("button", { name: t.save.undo }).click();
    await expect(p.getByTestId("task-save-status")).toContainText(
      t.save.undone(t.fields.priority),
    );
    await expect(p.getByLabel(t.fields.priority)).toHaveValue("low");

    // Hạn sớm hơn ngày bắt đầu: 422, thông báo dễ hiểu dưới ô, ô về giá trị đã lưu.
    const due = p.getByLabel(t.fields.due_date);
    await due.fill("2026-11-20");
    await due.press("Enter");
    await expect(field(page, "due_date").getByRole("alert")).toHaveText(
      strings.tasks.errors.dateOrder,
    );
    await expect(due).toHaveValue("2026-12-10");

    // Tiêu đề sửa tại chỗ.
    await p.getByRole("button", { name: t.title.edit }).click();
    await p.getByLabel(t.title.label).fill(`Task chính đã sửa ${tag}`);
    await p.getByLabel(t.title.label).press("Enter");
    await expect(
      p.getByRole("heading", { level: 1, name: `Task chính đã sửa ${tag}` }),
    ).toBeVisible();
  });

  test("Việc con: thêm nhanh; đóng task cha còn việc con mở bị chặn (BR-04); cấp 3 không thêm được", async ({
    page,
  }) => {
    await signInAs(page, "pm");
    const p = await openTask(page, ids.main);
    await p.getByLabel(t.subtasks.addLabel).fill(`Việc con mới ${tag}`);
    await p.getByRole("button", { name: `+ ${t.subtasks.add}` }).click();
    await expect(
      p
        .getByRole("list", { name: t.subtasks.listLabel })
        .getByRole("link", { name: `Việc con mới ${tag}` }),
    ).toBeVisible();

    // BR-04: chuyển task cha sang trạng thái nhóm "xong" khi còn việc con chưa xong.
    const status = p.getByLabel(t.fields.status_id);
    const doneName = await service!
      .from("task_statuses")
      .select("name")
      .eq("project_id", projectId)
      .eq("category", "done")
      .order("position")
      .limit(1)
      .single();
    await status.selectOption({ label: doneName.data!.name as string });
    await expect(field(page, "status_id").getByRole("alert")).toHaveText(
      strings.subtasks.errors.openSubtasks,
    );

    // Việc cháu ở cấp 3: không có ô thêm, có giải thích.
    const g = await openTask(page, ids.grandchild);
    await expect(g.getByText(t.subtasks.maxDepth)).toBeVisible();
    await expect(g.getByLabel(t.subtasks.addLabel)).toHaveCount(0);
    await expect(
      g.getByRole("link", { name: `Việc con ${tag}` }),
    ).toBeVisible();
  });

  test("AC2: Người xem chỉ đọc mọi trường (tối)", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await signInAs(page, "viewer");
    const p = await openTask(page, ids.main);
    await expect(p.getByTestId("task-read-only")).toContainText(
      t.readOnly.viewer,
    );
    await expect(p.getByRole("combobox")).toHaveCount(0);
    await expect(p.getByRole("textbox")).toHaveCount(0);
    await expect(p.locator('input[type="date"]')).toHaveCount(0);
    for (const name of [
      t.title.edit,
      t.description.edit,
      t.labels.edit,
      t.delete.action,
      `+ ${t.subtasks.add}`,
    ]) {
      await expect(p.getByRole("button", { name })).toHaveCount(0);
    }
    await expect(field(page, "label_ids")).toContainText(`Giao diện ${tag}`);
    expect(await blockingViolations(page)).toEqual([]);
  });

  test("Thành viên: task người khác bị khóa kèm giải thích; task mình phụ trách sửa được, không giao đi", async ({
    page,
  }) => {
    await signInAs(page, "member");
    const other = await openTask(page, ids.main);
    await expect(other.getByTestId("task-read-only")).toContainText(
      t.readOnly.notOwner,
    );
    await expect(other.getByRole("combobox")).toHaveCount(0);

    const own = await openTask(page, ids.memberOwn);
    await expect(own.getByTestId("task-read-only")).toHaveCount(0);
    await expect(own.getByLabel(t.fields.status_id)).toBeEnabled();
    await expect(own.getByRole("button", { name: t.title.edit })).toBeVisible();
    // Chỉ phụ trách, không tạo: không đổi người phụ trách, không xóa.
    await expect(own.getByLabel(t.fields.assignee_id)).toHaveCount(0);
    await expect(field(page, "assignee_id")).toContainText(t.reassignLocked);
    await expect(
      own.getByRole("button", { name: t.delete.action }),
    ).toHaveCount(0);
  });

  test("Người ngoài dự án: 404, không lộ tiêu đề task", async ({ page }) => {
    await signInAs(page, "outsider");
    // notFound() trong Suspense: mã HTTP vẫn 200, nội dung là 404.
    await page.goto(`/projects/${projectId}/tasks/${ids.main}`);
    await expect(page.getByRole("heading", { name: "404" })).toBeVisible();
    await expect(page.getByText(`Task chính`)).toHaveCount(0);
  });

  test("360 px, bàn phím: toàn trang, không tràn ngang; xóa task cha nói rõ xóa cả việc con (tối)", async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.setViewportSize({ width: 360, height: 780 });
    await signInAs(page, "pm");
    const p = await openTask(page, ids.removable);
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      ),
    ).toBe(true);
    expect(await blockingViolations(page)).toEqual([]);

    const remove = p.getByRole("button", { name: t.delete.action });
    await remove.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toContainText(t.delete.bodyWithSubtasks(1));
    // Focus mặc định ở Hủy: Enter không xóa nhầm.
    await page.keyboard.press("Enter");
    await expect(dialog).toHaveCount(0);

    await remove.click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: t.delete.confirm })
      .click();
    await expect(page).toHaveURL(`/projects/${projectId}`);
    const gone = await service!
      .from("tasks")
      .select("id")
      .in("id", [ids.removable, ids.removableChild]);
    expect(gone.data).toEqual([]);
  });
});
