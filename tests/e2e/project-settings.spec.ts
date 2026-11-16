import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";
import { vi as strings } from "@/lib/i18n/messages/vi";
import { e2ePassword } from "./env";
import { waitForHydration } from "./hydration";

/**
 * Story E2-3 (QLDA-41): màn cấu hình dự án (trạng thái, loại task, nhãn).
 * Dùng một dự án tạm tạo bằng khóa service của stack CỤC BỘ (make test-e2e đặt
 * SUPABASE_SERVICE_ROLE_KEY): member@example.com là PM, viewer@example.com là Người xem. Dự án seed
 * chỉ được đọc; afterAll xóa dự án tạm (xóa theo trạng thái, loại, nhãn, task).
 */
const t = strings.projectConfig;
const BLOCKING_IMPACTS = new Set(["critical", "serious"]);
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const tag = randomUUID().slice(0, 8);
const projectName = `E2E ${tag} Cấu hình`;
const projectId = randomUUID();

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

async function userId(client: SupabaseClient, email: string) {
  const { data, error } = await client
    .from("profiles")
    .select("id")
    .eq("email", email)
    .single();
  if (error) throw error;
  return data.id as string;
}

test.beforeAll(async () => {
  service = serviceClient();
  const pm = await userId(service, "member@example.com");
  const viewer = await userId(service, "viewer@example.com");
  const project = await service
    .from("projects")
    .insert({ id: projectId, name: projectName, created_by: pm });
  if (project.error) throw project.error;
  const member = await service
    .from("project_members")
    .insert({ project_id: projectId, user_id: viewer, role: "viewer" });
  if (member.error) throw member.error;
  // Một task ở "Đang thực hiện" để thử xóa trạng thái đang có task (AC2).
  const doing = await service
    .from("task_statuses")
    .select("id")
    .eq("project_id", projectId)
    .eq("name", "Đang thực hiện")
    .single();
  if (doing.error) throw doing.error;
  const task = await service.from("tasks").insert({
    project_id: projectId,
    title: `E2E ${tag} task`,
    created_by: pm,
    status_id: doing.data.id,
  });
  if (task.error) throw task.error;
});

test.afterAll(async () => {
  if (service) await service.from("projects").delete().eq("id", projectId);
});

async function signInAs(page: Page, email: string) {
  await page.goto("/login");
  await waitForHydration(page);
  await page.getByLabel(strings.login.emailLabel).fill(email);
  await page.getByLabel(strings.login.passwordLabel).fill(e2ePassword());
  await page
    .getByRole("button", { name: strings.login.submit, exact: true })
    .click();
  await expect(page).toHaveURL("/");
}

async function blockingViolations(page: Page, include?: string) {
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getComputedTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => undefined)),
    ),
  );
  let builder = new AxeBuilder({ page }).withTags(WCAG_TAGS);
  if (include) builder = builder.include(include);
  const results = await builder.analyze();
  return results.violations
    .filter((v) => v.impact && BLOCKING_IMPACTS.has(v.impact))
    .flatMap((v) => v.nodes.map((n) => `${v.id} @ ${n.target.join(" ")}`));
}

const list = (page: Page, kind: keyof typeof t.kinds) =>
  page.getByRole("list", { name: t.kinds[kind].listLabel });
const rowNames = (page: Page, kind: keyof typeof t.kinds) =>
  list(page, kind)
    .getByRole("listitem")
    .locator("span.font-medium")
    .allInnerTexts();
