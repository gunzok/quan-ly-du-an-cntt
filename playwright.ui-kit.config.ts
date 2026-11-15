import { defineConfig, devices } from "@playwright/test";

/**
 * Kiểm tra trang xem thử component /dev/ui (Story E10-1). Trang này chỉ có ở `next dev` nên
 * cấu hình riêng, KHÔNG chạy trong CI (job e2e dùng bản production). Chạy cục bộ:
 *   make db-start && SEED_PASSWORD=... make db-seed
 *   SEED_PASSWORD=... pnpm test:ui-kit
 * Cần NEXT_PUBLIC_SUPABASE_URL/ANON_KEY (lấy từ `supabase status`, xem script test:ui-kit).
 */
const PORT = Number(process.env.UI_KIT_PORT ?? 3200);
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./tests/ui-kit",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  timeout: 60_000,
  use: {
    baseURL: BASE_URL,
    locale: "vi-VN",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `pnpm exec next dev --port ${PORT}`,
    url: `${BASE_URL}/login`,
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
