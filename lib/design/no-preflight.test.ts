import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * app/globals.css KHÔNG nạp preflight của Tailwind (để /login và các trang CSS Modules giữ nguyên).
 * Hệ quả: `border-solid` làm mọi cạnh có độ dày mặc định của trình duyệt (medium, 3 px), nên viền
 * một cạnh (border-b, border-t-2...) phải kèm `border-0`. Test này quét components/ui và app/dev.
 */
const ROOTS = ["components/ui", "app/dev"];

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return files(path);
    return path.endsWith(".tsx") ? [path] : [];
  });
}

describe("class Tailwind khi không có preflight", () => {
  it.each(ROOTS.flatMap(files))("%s: viền một cạnh có border-0", (file) => {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(/"[^"]*"/g)) {
      const classes = match[0].slice(1, -1).split(/\s+/);
      const oneSide = classes.some((c) => /^border-[trblxy](-\d+)?$/.test(c));
      if (oneSide) {
        expect(classes, match[0]).toContain("border-0");
      }
    }
  });
});
