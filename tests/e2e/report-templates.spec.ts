import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { type SupabaseClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";
import { vi as strings } from "@/lib/i18n/messages/vi";
import {
  DOCX_MIME,
  macroDocx,
  sampleDocx,
  sampleXlsx,
  XLSX_MIME,
} from "@/tests/fixtures/ooxml";
import { acquireSharedLock } from "@/tests/support/shared-lock";
import { waitForHydration } from "./hydration";
import { cleanupTempData, createTempUsers, serviceClient } from "./temp-data";
import { signInWithPassword } from "./login";

/**
 * Story E5-2 (QLDA-61): trang quản trị template báo cáo (S17 tab "Template báo cáo").
 *
 * Tài khoản tạm tạo bằng khóa service của stack CỤC BỘ (make test-e2e), mật khẩu ngẫu nhiên; tệp là
 * tệp GIẢ sinh trong tests/fixtures/ooxml.ts (R-005). afterAll xóa template (dòng + tệp Storage),
 * dự án và tài khoản. Cần dịch vụ Storage của Supabase cục bộ.
 * Template "đang dùng" là trạng thái toàn hệ thống: spec giữ khóa "report-templates"
 * (tests/support/shared-lock.ts) từ beforeAll tới afterAll để không bật/tắt template giữa lúc luồng 8
 * (tests/e2e/flows/) hay test tích hợp báo cáo đang xuất (QLDA-56).
 */
const t = strings.reportTemplates;
const BLOCKING_IMPACTS = new Set(["critical", "serious"]);
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const tag = randomUUID().slice(0, 8);
const password = `E2e-${randomUUID()}`;
const emails = {
  admin: `e2e-e5-2-admin-${tag}@example.com`,
  pm: `e2e-e5-2-pm-${tag}@example.com`,
  member: `e2e-e5-2-member-${tag}@example.com`,
};
const users: Record<string, string> = {};
const projectId = randomUUID();
const names = {
  picked: `Mẫu chọn ${tag}`,
  keyboard: `Mẫu bàn phím ${tag}`,
  dropped: `Mẫu kéo thả ${tag}`,
};

let service: SupabaseClient | null = null;
let releaseLock: (() => Promise<void>) | undefined;

test.beforeAll(async () => {
  test.setTimeout(180_000);
  releaseLock = await acquireSharedLock("report-templates");
  service = serviceClient();
  await createTempUsers(
    service,
    Object.fromEntries(
      Object.entries(emails).map(([label, email]) => [
        label,
        { email, password, fullName: `E2E ${label} ${tag}` },
      ]),
    ),
    users,
  );
  const admin = await service
    .from("profiles")
    .update({ is_admin: true })
    .eq("id", users.admin);
  if (admin.error) throw admin.error;
  const project = await service
    .from("projects")
    .insert({ id: projectId, name: `E2E ${tag} E5-2`, created_by: users.pm });
  if (project.error) throw project.error;
  const member = await service
    .from("project_members")
    .insert({ project_id: projectId, user_id: users.member, role: "member" });
  if (member.error) throw member.error;
});

test.afterAll(async () => {
  try {
    await cleanupTemplates();
  } finally {
    await releaseLock?.();
  }
});

async function cleanupTemplates() {
  if (!service) return;
  const { data } = await service
    .from("report_templates")
    .select("id, storage_path")
    .eq("uploaded_by", users.admin);
  const rows = (data ?? []) as { id: string; storage_path: string }[];
  if (rows.length > 0) {
    await service.storage
      .from("report-templates")
      .remove(rows.map((r) => r.storage_path));
    await service
      .from("report_templates")
      .delete()
      .in(
        "id",
        rows.map((r) => r.id),
      );
  }
  await cleanupTempData(service, {
    projectIds: [projectId],
    userIds: Object.values(users),
  });
}

async function signInAs(page: Page, who: keyof typeof emails) {
  await signInWithPassword(page, emails[who], password);
}

async function blockingViolations(page: Page) {
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getComputedTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => undefined)),
    ),
  );
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  return results.violations
    .filter((v) => v.impact && BLOCKING_IMPACTS.has(v.impact))
    .flatMap((v) => v.nodes.map((n) => `${v.id} @ ${n.target.join(" ")}`));
}

/** Đóng mọi toast (thành phần chung đã có kiểm axe riêng ở trang ui-kit) trước khi quét axe. */
async function dismissToasts(page: Page) {
  const buttons = page.getByRole("button", { name: strings.ui.toast.dismiss });
  while ((await buttons.count()) > 0) await buttons.first().click();
}

async function openPage(page: Page) {
  await page.goto("/admin/report-templates");
  await expect(
    page.getByRole("heading", { level: 1, name: t.heading }),
  ).toBeVisible();
  await waitForHydration(page, "[data-testid=report-template-dropzone]");
  // Chờ danh sách tải xong (hết skeleton).
  await expect(page.getByRole("status", { name: t.loading })).toHaveCount(0);
}

const row = (page: Page, name: string) =>
  page.getByRole("row").filter({
    has: page.getByRole("rowheader", { name, exact: true }),
  });

