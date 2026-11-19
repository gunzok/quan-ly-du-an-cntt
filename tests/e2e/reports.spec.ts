import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { type SupabaseClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";
import { vi as strings } from "@/lib/i18n/messages/vi";
import { XLSX_MIME } from "@/lib/reports/model";
import { currentMonthPeriod } from "@/lib/reports/period";
import { buildSampleXlsxTemplate } from "@/lib/reports/sample-template";
import { waitForHydration } from "./hydration";
import { signInWithPassword } from "./login";
import { cleanupTempData, createTempUsers, serviceClient } from "./temp-data";

/**
 * Story E5-3 (QLDA-67): hộp thoại Xuất báo cáo S07 trên dashboard dự án.
 *
 * Template "đang dùng" là trạng thái TOÀN HỆ THỐNG và CSDL cục bộ dùng chung, spec E5-2 bật/tắt
 * template song song: để không làm hỏng nhau, test chặn GET /api/v1/report-templates để cố định
 * trạng thái template, và chặn POST /reports ở các ca lỗi (504). Đường xuất thật (Storage, CSDL,
 * exceljs, report_exports) được test tích hợp tests/integration/reports.test.ts phủ. Tải template
 * mẫu và chặn quyền gọi API thật.
 */
const t = strings.reports.dialog;
const BLOCKING_IMPACTS = new Set(["critical", "serious"]);
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const tag = randomUUID().slice(0, 8);
const password = `E2e-${randomUUID()}`;
const emails = {
  pm: `e2e-e5-3-pm-${tag}@example.com`,
  member: `e2e-e5-3-member-${tag}@example.com`,
};
const users: Record<string, string> = {};
const projectId = randomUUID();
const projectName = `E2E ${tag} E5-3`;

let service: SupabaseClient | null = null;

test.beforeAll(async () => {
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
  const project = await service
    .from("projects")
    .insert({ id: projectId, name: projectName, created_by: users.pm });
  if (project.error) throw project.error;
  const member = await service
    .from("project_members")
    .insert({ project_id: projectId, user_id: users.member, role: "member" });
  if (member.error) throw member.error;
});

test.afterAll(async () => {
  if (!service) return;
  await cleanupTempData(service, {
    projectIds: [projectId],
    userIds: Object.values(users),
  });
});

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

/** Cố định danh sách template mà hộp thoại thấy. */
async function stubTemplates(page: Page, active: boolean) {
  await page.route("**/api/v1/report-templates", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: active
          ? [
              {
                id: randomUUID(),
                kind: "xlsx",
                name: `Mẫu công ty ${tag}`,
                size_bytes: 9000,
                is_active: true,
                uploaded_by: null,
                created_at: "2026-11-01T00:00:00Z",
                updated_at: "2026-11-01T00:00:00Z",
              },
            ]
          : [],
      }),
    }),
  );
}

async function openDashboard(page: Page) {
  await page.goto(`/projects/${projectId}/dashboard`);
  await expect(
    page.getByRole("heading", { level: 1, name: strings.dashboard.heading }),
  ).toBeVisible();
}

async function openDialog(page: Page) {
  const button = page.getByRole("button", {
    name: strings.reports.exportButton,
    exact: true,
  });
  await waitForHydration(page, "main button[aria-haspopup=dialog]");
  // Bàn phím: Tab tới nút rồi Enter.
  await button.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: t.title });
  await expect(dialog).toBeVisible();
  return dialog;
}

