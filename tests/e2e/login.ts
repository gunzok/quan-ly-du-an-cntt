import { expect, type Page } from "@playwright/test";
import { strings } from "@/lib/strings";
import { E2E_EMAIL, e2ePassword } from "./env";

/** Đăng nhập bằng tài khoản thử qua /login, chờ về trang chủ. */
export async function signIn(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByLabel(strings.login.emailLabel).fill(E2E_EMAIL);
  await page.getByLabel(strings.login.passwordLabel).fill(e2ePassword());
  await page
    .getByRole("button", { name: strings.login.submit, exact: true })
    .click();
  await expect(page).toHaveURL("/");
}
