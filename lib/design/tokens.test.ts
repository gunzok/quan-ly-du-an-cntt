import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { contrastRatio, mix, TOKENS, type ThemeName } from "./tokens";

/**
 * Story E10-1 tiêu chí 1: token trong app/globals.css đúng bảng đã duyệt, và các cặp màu mà
 * component nền dùng đạt WCAG AA (chữ 4,5:1, điều khiển 3:1).
 */
const css = readFileSync(
  new URL("../../app/globals.css", import.meta.url),
  "utf8",
);

/** Lấy khai báo --color-* trong khối đầu tiên khớp bộ chọn. */
function block(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  expect(start, `không thấy khối ${selector}`).toBeGreaterThanOrEqual(0);
  const body = css.slice(start, css.indexOf("}", start));
  const result: Record<string, string> = {};
  for (const m of body.matchAll(/(--color-[a-z0-9-]+):\s*([^;]+);/g)) {
    result[m[1]] = m[2].trim().toLowerCase();
  }
  return result;
}

const light = block("\n:root");
const darkMedia = block(':root:not([data-theme="light"])');
const darkAttr = block(':root[data-theme="dark"]');

function resolved(theme: ThemeName): Record<string, string> {
  return theme === "light" ? light : { ...light, ...darkAttr };
}

describe("token màu trong globals.css", () => {
  it("chế độ sáng khớp bảng đã duyệt", () => {
    for (const [name, value] of Object.entries(TOKENS.light)) {
      expect(light[name], name).toBe(value);
    }
  });

  it("chế độ tối khớp bảng đã duyệt", () => {
    const dark = resolved("dark");
    for (const [name, value] of Object.entries(TOKENS.dark)) {
      expect(dark[name], name).toBe(value);
    }
  });

  it("tối theo hệ thống và tối theo data-theme giống hệt nhau", () => {
    expect(darkMedia).toEqual(darkAttr);
  });
});

/** Các cặp chữ/nền component nền dùng, ngưỡng theo WCAG 2.1 AA. */
const TEXT_PAIRS: [fg: string, bg: string][] = [
  ["--color-text", "--color-bg"],
  ["--color-text", "--color-bg-muted"],
  ["--color-text-muted", "--color-bg"],
  ["--color-text-muted", "--color-bg-subtle"],
  ["--color-text-muted", "--color-bg-muted"],
  ["--color-primary", "--color-bg"],
  ["--color-primary", "--color-bg-muted"],
  ["--color-on-primary", "--color-primary"],
  ["--color-on-primary", "--color-primary-hover"],
  ["--color-bg", "--color-danger"],
  ["--color-on-brand", "--color-brand"],
  ["--color-accent-text", "--color-bg"],
  ["--color-success", "--color-bg"],
  ["--color-success", "--color-bg-muted"],
  ["--color-warning", "--color-bg"],
  ["--color-warning", "--color-bg-muted"],
  ["--color-danger", "--color-bg"],
  ["--color-danger", "--color-bg-muted"],
];

const CONTROL_PAIRS: [fg: string, bg: string][] = [
  ["--color-border-strong", "--color-bg"],
  ["--color-primary", "--color-bg"],
];

describe.each(["light", "dark"] as const)(
  "tương phản WCAG AA (%s)",
  (theme) => {
    const t = TOKENS[theme];

    it.each(TEXT_PAIRS)("chữ %s trên %s đạt 4,5:1", (fg, bg) => {
      expect(contrastRatio(t[fg], t[bg])).toBeGreaterThanOrEqual(4.5);
    });

    it.each(CONTROL_PAIRS)("điều khiển %s trên %s đạt 3:1", (fg, bg) => {
      expect(contrastRatio(t[fg], t[bg])).toBeGreaterThanOrEqual(3);
    });

    it("nút nguy hiểm khi hover/nhấn (danger trộn 85%, 75% với text) vẫn đạt 4,5:1", () => {
      for (const alpha of [0.85, 0.75]) {
        const surface = mix(t["--color-danger"], alpha, t["--color-text"]);
        expect(contrastRatio(t["--color-bg"], surface)).toBeGreaterThanOrEqual(
          4.5,
        );
      }
    });
  },
);

describe("contrastRatio", () => {
  it("khớp số liệu trong design-system.md", () => {
    expect(contrastRatio("#0a0f1f", "#ffffff")).toBeCloseTo(19.07, 1);
    expect(contrastRatio("#2054f0", "#ffffff")).toBeCloseTo(5.85, 1);
    expect(contrastRatio("#e56daf", "#ffffff")).toBeCloseTo(2.94, 1);
  });
});
