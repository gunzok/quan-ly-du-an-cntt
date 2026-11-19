import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import type { SupabaseClient } from "@supabase/supabase-js";
import { expect, test, type Cookie, type Page } from "@playwright/test";
import { en } from "@/lib/i18n/messages/en";
import { vi as strings } from "@/lib/i18n/messages/vi";
import { waitForHydration } from "./hydration";
import { signInWithPassword } from "./login";
import { cleanupTempData, createTempUsers, serviceClient } from "./temp-data";

/**
 * Story E1-7 (QLDA-77): hồ sơ cá nhân S18 (/profile).
 * AC1: đổi tên hiển thị → lưu và hiện ngay ở khung ứng dụng. AC2: đổi ngôn ngữ ưa thích → đăng
 * xuất, đăng nhập lại (trình duyệt mới, Accept-Language vi) vẫn giữ English.
 * Tài khoản và dự án TẠM tạo bằng khóa service của stack cục bộ; mỗi tài khoản đăng nhập giao diện
 * tối thiểu (owner 1 lần, lang 2 lần).
 */
const t = strings.profile;
const BLOCKING_IMPACTS = new Set(["critical", "serious"]);
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const tag = randomUUID().slice(0, 8);
const password = `E2e-${randomUUID()}`;
const projectId = randomUUID();
const projectName = `E2E ${tag} Hồ sơ`;
const emails = {
  owner: `e2e-e1-7-owner-${tag}@example.com`,
  lang: `e2e-e1-7-lang-${tag}@example.com`,
};
type Who = keyof typeof emails;
const names: Record<Who, string> = {
  owner: `Chủ hồ sơ ${tag}`,
  lang: `Ngôn ngữ ${tag}`,
};
const users = {} as Record<Who, string>;
let service: SupabaseClient | null = null;
let ownerSession: Cookie[] | null = null;

test.beforeAll(async () => {
  service = serviceClient();
  await createTempUsers(
    service,
    {
      owner: { email: emails.owner, password, fullName: names.owner },
      lang: { email: emails.lang, password, fullName: names.lang },
    },
    users,
  );
  const project = await service
    .from("projects")
    .insert({ id: projectId, name: projectName, created_by: users.owner });
  if (project.error) throw project.error;
});

test.afterAll(async () => {
  await cleanupTempData(service, {
    projectIds: [projectId],
    userIds: Object.values(users),
  });
});

async function signInOwner(page: Page) {
  if (ownerSession) {
    await page.context().addCookies(ownerSession);
    return;
  }
  await signInWithPassword(page, emails.owner, password);
  ownerSession = await page.context().cookies();
}

async function openProfile(page: Page) {
  await page.goto("/profile");
  await waitForHydration(page);
  await expect(
    page.getByRole("heading", { level: 1, name: t.pageTitle }),
  ).toBeVisible();
}

async function blockingViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  return results.violations
    .filter((v) => v.impact && BLOCKING_IMPACTS.has(v.impact))
    .flatMap((v) => v.nodes.map((n) => `${v.id} @ ${n.target.join(" ")}`));
}

async function dbProfile(id: string) {
  const [{ data: profile, error }, { data: contact }] = await Promise.all([
    service!.from("profiles").select("full_name, locale").eq("id", id).single(),
    service!
      .from("profile_contacts")
      .select("phone")
      .eq("user_id", id)
      .maybeSingle(),
  ]);
  if (error) throw error;
  return { ...profile, phone: contact?.phone ?? null };
}

const saveButton = (page: Page, label = t.save) =>
  page.getByRole("button", { name: label, exact: true });
const sidebar = (page: Page) => page.locator("aside");

