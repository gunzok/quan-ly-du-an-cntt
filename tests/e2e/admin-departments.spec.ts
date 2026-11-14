import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { strings } from "@/lib/strings";
import { e2ePassword } from "./env";

/**
 * Story E1-5 (QLDA-39): bộ lọc Phòng ban và hộp thoại danh mục phòng ban ở S08 (/admin/users).
 * Chỉ ĐỌC dữ liệu seed (scripts/seed-local-users.ts): không thêm/sửa phòng ban để không làm bẩn
 * stack dùng chung; thêm, đổi tên, lưu trữ đã có test tích hợp (tests/integration/departments.test.ts).
 */
const ADMIN_EMAIL = "admin@example.com";
const SUPPORT_DEPARTMENT = "Phòng Hỗ trợ người dùng (mẫu)";

const BLOCKING_IMPACTS = new Set(["critical", "serious"]);
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

const t = strings.adminUsers;

async function signInAsAdmin(page: Page) {
  await page.goto("/login");
  await page.getByLabel(strings.login.emailLabel).fill(ADMIN_EMAIL);
  await page.getByLabel(strings.login.passwordLabel).fill(e2ePassword());
  await page
    .getByRole("button", { name: strings.login.submit, exact: true })
    .click();
  await expect(page).toHaveURL("/");
}

async function blockingViolations(page: Page, include?: string) {
  let builder = new AxeBuilder({ page }).withTags(WCAG_TAGS);
  if (include) builder = builder.include(include);
  const results = await builder.analyze();
  return results.violations
    .filter((v) => v.impact && BLOCKING_IMPACTS.has(v.impact))
    .flatMap((v) => v.nodes.map((n) => `${v.id} @ ${n.target.join(" ")}`));
}

test("Admin lọc người dùng theo Phòng ban và mở danh mục phòng ban", async ({
  page,
}) => {
  await signInAsAdmin(page);
  await page.goto("/admin/users");

  const table = page.getByRole("table", { name: t.tableCaption });
  await expect(table.getByText(ADMIN_EMAIL)).toBeVisible();
  expect(await blockingViolations(page), "Lỗi trợ năng ở S08").toEqual([]);

  // Tiêu chí 2: lọc theo phòng ban chỉ hiện người thuộc phòng ban đó.
  const filter = page.getByLabel(`${t.departmentFilterLabel}:`);
  await filter.selectOption({ label: SUPPORT_DEPARTMENT });
  await expect(table.getByText("viewer@example.com")).toBeVisible();
  await expect(table.getByText("pm@example.com")).toHaveCount(0);
  await expect(table.getByText(ADMIN_EMAIL)).toHaveCount(0);
  for (const cell of await table
    .locator("tbody tr td:nth-child(2)")
    .allTextContents()) {
    expect(cell).toBe(SUPPORT_DEPARTMENT);
  }

  // Người chưa có phòng ban: các persona seed đều đã có phòng ban.
  await filter.selectOption({ label: t.departmentFilterNone });
  await expect(page.getByRole("status").getByText(t.loading)).toHaveCount(0);
  await expect(table.getByText("pm@example.com")).toHaveCount(0);

  await filter.selectOption({ label: t.departmentFilterAll });
  await expect(table.getByText("pm@example.com")).toBeVisible();

  // Hộp thoại danh mục: mở bằng bàn phím, có danh sách, Esc đóng và trả focus.
  const manage = page.getByRole("button", { name: t.manageDepartments });
  await manage.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: strings.departments.title });
  await expect(dialog).toBeVisible();
  await expect(
    dialog
      .getByRole("list", { name: strings.departments.listLabel })
      .getByText(SUPPORT_DEPARTMENT),
  ).toBeVisible();
  await expect(
    dialog.getByLabel(strings.departments.addLabel, { exact: true }),
  ).toBeVisible();
  expect(
    await blockingViolations(page, "dialog[open]"),
    "Lỗi trợ năng ở hộp thoại phòng ban",
  ).toEqual([]);

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(manage).toBeFocused();
});
