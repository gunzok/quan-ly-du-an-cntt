import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";
import { vi as strings } from "@/lib/i18n/messages/vi";
import { waitForHydration } from "./hydration";

/**
 * Story E1-6 (QLDA-33): tab Thành viên ở màn cấu hình dự án.
 * Dự án tạm và bốn tài khoản tạm (PM, Người xem, người sẽ được thêm, người bị khóa) tạo bằng khóa
 * service của stack CỤC BỘ (make test-e2e đặt SUPABASE_SERVICE_ROLE_KEY), mật khẩu ngẫu nhiên mỗi
 * lần chạy: không đụng tài khoản seed (stack dùng chung giữa các worktree), không cần SEED_PASSWORD.
 * afterAll xóa dự án và tài khoản tạm.
 */
const t = strings.projectMembers;
const roles = strings.projects.roles;
const BLOCKING_IMPACTS = new Set(["critical", "serious"]);
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const tag = randomUUID().slice(0, 8);
const projectName = `E2E ${tag} Thành viên`;
const projectId = randomUUID();
const persona = (key: string, name: string) => ({
  email: `e2e-e1-6-${key}-${tag}@example.com`,
  name: `E2E ${name} ${tag}`,
  password: `E2e-${randomUUID()}`,
});
const pmUser = persona("pm", "PM");
const viewerUser = persona("viewer", "Xem");
const newbie = persona("new", "Mới");
const lockedName = `E2E Khóa ${tag}`;
const tempUsers: string[] = [];

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

async function createTempUser(
  client: SupabaseClient,
  email: string,
  fullName: string,
  password: string,
) {
  const { data, error } = await client.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });
  if (error) throw error;
  tempUsers.push(data.user.id);
  return data.user.id;
}

test.beforeAll(async () => {
  service = serviceClient();
  const pm = await createTempUser(
    service,
    pmUser.email,
    pmUser.name,
    pmUser.password,
  );
  const viewer = await createTempUser(
    service,
    viewerUser.email,
    viewerUser.name,
    viewerUser.password,
  );
  const project = await service
    .from("projects")
    .insert({ id: projectId, name: projectName, created_by: pm });
  if (project.error) throw project.error;
  const member = await service
    .from("project_members")
    .insert({ project_id: projectId, user_id: viewer, role: "viewer" });
  if (member.error) throw member.error;
  await createTempUser(service, newbie.email, newbie.name, newbie.password);
  const locked = await createTempUser(
    service,
    `e2e-e1-6-locked-${tag}@example.com`,
    lockedName,
    `E2e-${randomUUID()}`,
  );
  const lock = await service
    .from("profiles")
    .update({ is_active: false })
    .eq("id", locked);
  if (lock.error) throw lock.error;
});

test.afterAll(async () => {
  if (!service) return;
  await service.from("projects").delete().eq("id", projectId);
  for (const id of tempUsers) await service.auth.admin.deleteUser(id);
});

async function signInAs(page: Page, user: { email: string; password: string }) {
  const { email, password } = user;
  await page.goto("/login");
  await waitForHydration(page);
  await page.getByLabel(strings.login.emailLabel).fill(email);
  await page.getByLabel(strings.login.passwordLabel).fill(password);
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

const memberList = (page: Page) =>
  page.getByRole("list", { name: t.listLabel });
const memberRow = (page: Page, name: string) =>
  memberList(page)
    .getByRole("listitem")
    .filter({ has: page.locator("span.font-medium", { hasText: name }) });

async function openMembersTab(page: Page) {
  await page.goto(`/projects/${projectId}/settings`);
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: strings.projectConfig.heading,
    }),
  ).toBeVisible();
  await page.getByRole("tab", { name: t.tab }).click();
  await expect(memberList(page)).toBeVisible();
}

