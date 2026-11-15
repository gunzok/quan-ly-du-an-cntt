import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { strings } from "@/lib/strings";
import { e2ePassword } from "./env";

/**
 * Story E1-7 (QLDA-80): nhận lời mời và đặt mật khẩu ở /auth/accept-invite.
 * Admin mời qua API thật (POST /api/v1/users/invitations) → lấy link từ Mailpit → người được mời
 * đặt mật khẩu → vào ứng dụng → đăng xuất, đăng nhập lại bằng mật khẩu mới. Link dùng lần hai và
 * link giả bị từ chối; axe không lỗi critical/serious; 360 px không tràn ngang.
 * Tài khoản tạm bị xóa sau test (khóa service_role của stack CỤC BỘ do `make test-e2e` đặt).
 */
const ADMIN_EMAIL = "admin@example.com";
const MAILPIT_URL = process.env.MAILPIT_URL ?? "http://127.0.0.1:54324";
const BLOCKING_IMPACTS = new Set(["critical", "serious"]);
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const t = strings.acceptInvite;

const createdIds: string[] = [];

test.afterAll(async () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return;
  for (const id of createdIds) {
    await fetch(`${url}/auth/v1/admin/users/${id}`, {
      method: "DELETE",
      headers: { apikey: key, authorization: `Bearer ${key}` },
    });
  }
});

async function blockingViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  return results.violations
    .filter((v) => v.impact && BLOCKING_IMPACTS.has(v.impact))
    .flatMap((v) => v.nodes.map((n) => `${v.id} @ ${n.target.join(" ")}`));
}

async function expectNoHorizontalScroll(page: Page) {
  await page.setViewportSize({ width: 360, height: 740 });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow, "Trang tràn ngang ở 360 px").toBeLessThanOrEqual(0);
  await page.setViewportSize({ width: 1280, height: 720 });
}

async function signIn(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel(strings.login.emailLabel).fill(email);
  await page.getByLabel(strings.login.passwordLabel).fill(password);
  await page
    .getByRole("button", { name: strings.login.submit, exact: true })
    .click();
  await expect(page).toHaveURL("/");
}

