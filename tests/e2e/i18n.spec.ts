import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { en } from "@/lib/i18n/messages/en";
import { vi } from "@/lib/i18n/messages/vi";

/**
 * Story E10-2 (QLDA-65) tiêu chí 1: chọn English thì giao diện đổi và được nhớ ở lần sau.
 * - Khách (/login): lưu cookie, còn nguyên sau tải lại; Accept-Language tiếng Anh cũng được tôn trọng.
 * - Người đăng nhập (lưu profiles.locale, còn nguyên sau khi đăng nhập lại từ trình duyệt sạch):
 *   chuyển sang luồng 9 của bộ luồng chính (tests/e2e/flows/09-ngon-ngu-va-360.spec.ts, QLDA-56).
 */
const BLOCKING_IMPACTS = new Set(["critical", "serious"]);
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

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
