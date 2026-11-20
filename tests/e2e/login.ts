import { expect, type BrowserContext, type Page } from "@playwright/test";
import { vi as strings } from "@/lib/i18n/messages/vi";
import { E2E_EMAIL, e2ePassword } from "./env";
import { waitForHydration } from "./hydration";

/**
 * QUY ƯỚC ĐĂNG NHẬP CHO E2E:
 * - Spec mới dùng TÀI KHOẢN TẠM (tests/e2e/temp-data.ts), không phụ thuộc persona seed hay
 *   SEED_PASSWORD; chỉ spec kiểm chính dữ liệu seed mới dùng persona (`signIn`, e2ePassword()).
 * - Đăng nhập tối thiểu: giới hạn đăng nhập theo IP chỉ được nới khi chạy `make test-e2e`
 *   (E2E_RELAXED_LOGIN_RATE_LIMIT). Khi một tài khoản cần nhiều test, đăng nhập một lần rồi lưu
 *   `context.storageState()` và mở context mới với state đó (mẫu: notifications.spec.ts); khi chỉ
 *   cần dựng dữ liệu, dùng client khóa service hoặc phiên supabase-js thay vì qua giao diện.
 * - Luôn chờ hydrate (`waitForHydration`) trước khi điền form.
 * - So khớp email/tên theo ô hoặc `exact: true`: CSDL dùng chung có nhiều tài khoản tạm, `getByText`
 *   mặc định khớp chuỗi con (`pm@example.com` khớp cả `perf-pm@example.com`).
 */

/** Đăng nhập qua /login bằng email + mật khẩu, chờ về trang chủ. */
export async function signInWithPassword(
  page: Page,
  email: string,
  password: string,
): Promise<void> {
  await page.goto("/login");
  await waitForHydration(page);
  await page.getByLabel(strings.login.emailLabel).fill(email);
  await page.getByLabel(strings.login.passwordLabel).fill(password);
  await page
    .getByRole("button", { name: strings.login.submit, exact: true })
    .click();
  await expect(page).toHaveURL("/");
}

/** Đăng nhập bằng persona seed (mặc định E2E_EMAIL), mật khẩu SEED_PASSWORD. */
export async function signIn(page: Page, email = E2E_EMAIL): Promise<void> {
  await signInWithPassword(page, email, e2ePassword());
}

type Cookies = Awaited<ReturnType<BrowserContext["cookies"]>>;

/**
 * Đăng nhập tối thiểu cho spec nhiều vai trò: mỗi tài khoản qua /login MỘT lần, các lần sau gắn lại
 * cookie phiên đã lưu (bỏ cookie của vai trò trước). `creds` đọc lúc gọi nên tài khoản tạo trong
 * beforeAll vẫn dùng được. Cache theo worker (spec serial chạy cùng worker).
 */
export function cachedSignIn<K extends string>(
  creds: (who: K) => { email: string; password: string },
): (page: Page, who: K) => Promise<void> {
  const sessions: Partial<Record<K, Cookies>> = {};
  return async (page, who) => {
    await page.context().clearCookies();
    const saved = sessions[who];
    if (saved) {
      await page.context().addCookies(saved);
      return;
    }
    const { email, password } = creds(who);
    await signInWithPassword(page, email, password);
    sessions[who] = await page.context().cookies();
  };
}
