import { expect, test, type ConsoleMessage } from "@playwright/test";
import { strings } from "@/lib/strings";
import { E2E_EMAIL, e2ePassword } from "./env";

/**
 * Story E0-5 (QLDA-44) tiêu chí 1: trang có CSP chặt và header an toàn; CSP không làm hỏng trang.
 * Chạy trên bản production (`next build` + `next start`, xem playwright.config.ts) vì chế độ dev
 * nới CSP ('unsafe-eval').
 */
function isCspViolation(message: ConsoleMessage) {
  return /content security policy/i.test(message.text());
}

test("/login có CSP nonce, header an toàn và không có lỗi CSP trong console", async ({
  page,
}) => {
  const violations: string[] = [];
  page.on("console", (m) => {
    if (isCspViolation(m)) violations.push(m.text());
  });
  page.on("pageerror", (e) => violations.push(`pageerror: ${e.message}`));

  const response = await page.goto("/login");
  expect(response?.status()).toBe(200);
  const headers = response!.headers();

  const csp = headers["content-security-policy"] ?? "";
  const nonce = /'nonce-([^']+)'/.exec(csp)?.[1];
  expect(nonce, "CSP phải có nonce").toBeTruthy();
  expect(csp).toContain("'strict-dynamic'");
  expect(csp).not.toContain("'unsafe-eval'");
  expect(/script-src ([^;]*)/.exec(csp)?.[1]).not.toContain("'unsafe-inline'");
  expect(csp).toContain("frame-ancestors 'none'");
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  expect(headers["permissions-policy"]).toContain("camera=()");
  expect(headers["x-powered-by"]).toBeUndefined();

  // Mọi thẻ script do Next.js render đều mang đúng nonce của request này.
  const scriptNonces = await page
    .locator("script")
    .evaluateAll((els) => els.map((el) => (el as HTMLScriptElement).nonce));
  expect(scriptNonces.length).toBeGreaterThan(0);
  expect(new Set(scriptNonces)).toEqual(new Set([nonce]));

  // Runtime Next.js phía trình duyệt đã chạy (nếu CSP chặn script thì window.next không có).
  await expect
    .poll(() =>
      page.evaluate(
        () => typeof (window as { next?: { version?: string } }).next?.version,
      ),
    )
    .toBe("string");

  expect(violations, "Lỗi CSP trong console").toEqual([]);
});

test("đăng nhập và trang chủ chạy dưới CSP, không có lỗi CSP", async ({
  page,
}) => {
  const violations: string[] = [];
  page.on("console", (m) => {
    if (isCspViolation(m)) violations.push(m.text());
  });

  await page.goto("/login");
  await page.getByLabel(strings.login.emailLabel).fill(E2E_EMAIL);
  await page.getByLabel(strings.login.passwordLabel).fill(e2ePassword());
  await page
    .getByRole("button", { name: strings.login.submit, exact: true })
    .click();
  await expect(page).toHaveURL("/");
  await expect(page.getByText(strings.home.signedInAs)).toContainText(
    E2E_EMAIL,
  );

  expect(violations, "Lỗi CSP trong console").toEqual([]);
});
