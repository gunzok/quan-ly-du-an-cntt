import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { vi as strings } from "@/lib/i18n/messages/vi";
import { signIn } from "./login";
import { serviceClient, TEMP_PROJECT_PREFIX } from "./temp-data";

/**
 * Story E2-1 (QLDA-37): S02 Danh sách dự án ở trang chủ.
 * Dự án tạo trong test mang mã ngẫu nhiên của lần chạy; luồng chính tự dọn bằng nút "Xóa vĩnh
 * viễn" của Admin, afterAll dọn phần còn sót (khi test đỏ giữa chừng) bằng khóa service của stack
 * CỤC BỘ (make test-e2e đặt SUPABASE_SERVICE_ROLE_KEY), để không làm bẩn stack dùng chung.
 * Dự án seed (scripts/seed-local-users.ts) chỉ được ĐỌC.
 */
const t = strings.projects;
const SEED_A = "Dự án mẫu A: Nâng cấp hạ tầng mạng";
const BLOCKING_IMPACTS = new Set(["critical", "serious"]);
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const tag = randomUUID().slice(0, 8);

async function signInAs(page: Page, email: string) {
  await signIn(page, email);
  await expect(
    page.getByRole("heading", { level: 1, name: t.pageTitle }),
  ).toBeVisible();
}

async function blockingViolations(page: Page, include?: string) {
  // Chờ hiệu ứng mở hộp thoại (fade-in) xong: axe đo màu lúc đang mờ sẽ báo sai tương phản.
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getComputedTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => undefined)),
    ),
  );
  let builder = new AxeBuilder({ page }).withTags(WCAG_TAGS);
  if (include) builder = builder.include(include);
  const results = await builder.analyze();
  return results.violations
    .filter((v) => v.impact && BLOCKING_IMPACTS.has(v.impact))
    .flatMap((v) => v.nodes.map((n) => `${v.id} @ ${n.target.join(" ")}`));
}

const projectList = (page: Page) =>
  page.getByRole("list", { name: t.listLabel });
const card = (page: Page, name: string) =>
  projectList(page)
    .getByRole("listitem")
    .filter({
      has: page.getByRole("heading", { name, exact: true }),
    });

test.afterAll(async () => {
  // Dự án tạo qua giao diện nên không biết id trước: xóa theo tên (tiền tố E2E + tag của lần chạy).
  const { error } = await serviceClient()
    .from("projects")
    .delete()
    .like("name", `${TEMP_PROJECT_PREFIX}${tag}%`);
  if (error) console.warn(`[e2e] Chưa dọn được dự án E2E ${tag}:`, error);
});