test.describe("Xuất báo cáo S07", () => {
  test("Thành viên không thấy nút, API 403; PM tải được template mẫu", async ({
    page,
  }) => {
    await signInWithPassword(page, emails.member, password);
    await openDashboard(page);
    await expect(
      page.getByRole("button", { name: strings.reports.exportButton }),
    ).toHaveCount(0);
    const baseURL = test.info().project.use.baseURL!;
    const denied = await page.request.post(
      `/api/v1/projects/${projectId}/reports`,
      {
        headers: { origin: new URL(baseURL).origin },
        data: {
          format: "xlsx",
          period_start: "2026-11-01",
          period_end: "2026-11-30",
        },
      },
    );
    expect(denied.status()).toBe(403);
    expect(
      (
        await page.request.get("/api/v1/report-templates/sample?format=xlsx")
      ).status(),
    ).toBe(403);

    await page.context().clearCookies();
    await signInWithPassword(page, emails.pm, password);
    const sample = await page.request.get(
      "/api/v1/report-templates/sample?format=xlsx",
    );
    expect(sample.status()).toBe(200);
    expect(sample.headers()["content-type"]).toBe(XLSX_MIME);
  });

  test("PM: mặc định tháng này, Word sắp có, tải tệp về (sáng)", async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await signInWithPassword(page, emails.pm, password);
    await stubTemplates(page, true);
    const file = await buildSampleXlsxTemplate(strings);
    await page.route(`**/api/v1/projects/${projectId}/reports`, (route) =>
      route.fulfill({
        status: 200,
        headers: {
          "content-type": XLSX_MIME,
          "content-disposition": `attachment; filename="bao-cao.xlsx"; filename*=UTF-8''b%C3%A1o-c%C3%A1o.xlsx`,
        },
        body: file,
      }),
    );
    await openDashboard(page);
    const dialog = await openDialog(page);

    const month = currentMonthPeriod();
    await expect(dialog.getByLabel(t.periodStart)).toHaveValue(month.start);
    await expect(dialog.getByLabel(t.periodEnd)).toHaveValue(month.end);
    await expect(dialog.getByRole("radio", { name: /^Excel/ })).toBeChecked();
    await expect(dialog.getByRole("radio", { name: /^Word/ })).toBeDisabled();
    await expect(dialog.getByText(`Mẫu công ty ${tag}`)).toBeVisible();
    expect(await blockingViolations(page)).toEqual([]);

    const requestPromise = page.waitForRequest(
      (r) => r.method() === "POST" && r.url().endsWith("/reports"),
    );
    const download = page.waitForEvent("download");
    await dialog.getByRole("button", { name: t.submit }).click();
    expect((await requestPromise).postDataJSON()).toEqual({
      format: "xlsx",
      period_start: month.start,
      period_end: month.end,
    });
    expect((await download).suggestedFilename()).toBe("báo-cáo.xlsx");
    await expect(dialog.getByRole("status")).toHaveText(
      t.downloaded("báo-cáo.xlsx"),
    );

    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
  });

  test("Thiếu template: báo rõ, khóa nút tạo, có lối tải template mẫu (tối)", async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await signInWithPassword(page, emails.pm, password);
    await stubTemplates(page, false);
    await openDashboard(page);
    const dialog = await openDialog(page);
    const alert = dialog.getByRole("alert");
    await expect(alert).toContainText(t.templateMissing);
    await expect(alert).toContainText(t.templateMissingPm);
    await expect(
      alert.getByRole("link", { name: t.sampleLink }),
    ).toHaveAttribute("href", "/api/v1/report-templates/sample?format=xlsx");
    // PM không có lối vào trang quản trị.
    await expect(
      alert.getByRole("link", { name: t.templatePageLink }),
    ).toHaveCount(0);
    await expect(dialog.getByRole("button", { name: t.submit })).toBeDisabled();
    expect(await blockingViolations(page)).toEqual([]);
  });

  test("Kỳ sai báo lỗi tại chỗ; quá thời gian báo 504 dễ hiểu", async ({
    page,
  }) => {
    await signInWithPassword(page, emails.pm, password);
    await stubTemplates(page, true);
    let posts = 0;
    await page.route(`**/api/v1/projects/${projectId}/reports`, (route) => {
      posts++;
      return route.fulfill({
        status: 504,
        contentType: "application/json",
        body: JSON.stringify({
          error: { code: "report_timeout", message: "timeout" },
        }),
      });
    });
    await openDashboard(page);
    const dialog = await openDialog(page);

    await dialog.getByLabel(t.periodStart).fill("2026-11-20");
    await dialog.getByLabel(t.periodEnd).fill("2026-11-10");
    await dialog.getByRole("button", { name: t.submit }).click();
    await expect(dialog.getByText(t.errors.periodOrder)).toBeVisible();
    expect(posts).toBe(0);

    await dialog.getByRole("button", { name: t.thisMonth }).click();
    await dialog.getByRole("button", { name: t.submit }).click();
    await expect(dialog.getByRole("alert")).toHaveText(t.errors.timeout);
    expect(posts).toBe(1);
  });

  test("360 px (tối): hộp thoại không tràn ngang", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.setViewportSize({ width: 360, height: 780 });
    await signInWithPassword(page, emails.pm, password);
    await stubTemplates(page, true);
    await openDashboard(page);
    await openDialog(page);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow, "Tràn ngang ở 360 px").toBeLessThanOrEqual(0);
    expect(await blockingViolations(page)).toEqual([]);
  });
});
