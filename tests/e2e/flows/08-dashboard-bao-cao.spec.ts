import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { SupabaseClient } from "@supabase/supabase-js";
import ExcelJS from "exceljs";
import { expect, test, type Page } from "@playwright/test";
import { vi as strings } from "@/lib/i18n/messages/vi";
import {
  REPORT_TEMPLATE_BUCKET,
  storagePathFor,
} from "@/lib/report-templates/model";
import { REPORT_MIME, type ReportFormat } from "@/lib/reports/model";
import { buildSampleDocxTemplate } from "@/lib/reports/sample-docx-template";
import { buildSampleXlsxTemplate } from "@/lib/reports/sample-template";
import { dumpDocx } from "@/tests/fixtures/reports/docx";
import { acquireSharedLock } from "@/tests/support/shared-lock";
import { waitForHydration } from "../hydration";
import { cleanupTempData, serviceClient } from "../temp-data";
import {
  createFlowUsers,
  createProject,
  expectNoA11yViolations,
  loginState,
  newTag,
  OPEN_DIALOG,
  openAs,
  projectStatuses,
  type FlowUser,
} from "./support";

/**
 * Luồng 8 (test-strategy.md mục 4): PM xem dashboard (số liệu khớp task), xuất báo cáo xlsx và docx
 * THẬT theo template mẫu (tải tệp về, mở tệp kiểm nội dung chính), thiếu template thì hộp thoại báo
 * lỗi và khóa nút tạo.
 *
 * Template "đang dùng" là trạng thái TOÀN HỆ THỐNG (một template mỗi định dạng). Luồng giữ khóa
 * "report-templates" (tests/support/shared-lock.ts, dùng chung với report-templates.spec.ts và test
 * tích hợp báo cáo) từ lúc đổi template tới lúc trả lại như cũ: tải template mẫu (lib/reports/sample-*)
 * bằng khóa service, tạm tắt template docx đang dùng (nếu có) để kiểm ca thiếu, bật template mẫu,
 * xuất, rồi bật lại template cũ và xóa template mẫu. Template thật của công ty chưa có (R-005).
 * Chi tiết: reports.spec.ts (định dạng, kỳ, 504), dashboard.spec.ts (vai trò, 404),
 * tests/integration/reports.test.ts (số liệu ô theo template).
 */
const tag = newTag();
const createdUsers: string[] = [];
const projectIds: string[] = [];
let service: SupabaseClient | null = null;
let pm: FlowUser;
let projectId = "";
const projectName = `E2E ${tag} Luồng 8`;
const titles = {
  done: `Lắp đặt tủ mạng ${tag}`,
  doing: `Cấu hình tường lửa ${tag}`,
  late: `Đi dây tầng 3 ${tag}`,
};

test.beforeAll(async () => {
  service = serviceClient();
  ({ pm } = await createFlowUsers(
    service,
    8,
    tag,
    { pm: `E2E PM ${tag}` },
    createdUsers,
  ));
  projectId = await createProject(service, projectName, pm.id);
  projectIds.push(projectId);
  const statuses = await projectStatuses(service, projectId);
  const status = (category: string) =>
    statuses.find((s) => s.category === category)!.id;
  const base = { project_id: projectId, created_by: pm.id };
  const { error } = await service.from("tasks").insert([
    { ...base, title: titles.done, status_id: status("done") },
    { ...base, title: titles.doing, status_id: status("in_progress") },
    {
      ...base,
      title: titles.late,
      status_id: status("todo"),
      due_date: "2020-01-01",
    },
  ]);
  if (error) throw error;
});

test.afterAll(async () => {
  await cleanupTempData(service, { projectIds, userIds: createdUsers });
});

const kpi = (page: Page, label: string) =>
  page
    .getByRole("region", { name: strings.dashboard.kpisLabel })
    .getByRole("listitem")
    .filter({ hasText: label });

/** Tải template mẫu lên Storage và ghi dòng report_templates (chưa bật). */
async function uploadSample(format: ReportFormat): Promise<string> {
  const id = randomUUID();
  const path = storagePathFor(id, format);
  const bytes =
    format === "xlsx"
      ? await buildSampleXlsxTemplate(strings)
      : buildSampleDocxTemplate(strings);
  const up = await service!.storage
    .from(REPORT_TEMPLATE_BUCKET)
    .upload(path, bytes, { contentType: REPORT_MIME[format] });
  if (up.error) throw up.error;
  const row = await service!.from("report_templates").insert({
    id,
    kind: format,
    name: `E2E ${tag} Template mẫu ${format}`,
    storage_path: path,
    size_bytes: bytes.length,
    uploaded_by: null,
  });
  if (row.error) throw row.error;
  return id;
}

async function setActive(id: string, active: boolean) {
  const { error } = await service!.rpc("set_report_template_active", {
    p_id: id,
    p_active: active,
  });
  if (error) throw error;
}

async function activeTemplate(format: ReportFormat) {
  const { data, error } = await service!
    .from("report_templates")
    .select("id")
    .eq("kind", format)
    .eq("is_active", true)
    .maybeSingle();
  if (error) throw error;
  return (data?.id as string | undefined) ?? null;
}