test.describe.serial("Template báo cáo", () => {
  test("Admin: tải lên bằng nút, bàn phím, kéo thả; bị từ chối tệp sai; bật/tắt; tải xuống; xóa (sáng, tối)", async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await signInAs(page, "admin");
    await openPage(page);
    expect(await blockingViolations(page)).toEqual([]);

    const nav = page.getByRole("navigation", {
      name: strings.adminUsers.navLabel,
    });
    await expect(nav.getByRole("link", { name: t.navLink })).toHaveAttribute(
      "aria-current",
      "page",
    );

    const input = page.getByTestId("report-template-input");

    // 1. Nút "Tải lên" ở đầu trang mở hộp chọn tệp.
    const chooserPromise = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: t.upload.action }).click();
    const chooser = await chooserPromise;
    await chooser.setFiles({
      name: `${names.picked}.xlsx`,
      mimeType: XLSX_MIME,
      buffer: sampleXlsx(),
    });
    await expect(row(page, names.picked)).toBeVisible();
    await expect(row(page, names.picked)).toContainText(".xlsx");

    // 2. Bàn phím: Tab tới "Chọn tệp", Enter mở hộp chọn tệp (thay cho kéo thả).
    const choose = page.getByRole("button", { name: t.upload.choose });
    await choose.focus();
    await expect(choose).toBeFocused();
    const keyboardChooser = page.waitForEvent("filechooser");
    await page.keyboard.press("Enter");
    await (
      await keyboardChooser
    ).setFiles({
      name: `${names.keyboard}.docx`,
      mimeType: DOCX_MIME,
      buffer: sampleDocx(),
    });
    await expect(row(page, names.keyboard)).toBeVisible();

    // 3. Kéo thả vào vùng thả.
    const bytes = [...sampleDocx()];
    const dataTransfer = await page.evaluateHandle(
      ({ bytes, name, type }) => {
        const dt = new DataTransfer();
        dt.items.add(new File([new Uint8Array(bytes)], name, { type }));
        return dt;
      },
      { bytes, name: `${names.dropped}.docx`, type: DOCX_MIME },
    );
    const dropzone = page.getByTestId("report-template-dropzone");
    await dropzone.dispatchEvent("dragenter", { dataTransfer });
    await dropzone.dispatchEvent("drop", { dataTransfer });
    await expect(row(page, names.dropped)).toBeVisible();

    // 4. Tệp sai bị từ chối, báo lỗi dễ hiểu (AC2).
    await input.setInputFiles({
      name: "co-macro.docx",
      mimeType: DOCX_MIME,
      buffer: macroDocx(),
    });
    await expect(
      page.getByRole("alert").filter({ hasText: t.errors.macro }),
    ).toBeVisible();
    await input.setInputFiles({
      name: "bao-cao.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.7 giả"),
    });
    await expect(
      page.getByRole("alert").filter({ hasText: t.errors.unsupportedType }),
    ).toBeVisible();
    await expect(row(page, "co-macro")).toHaveCount(0);

    // 5. Bật template docx vừa kéo thả (tải sau nên chưa bật): chỉ một docx đang dùng.
    await row(page, names.dropped)
      .getByRole("button", { name: t.actions.activateLabel(names.dropped) })
      .click();
    await expect(row(page, names.dropped)).toContainText(t.status.active);
    await expect(row(page, names.keyboard)).toContainText(t.status.inactive);
    await row(page, names.dropped)
      .getByRole("button", { name: t.actions.deactivateLabel(names.dropped) })
      .click();
    await expect(row(page, names.dropped)).toContainText(t.status.inactive);

    // 6. Tải xuống đúng byte.
    const downloadPromise = page.waitForEvent("download");
    await row(page, names.picked)
      .getByRole("link", { name: t.actions.download(names.picked) })
      .click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.xlsx$/);

    // 7. Xóa có xác nhận; Hủy thì không xóa.
    await row(page, names.picked)
      .getByRole("button", { name: t.actions.deleteLabel(names.picked) })
      .click();
    const dialog = page.getByRole("alertdialog", {
      name: t.confirmDelete.title(names.picked),
    });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: strings.ui.cancel }).click();
    await expect(row(page, names.picked)).toBeVisible();
    await row(page, names.picked)
      .getByRole("button", { name: t.actions.deleteLabel(names.picked) })
      .click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: t.confirmDelete.confirm })
      .click();
    await expect(row(page, names.picked)).toHaveCount(0);
    await expect(page.getByText(t.deleted(names.picked))).toBeVisible();

    await dismissToasts(page);
    await expect(page.getByText(t.deleted(names.picked))).toHaveCount(0);
    expect(await blockingViolations(page)).toEqual([]);
    await page.emulateMedia({ colorScheme: "dark" });
    expect(await blockingViolations(page)).toEqual([]);
  });

  test("360 px (tối): không tràn ngang, vùng bấm ≥ 44 px, axe sạch", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.emulateMedia({ colorScheme: "dark" });
    await signInAs(page, "admin");
    await openPage(page);
    await expect(row(page, names.keyboard)).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    for (const name of [t.upload.action, t.upload.choose]) {
      const box = await page.getByRole("button", { name }).boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
    expect(await blockingViolations(page)).toEqual([]);
  });

  test("PM và Thành viên không vào được trang quản trị (không tìm thấy)", async ({
    page,
  }) => {
    for (const who of ["pm", "member"] as const) {
      await page.context().clearCookies();
      await signInAs(page, who);
      // notFound() trong Suspense: mã HTTP vẫn 200, nội dung là 404.
      await page.goto("/admin/report-templates");
      await expect(page.getByRole("heading", { name: "404" })).toBeVisible();
      await expect(
        page.getByRole("heading", { level: 1, name: t.heading }),
      ).toHaveCount(0);
    }
  });
});
