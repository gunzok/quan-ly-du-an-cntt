import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { strings } from "@/lib/strings";
import { signIn } from "../e2e/login";
import { TOKENS, type ThemeName } from "@/lib/design/tokens";

/**
 * Trang /dev/ui (Story E10-1) ở chế độ sáng và tối:
 * - tiêu chí 1: token màu đúng bảng đã duyệt, axe không có lỗi (gồm color-contrast WCAG AA);
 * - tiêu chí 2: Tab qua các component nền, vòng focus 2 px luôn thấy;
 * - vùng bấm 44 px ở màn 360 px (NFR-10).
 */
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const s = strings.devUi.sample;

/** Hai cách vào một chế độ: theo hệ thống (prefers-color-scheme) và ghi đè data-theme. */
const MODES: { name: string; scheme: ThemeName; dataTheme?: ThemeName }[] = [
  { name: "sáng theo hệ thống", scheme: "light" },
  { name: "tối theo hệ thống", scheme: "dark" },
  {
    name: "tối ghi đè data-theme trên hệ thống sáng",
    scheme: "light",
    dataTheme: "dark",
  },
  {
    name: "sáng ghi đè data-theme trên hệ thống tối",
    scheme: "dark",
    dataTheme: "light",
  },
];

async function openKit(page: Page, scheme: ThemeName, dataTheme?: ThemeName) {
  await page.emulateMedia({ colorScheme: scheme });
  await signIn(page);
  await page.goto("/dev/ui");
  await expect(
    page.getByRole("heading", { level: 1, name: strings.devUi.pageTitle }),
  ).toBeVisible();
  if (dataTheme) {
    await page.evaluate(
      (value) => document.documentElement.setAttribute("data-theme", value),
      dataTheme,
    );
  }
}

for (const mode of MODES) {
  const theme = mode.dataTheme ?? mode.scheme;

  test(`token màu và axe: ${mode.name}`, async ({ page }) => {
    await openKit(page, mode.scheme, mode.dataTheme);

    const actual = await page.evaluate((names) => {
      const probe = document.createElement("div");
      document.body.append(probe);
      const result: Record<string, string> = {};
      for (const name of names) {
        probe.style.color = `var(${name})`;
        result[name] = getComputedStyle(probe).color;
      }
      probe.remove();
      return result;
    }, Object.keys(TOKENS[theme]));

    const expected = await page.evaluate((tokens) => {
      const probe = document.createElement("div");
      document.body.append(probe);
      const result: Record<string, string> = {};
      for (const [name, value] of Object.entries(tokens)) {
        probe.style.color = value;
        result[name] = getComputedStyle(probe).color;
      }
      probe.remove();
      return result;
    }, TOKENS[theme]);
    expect(actual).toEqual(expected);

    // Utility Tailwind trỏ đúng token (không phải màu mặc định của thư viện).
    const primaryButton = page.getByRole("button", { name: s.primary }).first();
    await expect(primaryButton).toHaveCSS(
      "background-color",
      expected["--color-primary"],
    );
    await expect(primaryButton).toHaveCSS(
      "color",
      expected["--color-on-primary"],
    );

    const results = await new AxeBuilder({ page })
      .withTags(WCAG_TAGS)
      .analyze();
    const violations = results.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      targets: v.nodes.map((n) => n.target.join(" ")),
    }));
    expect(violations).toEqual([]);
  });
}

for (const scheme of ["light", "dark"] as const) {
  test(`Tab qua component nền thấy vòng focus 2 px (${scheme})`, async ({
    page,
  }) => {
    await openKit(page, scheme);
    const primary = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue(
        "--color-primary",
      ),
    );
    expect(primary.trim()).not.toBe("");

    await page.getByRole("main").getByRole("radio").first().focus();
    const seen: string[] = [];
    for (let i = 0; i < 60; i += 1) {
      await page.keyboard.press("Tab");
      const info = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        // Chỉ xét phần tử trong <main> (bỏ qua công cụ dev của Next.js chèn ngoài trang).
        if (!el || !el.closest("main")) return null;
        // Radio ẩn của bộ chọn chế độ: vòng focus vẽ trên nhãn bao ngoài.
        const target = el.matches("input.sr-only")
          ? (el.closest("label") ?? el)
          : el;
        const style = getComputedStyle(target);
        const rect = target.getBoundingClientRect();
        return {
          key: `${el.tagName}[${el.getAttribute("role") ?? ""}] ${el.getAttribute("aria-label") || (el as HTMLInputElement).labels?.[0]?.textContent?.trim() || el.textContent?.trim() || el.id}`,
          outlineStyle: style.outlineStyle,
          outlineWidth: style.outlineWidth,
          visible: rect.width > 0 && rect.height > 0,
        };
      });
      if (!info) continue;
      seen.push(info.key);
      expect.soft(info.visible, info.key).toBe(true);
      expect.soft(info.outlineStyle, info.key).toBe("solid");
      expect.soft(info.outlineWidth, info.key).toBe("2px");
    }
    // Đi qua đủ nút, ô nhập, ô chọn, công tắc, tab, hành động trạng thái rỗng.
    for (const name of [
      s.primary,
      s.nameLabel,
      s.selectLabel,
      s.checkboxLabel,
      s.switchLabel,
      s.tabOverview,
      s.emptyAction,
    ]) {
      expect(
        seen.some((key) => key.includes(name)),
        name,
      ).toBe(true);
    }
  });
}

test("vùng bấm từ 44 px ở màn 360 px", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await openKit(page, "light");
  const main = page.getByRole("main");
  const targets = main.locator(
    'button, input:not(.sr-only):not([type="checkbox"]), select, textarea, label:has(input[type="checkbox"]), label:has(input.sr-only)',
  );
  const count = await targets.count();
  expect(count).toBeGreaterThan(20);
  for (let i = 0; i < count; i += 1) {
    const box = await targets.nth(i).boundingBox();
    expect
      .soft(
        box?.height ?? 0,
        await targets.nth(i).evaluate((el) => el.outerHTML.slice(0, 80)),
      )
      .toBeGreaterThanOrEqual(44);
  }
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth >
      document.documentElement.clientWidth,
  );
  expect(overflow).toBe(false);
});

test("hộp thoại xác nhận: focus vào Hủy, Esc đóng, xác nhận hiện toast role=status", async ({
  page,
}) => {
  await openKit(page, "light");
  const trigger = page.getByRole("button", { name: s.openDialog });
  await trigger.click();
  const dialog = page.getByRole("alertdialog", { name: s.dialogTitle });
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: strings.ui.cancel }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();

  await trigger.click();
  await dialog.getByRole("button", { name: s.dialogConfirm }).click();
  await expect(dialog).toBeHidden();
  await expect(
    page.getByRole("status").filter({ hasText: s.dialogDone }),
  ).toBeVisible();

  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  expect(results.violations.map((v) => v.id)).toEqual([]);
});

test("toast đóng được bằng bàn phím", async ({ page }) => {
  await openKit(page, "dark");
  await page.getByRole("button", { name: s.toastError }).click();
  const region = page.getByRole("status").filter({ hasText: s.toastErrorText });
  await expect(region).toBeVisible();
  const dismiss = page.getByRole("button", { name: strings.ui.toast.dismiss });
  await dismiss.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText(s.toastErrorText)).toBeHidden();
});