test("Luồng 8: dashboard khớp số liệu → thiếu template báo lỗi → xuất xlsx và docx theo template mẫu, kiểm nội dung tệp", async ({
  browser,
  baseURL,
}) => {
  const d = strings.dashboard;
  const t = strings.reports.dialog;
  const state = await loginState(browser, baseURL!, pm);
  const { page, close } = await openAs(browser, baseURL!, state, {
    acceptDownloads: true,
  });

  await test.step("PM vào dashboard từ thẻ dự án, số liệu khớp 3 task", async () => {
    await page.goto("/");
    await page
      .getByRole("link", { name: `${d.open} ${projectName}`, exact: true })
      .click();
    await expect(page).toHaveURL(`/projects/${projectId}/dashboard`);
    await expect(
      page.getByRole("heading", { level: 1, name: d.heading }),
    ).toBeVisible();
    await expect(
      page.getByRole("progressbar", { name: d.kpi.completionAria(33) }),
    ).toBeVisible();
    await expect(kpi(page, d.kpi.completion)).toContainText(
      d.kpi.completionNote("1", "3"),
    );
    await expect(kpi(page, d.kpi.inProgress)).toContainText("1");
    await expect(kpi(page, d.kpi.overdue)).toContainText("1");
    const overdue = page.getByRole("region", { name: d.overdueList.title });
    await expect(overdue).toContainText(titles.late);
    await expectNoA11yViolations(page, "dashboard");
  });

  const release = await acquireSharedLock("report-templates");
  const previous: Record<ReportFormat, string | null> = {
    xlsx: null,
    docx: null,
  };
  const mine: { id: string; format: ReportFormat }[] = [];
  try {
    previous.xlsx = await activeTemplate("xlsx");
    previous.docx = await activeTemplate("docx");
    const xlsxId = await uploadSample("xlsx");
    mine.push({ id: xlsxId, format: "xlsx" });
    const docxId = await uploadSample("docx");
    mine.push({ id: docxId, format: "docx" });
    await setActive(xlsxId, true);
    if (previous.docx) await setActive(previous.docx, false);

    const openDialog = async () => {
      await waitForHydration(page, "main button[aria-haspopup=dialog]");
      await page
        .getByRole("button", {
          name: strings.reports.exportButton,
          exact: true,
        })
        .click();
      const dialog = page.getByRole("dialog", { name: t.title });
      await expect(dialog).toBeVisible();
      return dialog;
    };

    await test.step("Chưa có template Word đang dùng: chọn Word thì báo thiếu, khóa nút tạo", async () => {
      await page.reload();
      const dialog = await openDialog();
      await dialog.getByRole("radio", { name: /^Word/ }).check();
      const alert = dialog.getByRole("alert");
      await expect(alert).toContainText(
        strings.reportsDocx.dialog.templateMissing,
      );
      await expect(
        dialog.getByRole("button", { name: t.submit }),
      ).toBeDisabled();
      await expectNoA11yViolations(
        page,
        "hộp thoại thiếu template",
        OPEN_DIALOG,
      );
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
    });

    await test.step("Xuất Excel theo template mẫu, mở tệp kiểm nội dung", async () => {
      const dialog = await openDialog();
      await expect(dialog.getByRole("radio", { name: /^Excel/ })).toBeChecked();
      const download = page.waitForEvent("download");
      await dialog.getByRole("button", { name: t.submit }).click();
      const file = await download;
      expect(file.suggestedFilename()).toMatch(/\.xlsx$/);
      await expect(dialog.getByRole("status")).toHaveText(
        t.downloaded(file.suggestedFilename()),
      );
      const wb = new ExcelJS.Workbook();
      const bytes = new Uint8Array(await readFile((await file.path())!));
      await wb.xlsx.load(bytes.buffer);
      const ws = wb.worksheets[0];
      expect(ws.getCell("A2").value).toBe(`Dự án: ${projectName}`);
      const cells = [...Array(ws.rowCount).keys()].flatMap(
        (i) => ws.getRow(i + 1).values as unknown[],
      );
      for (const title of Object.values(titles)) expect(cells).toContain(title);
      await page.keyboard.press("Escape");
    });

    await test.step("Bật template Word mẫu, xuất Word, mở tệp kiểm nội dung", async () => {
      await setActive(docxId, true);
      await page.reload();
      const dialog = await openDialog();
      await dialog.getByRole("radio", { name: /^Word/ }).check();
      await expect(dialog.getByRole("alert")).toHaveCount(0);
      const download = page.waitForEvent("download");
      await dialog.getByRole("button", { name: t.submit }).click();
      const file = await download;
      expect(file.suggestedFilename()).toMatch(/\.docx$/);
      const text = Object.values(
        dumpDocx(new Uint8Array(await readFile((await file.path())!))),
      )
        .flat()
        .join("\n");
      expect(text).toContain(projectName);
      for (const title of Object.values(titles)) expect(text).toContain(title);
      await page.keyboard.press("Escape");
    });

    // Nhật ký xuất ghi đúng hai lần, đúng template.
    const log = await service!
      .from("report_exports")
      .select("format, template_id")
      .eq("project_id", projectId)
      .order("created_at");
    expect(log.data).toEqual([
      { format: "xlsx", template_id: xlsxId },
      { format: "docx", template_id: docxId },
    ]);
  } finally {
    // Trả hệ thống về như cũ rồi mới nhả khóa.
    for (const format of ["xlsx", "docx"] as const) {
      const prev = previous[format];
      if (prev) await setActive(prev, true).catch(() => undefined);
    }
    for (const { id, format } of mine) {
      await service!.from("report_templates").delete().eq("id", id);
      await service!.storage
        .from(REPORT_TEMPLATE_BUCKET)
        .remove([storagePathFor(id, format)]);
    }
    await release();
    await close();
  }
});