test.describe.serial("Hồ sơ cá nhân S18", () => {
  test("AC1: đổi tên hiển thị → lưu, hiện ngay ở khung ứng dụng; số điện thoại; vai trò; axe sáng", async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await signInOwner(page);
    await page.goto("/");
    await waitForHydration(page);
    await page.getByRole("link", { name: t.navLink, exact: true }).click();
    await expect(page).toHaveURL("/profile");
    await waitForHydration(page);
    await expect(
      page.getByRole("link", { name: t.navLink, exact: true }),
    ).toHaveAttribute("aria-current", "page");

    // Email chỉ đọc; vai trò theo dự án chỉ đọc.
    const email = page.getByLabel(t.email, { exact: true });
    await expect(email).toHaveValue(emails.owner);
    await expect(email).toHaveAttribute("readonly", "");
    const roles = page.getByRole("region", { name: t.rolesHeading });
    const row = roles.getByRole("listitem").filter({
      has: page.getByRole("link", { name: projectName, exact: true }),
    });
    await expect(row).toContainText(strings.projects.roles.pm);
    expect(await blockingViolations(page)).toEqual([]);

    // Tên rỗng và số sai định dạng: báo lỗi ở từng ô, không gửi.
    const name = page.getByLabel(t.fullName, { exact: true });
    const phone = page.getByLabel(t.phone, { exact: true });
    await name.fill("   ");
    await phone.fill("abc");
    await saveButton(page).click();
    await expect(page.getByText(t.errors.fullNameRequired)).toBeVisible();
    await expect(page.getByText(t.errors.phoneInvalid)).toBeVisible();
    await expect(name).toHaveAttribute("aria-invalid", "true");
    await expect(name).toBeFocused();

    const newName = `Tên mới ${tag}`;
    await name.fill(newName);
    await phone.fill("0900 000 123");
    const saved = page.waitForResponse(
      (r) => r.url().endsWith("/api/v1/me") && r.request().method() === "PATCH",
    );
    await saveButton(page).click();
    expect((await saved).status()).toBe(200);
    await expect(
      page.getByRole("status").filter({ hasText: t.saved }),
    ).toBeVisible();
    // Khung ứng dụng hiện tên mới ngay (không cần tải lại).
    await expect(
      sidebar(page).getByText(newName, { exact: true }),
    ).toBeVisible();
    expect(await dbProfile(users.owner)).toMatchObject({
      full_name: newName,
      phone: "0900 000 123",
    });

    // Giữ sau khi tải lại; xóa số điện thoại.
    await page.reload();
    await waitForHydration(page);
    await expect(name).toHaveValue(newName);
    await expect(phone).toHaveValue("0900 000 123");
    await phone.fill("");
    const cleared = page.waitForResponse(
      (r) => r.url().endsWith("/api/v1/me") && r.request().method() === "PATCH",
    );
    await saveButton(page).click();
    expect((await cleared).status()).toBe(200);
    expect((await dbProfile(users.owner)).phone).toBeNull();
  });

  test("giao diện tối lưu trên trình duyệt, áp dụng ngay; bàn phím; axe tối; 360 px", async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await signInOwner(page);
    await openProfile(page);
    const html = page.locator("html");
    await expect(html).not.toHaveAttribute("data-theme", /.*/);

    // Bàn phím: Tab vào nhóm Giao diện, mũi tên chọn Tối, Enter gửi form từ ô nhập.
    const system = page.getByRole("radio", {
      name: t.themes.system,
      exact: true,
    });
    await system.focus();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await expect(
      page.getByRole("radio", { name: t.themes.dark, exact: true }),
    ).toBeChecked();
    await saveButton(page).focus();
    await page.keyboard.press("Enter");
    await expect(html).toHaveAttribute("data-theme", "dark");
    await expect(
      page.getByRole("status").filter({ hasText: t.saved }),
    ).toBeVisible();
    // Không gọi API khi chỉ đổi giao diện; máy chủ đặt sẵn data-theme sau khi tải lại.
    await page.reload();
    await waitForHydration(page);
    await expect(html).toHaveAttribute("data-theme", "dark");
    await expect(
      page.getByRole("radio", { name: t.themes.dark, exact: true }),
    ).toBeChecked();
    expect(await blockingViolations(page)).toEqual([]);

    // Hệ thống tối, không chọn gì: dùng prefers-color-scheme.
    await page
      .getByRole("radio", { name: t.themes.system, exact: true })
      .check();
    await saveButton(page).click();
    await expect(html).not.toHaveAttribute("data-theme", /.*/);
    await page.emulateMedia({ colorScheme: "dark" });
    expect(await blockingViolations(page)).toEqual([]);

    // 360 px: không tràn ngang, nút lưu đủ 44 px.
    await page.setViewportSize({ width: 360, height: 800 });
    await page.reload();
    await waitForHydration(page);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    const box = await saveButton(page).boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    expect(await blockingViolations(page)).toEqual([]);
  });

  test("E4-2: bật/tắt email theo loại bằng bàn phím → lưu ngay, giữ sau tải lại; lỗi thì trả lại", async ({
    page,
  }) => {
    const ep = strings.emailPreferences;
    await page.emulateMedia({ colorScheme: "light" });
    await signInOwner(page);
    await openProfile(page);
    const section = page.getByRole("region", { name: ep.heading });
    const assigned = section.getByRole("switch", {
      name: ep.types.task_assigned,
      exact: true,
    });
    const status = section.getByRole("switch", {
      name: ep.types.task_status_changed,
      exact: true,
    });
    // Mặc định: giao việc bật, đổi trạng thái tắt.
    await expect(assigned).toBeChecked();
    await expect(status).not.toBeChecked();

    const put = () =>
      page.waitForResponse(
        (r) =>
          r.url().endsWith("/api/v1/me/notification-preferences") &&
          r.request().method() === "PUT",
      );
    await assigned.focus();
    let saved = put();
    await page.keyboard.press("Space");
    expect((await saved).status()).toBe(200);
    await expect(assigned).not.toBeChecked();
    await expect(
      section
        .getByRole("status")
        .filter({ hasText: ep.saved(ep.types.task_assigned, false) }),
    ).toBeVisible();
    await expect(assigned).toBeFocused();

    saved = put();
    await status.check();
    expect((await saved).status()).toBe(200);
    const { data, error } = await service!
      .from("notification_preferences")
      .select("type, email_enabled")
      .eq("user_id", users.owner)
      .order("type");
    if (error) throw error;
    expect(data).toEqual([
      { type: "task_assigned", email_enabled: false },
      { type: "task_status_changed", email_enabled: true },
    ]);

    await page.reload();
    await waitForHydration(page);
    await expect(assigned).not.toBeChecked();
    await expect(status).toBeChecked();
    expect(await blockingViolations(page)).toEqual([]);

    // Máy chủ lỗi: công tắc trở lại trạng thái cũ, báo lỗi.
    await page.route("**/api/v1/me/notification-preferences", (route) =>
      route.request().method() === "PUT"
        ? route.fulfill({
            status: 500,
            contentType: "application/json",
            body: JSON.stringify({ error: { code: "internal_error" } }),
          })
        : route.continue(),
    );
    await assigned.click();
    await expect(section.getByRole("alert")).toHaveText(ep.saveFailed);
    await expect(assigned).not.toBeChecked();
    await page.unroute("**/api/v1/me/notification-preferences");
  });

  test("AC2: đổi ngôn ngữ → đăng xuất, đăng nhập lại vẫn giữ English", async ({
    browser,
  }) => {
    const first = await browser.newContext({ locale: "vi-VN" });
    const page = await first.newPage();
    await signInWithPassword(page, emails.lang, password);
    await openProfile(page);
    await page
      .getByRole("radio", { name: strings.language.en, exact: true })
      .check();
    const saved = page.waitForResponse(
      (r) => r.url().endsWith("/api/v1/me") && r.request().method() === "PATCH",
    );
    await saveButton(page).click();
    expect((await saved).status()).toBe(200);
    // Áp dụng ngay: cả trang sang tiếng Anh.
    await expect(
      page.getByRole("heading", { level: 1, name: en.profile.pageTitle }),
    ).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    expect((await dbProfile(users.lang)).locale).toBe("en");

    await page
      .getByRole("button", { name: en.home.signOut, exact: true })
      .click();
    await expect(page).toHaveURL(/\/login/);
    await first.close();

    // Trình duyệt mới (không cookie ngôn ngữ, Accept-Language vi): sau khi đăng nhập, hồ sơ quyết định.
    const second = await browser.newContext({ locale: "vi-VN" });
    const again = await second.newPage();
    await signInWithPassword(again, emails.lang, password);
    await expect(again.locator("html")).toHaveAttribute("lang", "en");
    await again.goto("/profile");
    await waitForHydration(again);
    await expect(
      again.getByRole("heading", { level: 1, name: en.profile.pageTitle }),
    ).toBeVisible();
    await expect(
      again.getByRole("radio", { name: en.language.en, exact: true }),
    ).toBeChecked();
    await second.close();
  });
});
