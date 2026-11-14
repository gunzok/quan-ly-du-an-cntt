import { expect, test } from "@playwright/test";
import { strings } from "@/lib/strings";
import { E2E_EMAIL, e2ePassword } from "./env";

/**
 * Luồng mẫu Story E0-3 (tiêu chí 2), luồng e2e số 1 trong test-strategy.md mục 4 (phần email):
 * đăng nhập trên /login, thấy trang chủ, đăng xuất, rồi không vào lại được trang chủ.
 */
test("đăng nhập bằng email, thấy trang chủ rồi đăng xuất", async ({ page }) => {
  await page.goto("/login");
  await expect(
    page.getByRole("heading", { level: 1, name: strings.login.heading }),
  ).toBeVisible();

  await page.getByLabel(strings.login.emailLabel).fill(E2E_EMAIL);
  await page.getByLabel(strings.login.passwordLabel).fill(e2ePassword());
  await page
    .getByRole("button", { name: strings.login.submit, exact: true })
    .click();

  await expect(page).toHaveURL("/");
  await expect(page.getByText(strings.home.signedInAs)).toContainText(
    E2E_EMAIL,
  );

  await page.getByRole("button", { name: strings.home.signOut }).click();
  await expect(page).toHaveURL("/login");

  // Phiên đã bị xóa: vào lại trang chủ thì bị chuyển về /login.
  await page.goto("/");
  await expect(page).toHaveURL("/login");
});

test("sai mật khẩu thì ở lại /login và báo lỗi", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel(strings.login.emailLabel).fill(E2E_EMAIL);
  await page
    .getByLabel(strings.login.passwordLabel)
    .fill(`${e2ePassword()}-sai`);
  await page
    .getByRole("button", { name: strings.login.submit, exact: true })
    .click();

  // Lọc theo nội dung: Next.js cũng gắn một vùng role="alert" (route announcer) vào trang.
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: strings.errors.invalidCredentials }),
  ).toBeVisible();
  await expect(page).toHaveURL("/login");
});
