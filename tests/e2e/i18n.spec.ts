import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { type SupabaseClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";
import { en } from "@/lib/i18n/messages/en";
import { vi } from "@/lib/i18n/messages/vi";
import { waitForHydration } from "./hydration";
import { cleanupTempData, createTempUsers, serviceClient } from "./temp-data";

/**
 * Story E10-2 (QLDA-65) tiêu chí 1: chọn English thì giao diện đổi và được nhớ ở lần sau.
 * - Khách (/login): lưu cookie, còn nguyên sau tải lại; Accept-Language tiếng Anh cũng được tôn trọng.
 * - Người đăng nhập: lưu profiles.locale, còn nguyên sau tải lại và sau khi đăng nhập lại từ một
 *   trình duyệt sạch (không cookie), <html lang> đổi đúng, URL không đổi, axe không lỗi nặng.
 * Tài khoản tạm tạo bằng khóa service của stack CỤC BỘ (make test-e2e), mật khẩu ngẫu nhiên, xóa ở
 * afterAll: không đổi ngôn ngữ của tài khoản seed mà các e2e khác (tiếng Việt) dùng song song.
 */
const BLOCKING_IMPACTS = new Set(["critical", "serious"]);
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const tag = randomUUID().slice(0, 8);
const user = {
  email: `e2e-e10-2-${tag}@example.com`,
  password: `E2e-${randomUUID()}`,
};
let service: SupabaseClient | null = null;
let userId: string | null = null;

test.beforeAll(async () => {
  service = serviceClient();
  const created = await createTempUsers(service, {
    user: { ...user, fullName: `E2E Ngôn ngữ ${tag}` },
  });
  userId = created.user;
});

test.afterAll(async () => {
  await cleanupTempData(service, { userIds: [userId] });
});

async function blockingViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  return results.violations
    .filter((v) => v.impact && BLOCKING_IMPACTS.has(v.impact))
    .flatMap((v) => v.nodes.map((n) => `${v.id} @ ${n.target.join(" ")}`));
}

function languageGroup(page: Page, label: string) {
  return page.getByRole("group", { name: label });
}

test("khách chọn English trên /login: giao diện và <html lang> đổi, còn nguyên sau tải lại", async ({
  page,
}) => {
  await page.goto("/login");
  await expect(page.locator("html")).toHaveAttribute("lang", "vi");
  const viButton = languageGroup(page, vi.language.groupLabel).getByRole(
    "button",
    { name: vi.language.vi },
  );
  await expect(viButton).toHaveAttribute("aria-pressed", "true");

  // Bàn phím: Tab tới nút English rồi Enter.
  const enButton = languageGroup(page, vi.language.groupLabel).getByRole(
    "button",
    { name: vi.language.en },
  );
  await enButton.focus();
  await page.keyboard.press("Enter");

  await expect(
    page.getByRole("heading", { level: 1, name: en.login.heading }),
  ).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page).toHaveURL("/login");
  await expect(page).toHaveTitle(`${en.login.pageTitle} · ${en.app.name}`);
  await expect(
    languageGroup(page, en.language.groupLabel).getByRole("button", {
      name: en.language.en,
    }),
  ).toHaveAttribute("aria-pressed", "true");
  const cookie = (await page.context().cookies()).find(
    (c) => c.name === "qlda_locale",
  );
  expect(cookie?.value).toBe("en");
  expect(cookie?.sameSite).toBe("Lax");

  await page.reload();
  await expect(
    page.getByRole("heading", { level: 1, name: en.login.heading }),
  ).toBeVisible();
  await expect(page.getByLabel(en.login.passwordLabel)).toBeVisible();
  expect(await blockingViolations(page)).toEqual([]);

  // Đổi lại tiếng Việt.
  await languageGroup(page, en.language.groupLabel)
    .getByRole("button", { name: en.language.vi })
    .click();
  await expect(
    page.getByRole("heading", { level: 1, name: vi.login.heading }),
  ).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "vi");
});

test.describe("trình duyệt tiếng Anh", () => {
  test.use({ locale: "en-US" });

  test("không có lựa chọn đã lưu: theo Accept-Language", async ({ page }) => {
    await page.goto("/login");
    await expect(
      page.getByRole("heading", { level: 1, name: en.login.heading }),
    ).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
  });
});

test("người đăng nhập chọn English: lưu vào hồ sơ, còn nguyên sau tải lại và sau khi đăng nhập lại", async ({
  page,
  browser,
}) => {
  await page.goto("/login");
  await waitForHydration(page);
  await page.getByLabel(vi.login.emailLabel).fill(user.email);
  await page.getByLabel(vi.login.passwordLabel).fill(user.password);
  await page
    .getByRole("button", { name: vi.login.submit, exact: true })
    .click();
  await expect(page).toHaveURL("/");
  await expect(
    page.getByRole("navigation", { name: vi.projects.navLabel }),
  ).toBeVisible();

  await languageGroup(page, vi.language.groupLabel)
    .getByRole("button", { name: vi.language.en })
    .click();
  await expect(
    page.getByRole("navigation", { name: en.projects.navLabel }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: en.home.signOut }),
  ).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page).toHaveURL("/");

  // Đã lưu vào hồ sơ (không chỉ cookie).
  const { data: profile } = await service!
    .from("profiles")
    .select("locale")
    .eq("id", userId!)
    .single();
  expect(profile?.locale).toBe("en");

  await page.reload();
  await expect(
    page.getByRole("navigation", { name: en.projects.navLabel }),
  ).toBeVisible();
  expect(await blockingViolations(page)).toEqual([]);

  // Đăng xuất: trang đăng nhập giữ tiếng Anh (cookie đi kèm lựa chọn).
  await page.getByRole("button", { name: en.home.signOut }).click();
  await expect(page).toHaveURL("/login");
  await expect(
    page.getByRole("heading", { level: 1, name: en.login.heading }),
  ).toBeVisible();

  // Đăng nhập lại từ trình duyệt sạch (tiếng Việt, không cookie): hồ sơ thắng cookie và header.
  const fresh = await browser.newContext({ locale: "vi-VN" });
  try {
    const other = await fresh.newPage();
    await other.goto("/login");
    await expect(
      other.getByRole("heading", { level: 1, name: vi.login.heading }),
    ).toBeVisible();
    await other.getByLabel(vi.login.emailLabel).fill(user.email);
    await other.getByLabel(vi.login.passwordLabel).fill(user.password);
    await other
      .getByRole("button", { name: vi.login.submit, exact: true })
      .click();
    await expect(other).toHaveURL("/");
    await expect(
      other.getByRole("navigation", { name: en.projects.navLabel }),
    ).toBeVisible();
    await expect(other.locator("html")).toHaveAttribute("lang", "en");
  } finally {
    await fresh.close();
  }
});