// Khớp đúng ô tên (huy hiệu nhóm "Đang thực hiện" có thể trùng tên một trạng thái).
const row = (page: Page, kind: keyof typeof t.kinds, name: string) =>
  list(page, kind)
    .getByRole("listitem")
    .filter({
      has: page.locator("span.font-medium", {
        hasText: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`),
      }),
    });

test.describe.serial("Cấu hình dự án", () => {
  test("PM: mặc định, thêm, đổi thứ tự bằng bàn phím, sửa, xóa có chuyển task (sáng)", async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await signInAs(page, "member@example.com");

    // Lối vào từ thẻ dự án ở trang chủ.
    await page
      .getByRole("link", { name: `${t.openSettings} ${projectName}` })
      .click();
    await expect(page).toHaveURL(`/projects/${projectId}/settings`);
    await expect(
      page.getByRole("heading", { level: 1, name: t.heading }),
    ).toBeVisible();

    // AC1: 7 trạng thái mặc định.
    await expect(list(page, "statuses").getByRole("listitem")).toHaveCount(7);
    expect(await rowNames(page, "statuses")).toEqual([
      "Mới",
      "Đang thực hiện",
      "Đang kiểm thử",
      "Cần phản hồi",
      "Đã xong",
      "Đã đóng",
      "Từ chối",
    ]);
    expect(await blockingViolations(page)).toEqual([]);

    // Thêm trạng thái.
    await page
      .getByRole("button", { name: `+ ${t.kinds.statuses.add}` })
      .click();
    const form = page.getByRole("dialog", { name: t.kinds.statuses.addTitle });
    await expect(form).toBeVisible();
    await form.getByLabel(t.form.name).fill("Chờ duyệt");
    await form.getByLabel(t.form.category).selectOption("in_progress");
    await form.getByLabel(t.form.color).selectOption("#E56DAF");
    expect(await blockingViolations(page, '[role="dialog"]')).toEqual([]);
    await form.getByRole("button", { name: t.form.add }).click();
    await expect(form).toBeHidden();
    await expect(row(page, "statuses", "Chờ duyệt")).toBeVisible();
    expect((await rowNames(page, "statuses")).at(-1)).toBe("Chờ duyệt");

    // Đổi thứ tự bằng bàn phím: focus nút "lên" rồi Enter; focus ở lại để bấm tiếp.
    const up = page.getByRole("button", {
      name: t.actions.moveUpAction("Chờ duyệt"),
    });
    await up.focus();
    await page.keyboard.press("Enter");
    await expect
      .poll(async () => (await rowNames(page, "statuses")).at(-2))
      .toBe("Chờ duyệt");
    await expect(up).toBeFocused();
    await page.keyboard.press("Enter");
    await expect
      .poll(async () => (await rowNames(page, "statuses")).at(-3))
      .toBe("Chờ duyệt");

    // Sửa tên.
    await row(page, "statuses", "Chờ duyệt")
      .getByRole("button", { name: `${t.actions.edit} Chờ duyệt` })
      .click();
    const edit = page.getByRole("dialog", {
      name: t.kinds.statuses.editTitle("Chờ duyệt"),
    });
    await edit.getByLabel(t.form.name).fill("Chờ khách duyệt");
    await edit.getByRole("button", { name: t.form.save }).click();
    await expect(row(page, "statuses", "Chờ khách duyệt")).toBeVisible();

    // AC2: xóa trạng thái đang có task phải chọn trạng thái thay thế.
    await expect(row(page, "statuses", "Đang thực hiện")).toContainText(
      t.taskCount(1),
    );
    await row(page, "statuses", "Đang thực hiện")
      .getByRole("button", { name: `${t.actions.delete} Đang thực hiện` })
      .click();
    const del = page.getByRole("alertdialog", {
      name: t.kinds.statuses.deleteTitle("Đang thực hiện"),
    });
    await expect(del).toContainText(t.kinds.statuses.inUseBody(1));
    await del.getByRole("button", { name: t.actions.moveAndDelete }).click();
    await expect(del.getByText(t.errors.replaceRequired).last()).toBeVisible();
    await del
      .getByLabel(t.kinds.statuses.replaceLabel)
      .selectOption({ label: `Chờ khách duyệt · ${t.categories.in_progress}` });
    expect(await blockingViolations(page, '[role="alertdialog"]')).toEqual([]);
    await del.getByRole("button", { name: t.actions.moveAndDelete }).click();
    await expect(del).toBeHidden();
    await expect(row(page, "statuses", "Đang thực hiện")).toHaveCount(0);
    await expect(row(page, "statuses", "Chờ khách duyệt")).toContainText(
      t.taskCount(1),
    );

    // Loại task: Milestone có huy hiệu mốc.
    await page.getByRole("tab", { name: t.kinds["task-types"].tab }).click();
    await expect(row(page, "task-types", "Milestone")).toContainText(
      t.milestone,
    );

    // Nhãn: thêm.
    await page.getByRole("tab", { name: t.kinds.labels.tab }).click();
    await expect(page.getByText(t.kinds.labels.empty)).toBeVisible();
    await page.getByRole("button", { name: `+ ${t.kinds.labels.add}` }).click();
    const labelForm = page.getByRole("dialog", {
      name: t.kinds.labels.addTitle,
    });
    await labelForm.getByLabel(t.form.name).fill("Bảo mật");
    await labelForm.getByRole("button", { name: t.form.add }).click();
    await expect(row(page, "labels", "Bảo mật")).toBeVisible();
    expect(await blockingViolations(page)).toEqual([]);
  });

  test("Người xem: chỉ đọc, không có nút thêm, sửa, xóa (tối)", async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await signInAs(page, "viewer@example.com");
    await page.goto(`/projects/${projectId}/settings`);
    await expect(
      page.getByRole("heading", { level: 1, name: t.heading }),
    ).toBeVisible();
    await expect(page.getByText(t.readOnly)).toBeVisible();
    await expect(list(page, "statuses").getByRole("listitem")).toHaveCount(7);
    await expect(
      page.getByRole("button", { name: `+ ${t.kinds.statuses.add}` }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: new RegExp(`^${t.actions.delete} `) }),
    ).toHaveCount(0);
    expect(await blockingViolations(page)).toEqual([]);
    await page.getByRole("tab", { name: t.kinds.labels.tab }).click();
    await expect(row(page, "labels", "Bảo mật")).toBeVisible();
    expect(await blockingViolations(page)).toEqual([]);
  });

  test("Dự án không thuộc về mình: trang 404, không lộ tên dự án", async ({
    page,
  }) => {
    await signInAs(page, "pm@example.com");
    // notFound() trong Suspense: phản hồi đã bắt đầu stream nên mã HTTP vẫn 200, nội dung là 404.
    await page.goto(`/projects/${projectId}/settings`);
    await expect(page.getByRole("heading", { name: "404" })).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 1, name: t.heading }),
    ).toHaveCount(0);
    await expect(page.getByText(projectName)).toHaveCount(0);
  });
});