test.describe.serial("Thành viên dự án", () => {
  test("PM: xem, thêm bằng ô tìm người, đổi vai trò, PM cuối cùng bị chặn (sáng)", async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await signInAs(page, pmUser);
    await openMembersTab(page);

    await expect(memberList(page).getByRole("listitem")).toHaveCount(2);
    const self = memberRow(page, pmUser.name);
    await expect(self).toContainText(t.you);
    await expect(self).toContainText(roles.pm);
    await expect(memberRow(page, viewerUser.name)).toContainText(roles.viewer);
    expect(await blockingViolations(page)).toEqual([]);

    // Thêm: tìm theo tag, người bị khóa không hiện.
    await page.getByRole("button", { name: `+ ${t.add}` }).click();
    const dialog = page.getByRole("dialog", { name: t.addDialog.title });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: t.addDialog.submit }).click();
    await expect(dialog.getByText(t.addDialog.pickRequired)).toBeVisible();
    await dialog.getByLabel(t.addDialog.search).fill(tag);
    await expect(dialog.getByText(t.addDialog.resultCount(1))).toBeVisible();
    await expect(dialog.getByText(lockedName)).toHaveCount(0);
    await dialog.getByRole("radio", { name: new RegExp(newbie.name) }).check();
    await dialog.getByLabel(t.addDialog.role).selectOption("viewer");
    expect(await blockingViolations(page, '[role="dialog"]')).toEqual([]);
    await dialog.getByRole("button", { name: t.addDialog.submit }).click();
    await expect(dialog).toBeHidden();
    await expect(
      page.getByText(t.done.added(newbie.name, roles.viewer)),
    ).toBeVisible();
    await expect(memberRow(page, newbie.name)).toContainText(roles.viewer);
    await expect(memberRow(page, newbie.name)).toContainText(newbie.email);

    // Đổi vai trò Người xem → Thành viên.
    await memberRow(page, newbie.name)
      .getByRole("button", { name: `${t.actions.changeRole} ${newbie.name}` })
      .click();
    const roleDialog = page.getByRole("dialog", {
      name: t.roleDialog.title(newbie.name),
    });
    await roleDialog.getByLabel(t.roleDialog.role).selectOption("member");
    await roleDialog.getByRole("button", { name: t.roleDialog.save }).click();
    await expect(roleDialog).toBeHidden();
    await expect(memberRow(page, newbie.name)).toContainText(roles.member);

    // PM cuối cùng tự hạ: cảnh báo trước, máy chủ từ chối (409), vai trò không đổi.
    await self
      .getByRole("button", { name: `${t.actions.changeRole} ${pmUser.name}` })
      .click();
    const selfDialog = page.getByRole("dialog", {
      name: t.roleDialog.title(pmUser.name),
    });
    await expect(selfDialog).toContainText(t.roleDialog.lastPmWarning);
    await selfDialog.getByLabel(t.roleDialog.role).selectOption("member");
    expect(await blockingViolations(page, '[role="dialog"]')).toEqual([]);
    await selfDialog.getByRole("button", { name: t.roleDialog.save }).click();
    await expect(selfDialog.getByRole("alert")).toContainText(t.errors.lastPm);
    await page.keyboard.press("Escape");
    await expect(selfDialog).toBeHidden();
    await expect(self).toContainText(roles.pm);
  });

  test("AC1: người được thêm đăng nhập thấy dự án với đúng vai trò", async ({
    page,
  }) => {
    await signInAs(page, newbie);
    const card = page
      .getByRole("list", { name: strings.projects.listLabel })
      .getByRole("listitem")
      .filter({
        has: page.getByRole("heading", { name: projectName, exact: true }),
      });
    await expect(card).toBeVisible();
    await expect(card).toContainText(
      `${strings.projects.card.eyebrow} / ${roles.member}`,
    );
  });

  test("Người xem: tab Thành viên chỉ đọc (tối)", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await signInAs(page, viewerUser);
    await openMembersTab(page);
    await expect(memberList(page).getByRole("listitem")).toHaveCount(3);
    await expect(page.getByRole("button", { name: `+ ${t.add}` })).toHaveCount(
      0,
    );
    await expect(
      page.getByRole("button", {
        name: new RegExp(`^${t.actions.changeRole}`),
      }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: t.actions.removeAction(newbie.name) }),
    ).toHaveCount(0);
    expect(await blockingViolations(page)).toEqual([]);
  });

  test("PM ở 360 px chỉ dùng bàn phím: mở tab, gỡ thành viên có xác nhận (tối)", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    await page.emulateMedia({ colorScheme: "dark" });
    await signInAs(page, pmUser);
    await page.goto(`/projects/${projectId}/settings`);
    // Tab bằng bàn phím: focus tab đầu, End tới tab cuối (Thành viên), Radix kích hoạt khi focus.
    await page
      .getByRole("tab", { name: strings.projectConfig.kinds.statuses.tab })
      .focus();
    await page.keyboard.press("End");
    await expect(page.getByRole("tab", { name: t.tab })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(memberList(page).getByRole("listitem")).toHaveCount(3);
    const noHorizontalScroll = () =>
      page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      );
    expect(await noHorizontalScroll()).toBe(true);
    expect(await blockingViolations(page)).toEqual([]);

    const removeButton = page.getByRole("button", {
      name: t.actions.removeAction(newbie.name),
    });
    await removeButton.focus();
    await page.keyboard.press("Enter");
    const confirm = page.getByRole("alertdialog", {
      name: t.removeDialog.title(newbie.name),
    });
    await expect(confirm).toContainText(t.removeDialog.body);
    expect(await noHorizontalScroll()).toBe(true);
    expect(await blockingViolations(page, '[role="alertdialog"]')).toEqual([]);
    // Focus mặc định ở Hủy (tránh xác nhận nhầm): Tab sang nút xác nhận rồi Enter.
    await page.keyboard.press("Tab");
    await expect(
      confirm.getByRole("button", { name: t.removeDialog.confirm }),
    ).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(confirm).toBeHidden();
    await expect(page.getByText(t.done.removed(newbie.name))).toBeVisible();
    await expect(memberRow(page, newbie.name)).toHaveCount(0);
    await expect(memberList(page).getByRole("listitem")).toHaveCount(2);
  });
});
