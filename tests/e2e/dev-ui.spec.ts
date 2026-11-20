import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";
import { signInWithPassword } from "./login";
import { cleanupTempData, createTempUsers, serviceClient } from "./temp-data";

/**
 * Story E10-1: trang xem thử component chỉ có ở môi trường phát triển. Job e2e chạy bản
 * production (`next build` + `next start`) nên /dev/ui phải trả 404 kể cả khi đã đăng nhập.
 * Người đăng nhập là tài khoản tạm (QLDA-56; trước dùng persona seed pm@).
 */
const tag = randomUUID().slice(0, 8);
const user = {
  email: `e2e-e10-1-${tag}@example.com`,
  password: `E2e-${randomUUID()}`,
  fullName: `E2E Xem thử ${tag}`,
};
let service: SupabaseClient | null = null;
const ids: { user?: string } = {};

test.beforeAll(async () => {
  service = serviceClient();
  await createTempUsers(service, { user }, ids);
});

test.afterAll(async () => {
  await cleanupTempData(service, { userIds: [ids.user] });
});

test("bản production không có trang xem thử /dev/ui", async ({ page }) => {
  await signInWithPassword(page, user.email, user.password);
  const response = await page.goto("/dev/ui");
  expect(response?.status()).toBe(404);
});