/** Link /auth/accept-invite trong email mới nhất ở Mailpit, đổi origin sang server e2e. */
async function inviteLinkFromMailpit(email: string, baseURL: string) {
  const query = encodeURIComponent(`to:"${email}"`);
  for (let i = 0; i < 40; i++) {
    const search = await fetch(`${MAILPIT_URL}/api/v1/search?query=${query}`);
    const { messages } = (await search.json()) as {
      messages?: { ID: string }[];
    };
    if (messages?.length) {
      const res = await fetch(
        `${MAILPIT_URL}/api/v1/message/${messages[0].ID}`,
      );
      const { HTML } = (await res.json()) as { HTML?: string };
      const href = (HTML ?? "")
        .replace(/&amp;/g, "&")
        .match(/href="([^"]*\/auth\/accept-invite\?[^"]+)"/)?.[1];
      if (!href) throw new Error("Email mời không có link /auth/accept-invite");
      const link = new URL(href);
      return new URL(`${link.pathname}${link.search}`, baseURL).toString();
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Không thấy email mời gửi tới ${email} ở Mailpit`);
}

async function fillAndSubmit(page: Page, password: string, confirm = password) {
  await page.getByLabel(t.passwordLabel).fill(password);
  await page.getByLabel(t.confirmLabel).fill(confirm);
  await page.getByRole("button", { name: t.submit }).click();
}

test("mời → link từ Mailpit → đặt mật khẩu → vào ứng dụng → đăng nhập lại; link dùng lần hai bị từ chối", async ({
  browser,
  baseURL,
}) => {
  const email = `e2e-e1-7-${randomUUID()}@example.com`;
  const password = `E2e-${randomUUID()}`;

  // Admin mời qua API thật (cùng origin, cookie phiên của Admin).
  const adminContext = await browser.newContext();
  const adminPage = await adminContext.newPage();
  await signIn(adminPage, ADMIN_EMAIL, e2ePassword());
  const invited = await adminPage.request.post("/api/v1/users/invitations", {
    data: { email },
    headers: { origin: baseURL ?? "" },
  });
  expect(invited.status()).toBe(201);
  createdIds.push(((await invited.json()) as { data: { id: string } }).data.id);
  await adminContext.close();

  const link = await inviteLinkFromMailpit(email, baseURL ?? "");

  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(link);
  await expect(page.getByRole("heading", { name: t.heading })).toBeVisible();
  expect(await blockingViolations(page), "Lỗi trợ năng ở form").toEqual([]);
  await expectNoHorizontalScroll(page);

  // Lỗi rõ ràng, gắn với ô nhập; token chưa bị tiêu.
  await fillAndSubmit(page, "ngan", "khac");
  await expect(page.getByText(t.fieldErrors.password.too_short)).toBeVisible();
  await expect(page.getByText(t.fieldErrors.confirm.mismatch)).toBeVisible();
  await expect(page.getByLabel(t.passwordLabel)).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  expect(await blockingViolations(page), "Lỗi trợ năng khi có lỗi").toEqual([]);

  await fillAndSubmit(page, password);
  await expect(page).toHaveURL("/");
  await expect(page.getByText(email)).toBeVisible();
  // Cookie phiên httpOnly.
  const cookies = await context.cookies();
  const session = cookies.filter((c) => /^sb-.+-auth-token/.test(c.name));
  expect(session.length).toBeGreaterThan(0);
  for (const c of session) expect(c.httpOnly).toBe(true);

  // Đã đăng nhập mở lại link: về trang chủ.
  await page.goto(link);
  await expect(page).toHaveURL("/");

  // Đăng xuất rồi đăng nhập lại bằng mật khẩu mới.
  await page.getByRole("button", { name: strings.home.signOut }).click();
  await expect(page).toHaveURL("/login");
  await signIn(page, email, password);
  await page.getByRole("button", { name: strings.home.signOut }).click();
  await expect(page).toHaveURL("/login");

  // Link dùng lần hai: thông báo link không dùng được, hướng dẫn xin Admin gửi lại.
  await page.goto(link);
  await fillAndSubmit(page, `Khac-${randomUUID()}`);
  await expect(
    page.getByRole("heading", { name: t.invalidHeading }),
  ).toBeVisible();
  await expect(page.getByText(t.invalidAction)).toBeVisible();
  await expect(page).toHaveURL(/\/auth\/accept-invite/);
  await context.close();
});

test("link giả bị từ chối như link hết hạn; thiếu token thì báo ngay; axe, CSP và 360 px", async ({
  page,
}) => {
  const cspErrors: string[] = [];
  page.on("console", (m) => {
    if (/content security policy/i.test(m.text())) cspErrors.push(m.text());
  });
  page.on("pageerror", (e) => cspErrors.push(`pageerror: ${e.message}`));
  await page.goto(
    `/auth/accept-invite?token_hash=${"0".repeat(56)}&type=invite`,
  );
  const pw = `Gia-${randomUUID()}`;
  await fillAndSubmit(page, pw);
  await expect(
    page.getByRole("heading", { name: t.invalidHeading }),
  ).toBeVisible();
  expect(await page.context().cookies()).not.toContainEqual(
    expect.objectContaining({ name: expect.stringMatching(/auth-token$/) }),
  );

  await page.goto("/auth/accept-invite?type=invite&next=https://evil.example");
  await expect(
    page.getByRole("heading", { name: t.invalidHeading }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: t.backToLogin })).toHaveAttribute(
    "href",
    "/login",
  );
  expect(await blockingViolations(page), "Lỗi trợ năng ở trang lỗi").toEqual(
    [],
  );
  await expectNoHorizontalScroll(page);
  expect(cspErrors, "Lỗi CSP/JS trong console").toEqual([]);
});
