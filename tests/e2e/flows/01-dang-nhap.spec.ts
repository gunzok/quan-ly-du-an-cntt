import type { SupabaseClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";
import { vi as strings } from "@/lib/i18n/messages/vi";
import { waitForHydration } from "../hydration";
import { cleanupTempData, serviceClient } from "../temp-data";
import {
  createFlowUsers,
  expectNoA11yViolations,
  newTag,
  type FlowUser,
} from "./support";

/**
 * Luồng 1 (test-strategy.md mục 4): đăng nhập email và Google (mô phỏng), đăng xuất.
 *
 * Google MÔ PHỎNG: e2e không có tài khoản Google. Kiểm được: nút Google gửi trình duyệt tới Supabase
 * Auth đúng provider, redirect_to là /auth/callback của chính ứng dụng, PKCE S256, code verifier trong
 * cookie httpOnly; Google trả lỗi (hủy, chưa được mời) thì về /login với thông báo đúng.
 * KHÔNG kiểm được ở e2e: đổi mã thành công sau khi Google xác thực. Phần đó có ở
 * tests/integration/google-auth.test.ts (PKCE thật, mã lấy từ magic link); làm trong e2e cần gửi
 * magic link mà GoTrue cục bộ giới hạn 2 email/giờ (supabase/config.toml email_sent) trên stack dùng
 * chung, dễ chập chờn. Google thật gắn danh tính vào tài khoản đã mời chỉ kiểm được ở staging.
 */
const tag = newTag();
const createdUsers: string[] = [];
let service: SupabaseClient | null = null;
let user: FlowUser;

test.beforeAll(async () => {
  service = serviceClient();
  ({ user } = await createFlowUsers(
    service,
    1,
    tag,
    { user: `E2E Luồng 1 ${tag}` },
    createdUsers,
  ));
});

test.afterAll(async () => {
  await cleanupTempData(service, { userIds: createdUsers });
});

test("Luồng 1: đăng nhập email (sai rồi đúng), đăng xuất; Google mô phỏng tới Supabase Auth và quay về khi lỗi", async ({
  page,
  baseURL,
}) => {
  const login = strings.login;

  await test.step("Mở /login, sai mật khẩu thì ở lại và báo lỗi", async () => {
    await page.goto("/login");
    await expect(
      page.getByRole("heading", { level: 1, name: login.heading }),
    ).toBeVisible();
    await waitForHydration(page);
    await expectNoA11yViolations(page, "/login");
    await page.getByLabel(login.emailLabel).fill(user.email);
    await page.getByLabel(login.passwordLabel).fill(`${user.password}-sai`);
    await page.getByRole("button", { name: login.submit, exact: true }).click();
    await expect(
      page
        .getByRole("alert")
        .filter({ hasText: strings.errors.invalidCredentials }),
    ).toBeVisible();
    await expect(page).toHaveURL("/login");
  });

  await test.step("Đúng mật khẩu → trang chủ có tên người đăng nhập", async () => {
    await page.getByLabel(login.passwordLabel).fill(user.password);
    await page.getByRole("button", { name: login.submit, exact: true }).click();
    await expect(page).toHaveURL("/");
    await expect(page.getByText(strings.home.signedInAs)).toContainText(
      user.email,
    );
    const session = (await page.context().cookies()).filter((c) =>
      /^sb-.+-auth-token/.test(c.name),
    );
    expect(session.length).toBeGreaterThan(0);
    for (const c of session) expect(c.httpOnly).toBe(true);
    await expectNoA11yViolations(page, "trang chủ");
  });

  await test.step("Đăng xuất → về /login, không vào lại được trang chủ", async () => {
    await page.getByRole("button", { name: strings.home.signOut }).click();
    await expect(page).toHaveURL("/login");
    await page.goto("/");
    await expect(page).toHaveURL("/login");
  });

  await test.step("Google (mô phỏng): nút chuyển tới Supabase Auth với PKCE, redirect về /auth/callback", async () => {
    let authorize: URL | null = null;
    // Chặn ở Supabase Auth: không đi tiếp sang accounts.google.com.
    await page.route("**/auth/v1/authorize?**", async (route) => {
      authorize = new URL(route.request().url());
      await route.fulfill({
        status: 200,
        contentType: "text/html",
        body: "<!doctype html><title>Google (mô phỏng)</title><main>Google</main>",
      });
    });
    await waitForHydration(page);
    await page.getByRole("button", { name: login.google, exact: true }).click();
    await expect.poll(() => authorize?.toString() ?? "").not.toBe("");
    const url = authorize!;
    expect(url.searchParams.get("provider")).toBe("google");
    expect(url.searchParams.get("code_challenge")).toBeTruthy();
    expect(url.searchParams.get("code_challenge_method")?.toLowerCase()).toBe(
      "s256",
    );
    const redirect = new URL(url.searchParams.get("redirect_to") ?? "");
    expect(redirect.pathname).toBe("/auth/callback");
    expect(redirect.origin).toBe(new URL(baseURL!).origin);
    // Code verifier PKCE nằm ở cookie httpOnly của ứng dụng (JS trang không đọc được).
    const verifier = (await page.context().cookies()).filter((c) =>
      /code-verifier/.test(c.name),
    );
    expect(verifier.length).toBeGreaterThan(0);
    for (const c of verifier) expect(c.httpOnly).toBe(true);
    await page.unroute("**/auth/v1/authorize?**");
  });

  await test.step("Google trả lỗi: người dùng hủy, tài khoản chưa được mời → /login báo đúng lỗi", async () => {
    await page.goto(
      "/auth/callback?error=access_denied&error_description=user+cancelled",
    );
    await expect(page).toHaveURL("/login?error=oauth_failed");
    await expect(
      page.getByRole("alert").filter({
        hasText: strings.errors.oauth.oauth_failed,
      }),
    ).toBeVisible();
    await page.goto(
      "/auth/callback?error=access_denied&error_code=signup_disabled",
    );
    await expect(page).toHaveURL("/login?error=not_invited");
    await expect(
      page
        .getByRole("alert")
        .filter({ hasText: strings.errors.oauth.not_invited }),
    ).toBeVisible();
    await expectNoA11yViolations(page, "/login có lỗi Google");
    // Không có phiên.
    await page.goto("/");
    await expect(page).toHaveURL("/login");
  });
});
