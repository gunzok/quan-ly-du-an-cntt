import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";

/**
 * Tài khoản thử cho e2e: một persona do `make db-seed` tạo (scripts/seed-local-users.ts),
 * mật khẩu lấy từ SEED_PASSWORD (biến môi trường, hoặc .env.local như db-seed; không commit).
 */
export const E2E_EMAIL = process.env.E2E_EMAIL ?? "pm@example.com";

export function e2ePassword(): string {
  const value = process.env.SEED_PASSWORD ?? readFromEnvLocal("SEED_PASSWORD");
  if (!value) {
    throw new Error(
      "Thiếu SEED_PASSWORD cho e2e. Đặt trong shell hoặc .env.local (giống make db-seed) rồi chạy lại make test-e2e.",
    );
  }
  return value;
}

function readFromEnvLocal(name: string): string | undefined {
  const file = ".env.local";
  return existsSync(file)
    ? parseEnv(readFileSync(file, "utf8"))[name]
    : undefined;
}
