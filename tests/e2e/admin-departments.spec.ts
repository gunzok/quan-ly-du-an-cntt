import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { vi as strings } from "@/lib/i18n/messages/vi";
import { signIn } from "./login";

/**
 * Story E1-5 (QLDA-39): bộ lọc Phòng ban và hộp thoại danh mục phòng ban ở S08 (/admin/users).
 * Chỉ ĐỌC dữ liệu seed (scripts/seed-local-users.ts): không thêm/sửa phòng ban để không làm bẩn
 * stack dùng chung; thêm, đổi tên, lưu trữ đã có test tích hợp (tests/integration/departments.test.ts).
 *
 * CSDL cục bộ dùng chung có thêm tài khoản tạm/perf (vd. `perf-pm@example.com`, chưa gán phòng ban)
 * và bảng phân trang 50 dòng theo tên: so khớp email theo ô CHÍNH XÁC (`emailCell`), và tìm theo
 * email trước khi khẳng định một persona CÓ mặt (không phụ thuộc trang đầu).
 */
const ADMIN_EMAIL = "admin@example.com";
const SUPPORT_DEPARTMENT = "Phòng Hỗ trợ người dùng (mẫu)";

const BLOCKING_IMPACTS = new Set(["critical", "serious"]);
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

const t = strings.adminUsers;

/** Ô chứa đúng email này (không khớp chuỗi con như `perf-pm@example.com`). */
const emailCell = (table: Locator, email: string) =>
  table.getByText(email, { exact: true });

/** Gõ từ khóa vào ô tìm kiếm rồi Enter; chờ bảng tải xong. */
async function search(page: Page, query: string) {
  const box = page.getByRole("searchbox", { name: t.searchLabel });
  await box.fill(query);
  await box.press("Enter");
  await expect(page.getByRole("status").getByText(t.loading)).toHaveCount(0);
}

/**
 * Khẳng định persona CÓ trong danh sách: tìm theo email rồi bấm "Tải thêm" tới khi thấy ô email.
 * Từ khóa khớp chuỗi con nên có thể trả hơn một trang (vd. nhiều `e2e-…-pm@example.com`).
 */
async function expectListed(page: Page, table: Locator, email: string) {
  await search(page, email);
  const cell = emailCell(table, email);
  const more = page.getByRole("button", { name: t.loadMore, exact: true });
  await expect(async () => {
    if ((await cell.count()) === 0 && (await more.isVisible())) {
      await more.click();
    }
    await expect(cell).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 30_000 });
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
  await signIn(page, ADMIN_EMAIL);
  await page.goto("/admin/users");

  const table = page.getByRole("table", { name: t.tableCaption });
  await expectListed(page, table, ADMIN_EMAIL);
  await search(page, "");
  expect(await blockingViolations(page), "Lỗi trợ năng ở S08").toEqual([]);

  // Tiêu chí 2: lọc theo phòng ban chỉ hiện người thuộc phòng ban đó.
  const filter = page.getByLabel(`${t.departmentFilterLabel}:`);
  await filter.selectOption({ label: SUPPORT_DEPARTMENT });
  await expect(emailCell(table, "viewer@example.com")).toBeVisible();
  await expect(emailCell(table, "pm@example.com")).toHaveCount(0);
  await expect(emailCell(table, ADMIN_EMAIL)).toHaveCount(0);
  // Cột Phòng ban: tên (phần tử đầu) và nút "Đổi" trong cùng ô.
  const names = await table
    .locator("tbody tr td:nth-child(2) span:first-child")
    .allTextContents();
  expect(names.length).toBeGreaterThan(0);
  expect(new Set(names)).toEqual(new Set([SUPPORT_DEPARTMENT]));
  await expect(
    table.getByRole("button", {
      name: t.changeDepartmentAction("Người xem Thử"),
    }),
  ).toBeVisible();

  // Người chưa có phòng ban: các persona seed đều đã có phòng ban.
  await filter.selectOption({ label: t.departmentFilterNone });
  await expect(page.getByRole("status").getByText(t.loading)).toHaveCount(0);
  await expect(emailCell(table, "pm@example.com")).toHaveCount(0);

  await filter.selectOption({ label: t.departmentFilterAll });
  await expectListed(page, table, "pm@example.com");

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
