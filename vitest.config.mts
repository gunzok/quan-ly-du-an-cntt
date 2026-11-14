import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Khớp "paths" trong tsconfig.json.
    alias: { "@": fileURLToPath(new URL("./", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["**/*.test.{ts,tsx}"],
    // tests/e2e/ là test Playwright (*.spec.ts), chạy bằng `make test-e2e`, không qua Vitest.
    exclude: ["node_modules/**", ".next/**", "tests/e2e/**"],
    globalSetup: ["./tests/integration/global-setup.ts"],
  },
});
