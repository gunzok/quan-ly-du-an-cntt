import { expect, test } from "@playwright/test";
import { signIn } from "./login";

/**
 * Story E10-1: trang xem thử component chỉ có ở môi trường phát triển. Job e2e chạy bản
 * production (`next build` + `next start`) nên /dev/ui phải trả 404 kể cả khi đã đăng nhập.
 */
test("bản production không có trang xem thử /dev/ui", async ({ page }) => {
  await signIn(page);
  const response = await page.goto("/dev/ui");
  expect(response?.status()).toBe(404);
});