test.describe.serial("PM tạo, sửa, lưu trữ; Admin xóa vĩnh viễn", () => {
  const name = `E2E ${tag} Hệ thống tài sản`;
  const renamed = `E2E ${tag} Hệ thống tài sản CNTT`;

  test("PM tạo, sửa và lưu trữ dự án (sáng)", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await signInAs(page, "member@example.com");
    await expect(card(page, SEED_A)).toBeVisible();
    await expect(
      card(page, SEED_A).getByRole("progressbar", {
        name: t.card.progressOf(SEED_A),
      }),
    ).toBeVisible();
    expect(await blockingViolations(page), "Lỗi trợ năng ở S02").toEqual([]);

    // Mở hộp thoại tạo bằng bàn phím; ô tên nhận focus đầu tiên.
    const createButton = page.getByRole("button", { name: t.create });
    await createButton.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: t.form.createTitle });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel(t.form.name)).toBeFocused();
    expect(
      await blockingViolations(page, '[role="dialog"]'),
      "Lỗi trợ năng ở hộp thoại tạo dự án",
    ).toEqual([]);

    // Kiểm tra phía trình duyệt: thiếu tên, ngày kết thúc trước ngày bắt đầu.
    await dialog.getByRole("button", { name: t.form.submitCreate }).click();
    await expect(dialog.getByText(t.form.nameRequired)).toBeVisible();
    await expect(dialog.getByLabel(t.form.name)).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    await dialog.getByLabel(t.form.name).fill(name);
    await dialog.getByLabel(t.form.descriptionLabel).fill("Theo dõi tài sản.");
    await dialog.getByLabel(t.form.startDate).fill("2027-04-30");
    await dialog.getByLabel(t.form.endDate).fill("2027-01-01");
    await dialog.getByRole("button", { name: t.form.submitCreate }).click();
    await expect(dialog.getByText(t.errors.dateOrder)).toBeVisible();
    await dialog.getByLabel(t.form.startDate).fill("2026-11-16");
    await dialog.getByLabel(t.form.endDate).fill("2027-04-30");
    await dialog.getByRole("button", { name: t.form.submitCreate }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText(t.done.created(name))).toBeVisible();

    // AC1: người tạo là PM của dự án mới.
    const created = card(page, name);
    await expect(created).toBeVisible();
    await expect(
      created.getByText(`${t.card.eyebrow} / ${t.roles.pm}`),
    ).toBeVisible();
    await expect(created.getByText(t.card.members(1))).toBeVisible();
    await expect(created.getByText("30/04/2027")).toBeVisible();

    // Sửa tên.
    await created
      .getByRole("button", { name: `${t.card.edit} ${name}` })
      .click();
    const edit = page.getByRole("dialog", { name: t.form.editTitle });
    await expect(edit.getByLabel(t.form.name)).toHaveValue(name);
    await edit.getByLabel(t.form.name).fill(renamed);
    await edit.getByRole("button", { name: t.form.submitEdit }).click();
    await expect(edit).toBeHidden();
    await expect(card(page, renamed)).toBeVisible();

    // Lưu trữ có xác nhận; Hủy thì không đổi.
    const archive = card(page, renamed).getByRole("button", {
      name: `${t.card.archive} ${renamed}`,
    });
    await archive.click();
    let confirm = page.getByRole("alertdialog", {
      name: t.confirm.archiveTitle(renamed),
    });
    await expect(confirm).toBeVisible();
    await expect(
      confirm.getByRole("button", { name: strings.ui.cancel }),
    ).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(confirm).toBeHidden();
    await expect(card(page, renamed)).toBeVisible();

    await archive.click();
    confirm = page.getByRole("alertdialog", {
      name: t.confirm.archiveTitle(renamed),
    });
    await confirm.getByRole("button", { name: t.card.archive }).click();
    await expect(page.getByText(t.done.archived(renamed))).toBeVisible();
    await expect(card(page, renamed)).toHaveCount(0);

    // PM không có nút xóa vĩnh viễn.
    await page.getByRole("tab", { name: /^Lưu trữ/ }).click();
    const archivedCard = card(page, renamed);
    await expect(archivedCard).toBeVisible();
    await expect(archivedCard.getByText(t.card.archived)).toBeVisible();
    await expect(
      archivedCard.getByRole("button", { name: `${t.card.delete} ${renamed}` }),
    ).toHaveCount(0);
    await expect(
      archivedCard.getByRole("button", {
        name: `${t.card.restore} ${renamed}`,
      }),
    ).toBeVisible();
  });

  test("Admin thấy dự án lưu trữ và xóa vĩnh viễn có xác nhận (tối)", async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await signInAs(page, "admin@example.com");
    // Admin thấy cả dự án mình không thuộc (AC2).
    await expect(card(page, SEED_A)).toBeVisible();
    await expect(
      card(page, SEED_A).getByText(`${t.card.eyebrow} / ${t.roles.admin}`),
    ).toBeVisible();
    expect(await blockingViolations(page), "Lỗi trợ năng ở S02 (tối)").toEqual(
      [],
    );

    await page.getByRole("tab", { name: /^Lưu trữ/ }).click();
    const target = card(page, renamed);
    await target
      .getByRole("button", { name: `${t.card.delete} ${renamed}` })
      .click();
    const confirm = page.getByRole("alertdialog", {
      name: t.confirm.deleteTitle(renamed),
    });
    await expect(confirm.getByText(t.confirm.deleteBody)).toBeVisible();
    expect(
      await blockingViolations(page, '[role="alertdialog"]'),
      "Lỗi trợ năng ở hộp thoại xóa (tối)",
    ).toEqual([]);
    await confirm.getByRole("button", { name: t.card.delete }).click();
    await expect(page.getByText(t.done.deleted(renamed))).toBeVisible();
    await expect(card(page, renamed)).toHaveCount(0);
  });
});

test("Người xem: chỉ thấy dự án mình thuộc, không có nút tạo, sửa, lưu trữ (tối)", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await signInAs(page, "viewer@example.com");
  const seed = card(page, SEED_A);
  await expect(seed).toBeVisible();
  await expect(
    seed.getByText(`${t.card.eyebrow} / ${t.roles.viewer}`),
  ).toBeVisible();
  // AC2: dự án mẫu B không có Người xem này.
  await expect(card(page, "Dự án mẫu B: Cổng thông tin nội bộ")).toHaveCount(0);
  await expect(page.getByRole("button", { name: t.create })).toHaveCount(0);
  await expect(seed.getByRole("button")).toHaveCount(0);
  expect(await blockingViolations(page), "Lỗi trợ năng ở S02 (tối)").toEqual(
    [],
  );

  // Lọc theo tên: không khớp thì hiện trạng thái rỗng.
  await page
    .getByRole("searchbox", { name: t.searchLabel })
    .fill(`không-có-${tag}`);
  await expect(
    page.getByRole("heading", { name: t.emptySearchTitle }),
  ).toBeVisible();
});

test("360 px: không tràn ngang, vùng bấm tối thiểu 44 px", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await signInAs(page, "member@example.com");
  await expect(card(page, SEED_A)).toBeVisible();

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);

  const targets = page.locator(
    "main button, main input, aside a, aside button",
  );
  const count = await targets.count();
  expect(count).toBeGreaterThan(0);
  for (let i = 0; i < count; i++) {
    const box = await targets.nth(i).boundingBox();
    if (!box) continue;
    expect(box.height, `Vùng bấm thứ ${i}`).toBeGreaterThanOrEqual(44);
  }
  expect(await blockingViolations(page), "Lỗi trợ năng ở S02 (360 px)").toEqual(
    [],
  );
});
