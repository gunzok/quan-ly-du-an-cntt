import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Chỉ kiểm các chốt an toàn của scripts/deploy/backup.sh (không gọi Supabase): tham số sai, thư
 * mục đích nằm trong repo công khai, chuỗi kết nối sai dạng. Phần dump thật CHƯA kiểm chứng vì
 * chưa có dự án Supabase thật.
 */
const script = join(__dirname, "backup.sh");

function run(args: string[], env: Record<string, string> = {}) {
  return spawnSync("bash", [script, ...args], {
    encoding: "utf8",
    env: {
      PATH: process.env.PATH ?? "",
      HOME: tmpdir(),
      ...env,
    } as unknown as NodeJS.ProcessEnv,
    input: "",
  });
}

describe("scripts/deploy/backup.sh", () => {
  it("từ chối môi trường không phải staging/production", () => {
    const res = run(["dev"]);
    expect(res.status).toBe(2);
    expect(res.stderr).toMatch(/Cách dùng/);
  });

  it("từ chối ghi bản sao lưu vào trong repo", () => {
    const inside = join(__dirname, "tmp-backup-test-khong-commit");
    const res = run(["production", inside], {
      SUPABASE_DB_URL: "postgresql://x",
    });
    expect(res.status).toBe(1);
    expect(res.stderr).toMatch(/nằm trong repo/);
    expect(existsSync(inside)).toBe(false);
  });

  it("từ chối chuỗi kết nối không phải postgresql://", () => {
    const out = mkdtempSync(join(tmpdir(), "qlda-backup-"));
    try {
      const res = run(["staging", out], { SUPABASE_DB_URL: "https://x" });
      expect(res.status).toBe(1);
      expect(res.stderr).toMatch(/postgresql:\/\//);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });
});
