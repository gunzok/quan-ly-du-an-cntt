import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

/** Mức lỗi axe làm CI đỏ (test-strategy.md mục 2). */
const BLOCKING_IMPACTS = new Set(["critical", "serious"]);

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/**
 * Lỗi đã biết, đang chờ sửa ở Story khác. Khớp theo cặp (luật, phần tử) nên lỗi MỚI vẫn làm đỏ;
 * khi lỗi đã được sửa mà mục ở đây còn, test cũng đỏ để buộc xóa mục (không để danh sách mục rữa).
 *
 * - label-content-name-mismatch (WCAG 2.5.3): nút ngôn ngữ hiện "VI"/"EN" nhưng aria-label là
 *   "Tiếng Việt"/"English (sắp có)". Sửa ở app/login/language-switcher.tsx (vùng Story E1-2 đang
 *   sửa nên E0-3 không đụng); hướng sửa: aria-label chứa chữ hiển thị, ví dụ "VI, Tiếng Việt".
 */
const KNOWN_VIOLATIONS: Record<string, string[]> = {
  "/login": [
    'label-content-name-mismatch @ button[aria-label="Tiếng Việt"]',
    'label-content-name-mismatch @ button[aria-label="English (sắp có)"]',
  ],
};

for (const path of Object.keys(KNOWN_VIOLATIONS)) {
  test(`trang ${path} không có lỗi trợ năng mức critical, serious`, async ({
    page,
  }) => {
    await page.goto(path);
    await expect(page.getByRole("main")).toBeVisible();

    const results = await new AxeBuilder({ page })
      .withTags(WCAG_TAGS)
      .analyze();

    const blocking = results.violations
      .filter((v) => v.impact && BLOCKING_IMPACTS.has(v.impact))
      .flatMap((v) =>
        v.nodes.map((n) => ({
          key: `${v.id} @ ${n.target.join(" ")}`,
          impact: v.impact,
          help: v.help,
        })),
      );
    const known = new Set(KNOWN_VIOLATIONS[path]);

    const unexpected = blocking.filter((b) => !known.has(b.key));
    expect(unexpected, "Lỗi trợ năng mức critical/serious mới").toEqual([]);

    const found = new Set(blocking.map((b) => b.key));
    const fixed = [...known].filter((key) => !found.has(key));
    expect(
      fixed,
      "Lỗi đã biết không còn: xóa khỏi KNOWN_VIOLATIONS trong tests/e2e/a11y.spec.ts",
    ).toEqual([]);
  });
}
