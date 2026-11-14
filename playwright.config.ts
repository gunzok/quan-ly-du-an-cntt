import { defineConfig, devices } from "@playwright/test";

/**
 * Cấu hình e2e (Story E0-3, QLDA-34). Chạy: `make test-e2e` (cần `make db-start` và
 * `SEED_PASSWORD=... make db-seed` trước). Target đó build ứng dụng với khóa Supabase cục bộ
 * rồi gọi Playwright; Playwright tự bật `next start` ở cổng E2E_PORT và tắt khi xong.
 */
const PORT = Number(process.env.E2E_PORT ?? 3100);
const BASE_URL = `http://localhost:${PORT}`;
const isCI = Boolean(process.env.CI);

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "**/*.spec.ts",
  fullyParallel: true,
  forbidOnly: isCI,
  // CI thử lại 1 lần để lộ test chập chờn (báo "flaky"), không che lỗi thật.
  retries: isCI ? 1 : 0,
  workers: isCI ? 2 : undefined,
  reporter: isCI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: BASE_URL,
    locale: "vi-VN",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `pnpm exec next start --port ${PORT}`,
    url: `${BASE_URL}/login`,
    // Không dùng lại server sẵn có: tránh chạy nhầm vào bản build cũ hoặc worktree khác.
    reuseExistingServer: false,
    timeout: 60_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
