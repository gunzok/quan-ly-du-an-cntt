/**
 * Đo xuất báo cáo xlsx VÀ docx trên dự án perf 2.000 task (Story E5-3, E5-4, E5-5; NFR-03: dưới
 * 30 giây mỗi lần xuất). In thời gian (P50, max), bộ nhớ (RSS cao nhất, heap tăng) và số dòng.
 *
 *   make perf-seed && make perf-report
 *
 * Chỉ chạy khi PERF_REPORT=1 (target `perf-report` đặt sẵn); `make test-integration` bỏ qua.
 * Không cần SEED_PASSWORD: tạo một PM TẠM cho dự án perf (khóa service của stack CỤC BỘ), đăng nhập
 * bằng phiên cookie, gọi lõi Route Handler như các test tích hợp khác (getUser, RLS, Storage, hàm
 * dashboard, đọc task theo trang, exceljs, ghi report_exports). Không tính chi phí HTTP của Next.js
 * (vài ms, nhỏ so với phần đo).
 *
 * Template: với từng định dạng, nếu chưa có template đang dùng thì tạm tải template MẪU lên và bật,
 * xong thì xóa. Đã có (của phiên khác trên CSDL dùng chung) thì dùng luôn và in cảnh báo (không
 * kiểm số dòng vì không biết bố cục template đó).
 *
 * PERF_REPORT_FORMATS: định dạng cần đo, mặc định "xlsx,docx".
 *
 * PERF_REPORT_ITERATIONS (mặc định 5, tối đa 10 vì giới hạn export 10 lần/10 phút; test bỏ qua bộ
 * đếm). Kỳ: 2026-05-01..2027-04-30, phủ cả 2.000 task của bộ dữ liệu perf mặc định.
 */
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import ExcelJS from "exceljs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signInWithPassword } from "@/lib/auth/sign-in";
import { getMessages } from "@/lib/i18n/messages";
import {
  REPORT_TEMPLATE_BUCKET,
  storagePathFor,
} from "@/lib/report-templates/model";
import { handleExportReport } from "@/lib/reports/handlers";
import { REPORT_MIME, type ReportFormat } from "@/lib/reports/model";
import { buildSampleDocxTemplate } from "@/lib/reports/sample-docx-template";
import { buildSampleXlsxTemplate } from "@/lib/reports/sample-template";
import { dumpDocx } from "@/tests/fixtures/reports/docx";
import { missingIntegrationEnv } from "./env";
import {
  APP_ORIGIN,
  CookieJar,
  SERVICE_ROLE_KEY,
  SUPABASE_URL,
  assertLocalSupabase,
  serverClient as sessionClient,
} from "./helpers";

const enabled =
  process.env.PERF_REPORT === "1" && missingIntegrationEnv().length === 0;

/** Dự án perf mặc định (scripts/perf/dataset.ts: projectId(0)). */
const PERF_PROJECT_ID = "9e7f0000-0000-4000-8000-000000000000";
const NFR03_MS = 30_000;
const PERIOD = { period_start: "2026-05-01", period_end: "2027-04-30" };

function formats(): ReportFormat[] {
  const list = (process.env.PERF_REPORT_FORMATS ?? "xlsx,docx")
    .split(",")
    .map((f) => f.trim());
  if (list.some((f) => f !== "xlsx" && f !== "docx")) {
    throw new Error('PERF_REPORT_FORMATS chỉ gồm "xlsx", "docx".');
  }
  return list as ReportFormat[];
}

async function sampleTemplate(format: ReportFormat): Promise<Uint8Array> {
  const t = getMessages("vi");
  return format === "docx"
    ? buildSampleDocxTemplate(t)
    : await buildSampleXlsxTemplate(t);
}

/** Số dòng dữ liệu của tệp xuất từ template MẪU (xlsx: số dòng trang tính; docx: dòng bảng task). */
async function countRows(format: ReportFormat, body: ArrayBuffer) {
  if (format === "xlsx") {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(body);
    return wb.worksheets[0].rowCount;
  }
  const lines = dumpDocx(new Uint8Array(body))["word/document.xml"] ?? [];
  const start = lines.indexOf("¶ 4. DANH SÁCH TASK TRONG KỲ");
  const end = lines.findIndex((l, i) => i > start && l.startsWith("¶"));
  return lines.slice(start + 3, end).length;
}

const mb = (bytes: number) => Math.round(bytes / 1024 / 1024);

function iterations(): number {
  const n = Number(process.env.PERF_REPORT_ITERATIONS ?? 5);
  if (!Number.isInteger(n) || n < 1 || n > 10) {
    throw new Error("PERF_REPORT_ITERATIONS phải là số nguyên 1..10.");
  }
  return n;
}

describe.skipIf(!enabled)("Đo xuất báo cáo 2.000 task (NFR-03)", () => {
  let service: SupabaseClient;
  const jar = new CookieJar();
  let userId = "";
  const tempTemplates: { id: string; path: string }[] = [];
  /** Định dạng đang dùng template MẪU (kiểm được số dòng). */
  const usingSample = new Set<ReportFormat>();
  let taskCount = 0;

  beforeAll(async () => {
    assertLocalSupabase();
    service = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { count, error: countError } = await service
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .eq("project_id", PERF_PROJECT_ID);
    if (countError) throw countError;
    if (!count) throw new Error("Chưa có dự án perf. Chạy make perf-seed.");
    taskCount = count;

    const email = `it-e5-3-perf-${randomUUID().slice(0, 8)}@example.com`;
    const password = `Perf-${randomUUID()}`;
    const created = await service.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: "IT E5-3 perf PM" },
    });
    if (created.error) throw created.error;
    userId = created.data.user.id;
    const member = await service.from("project_members").insert({
      project_id: PERF_PROJECT_ID,
      user_id: userId,
      role: "pm",
    });
    if (member.error) throw member.error;
    const signed = await signInWithPassword(sessionClient(jar), {
      email,
      password,
    });
    expect(signed.ok).toBe(true);

    for (const format of formats()) {
      const active = await service
        .from("report_templates")
        .select("id, name")
        .eq("kind", format)
        .eq("is_active", true)
        .maybeSingle();
      if (active.error) throw active.error;
      if (active.data) {
        console.warn(
          `[perf-report] ${format}: dùng template đang dùng có sẵn "${active.data.name}" (không phải template mẫu).`,
        );
        continue;
      }
      const id = randomUUID();
      const path = storagePathFor(id, format);
      const bytes = await sampleTemplate(format);
      const up = await service.storage
        .from(REPORT_TEMPLATE_BUCKET)
        .upload(path, bytes, { contentType: REPORT_MIME[format] });
      if (up.error) throw up.error;
      tempTemplates.push({ id, path });
      const row = await service.from("report_templates").insert({
        id,
        kind: format,
        name: `[PERF] Template mẫu ${format}`,
        storage_path: path,
        size_bytes: bytes.length,
        uploaded_by: null,
        is_active: true,
      });
      if (row.error) throw row.error;
      usingSample.add(format);
    }
  });

  afterAll(async () => {
    if (!service) return;
    for (const tpl of tempTemplates) {
      await service.from("report_templates").delete().eq("id", tpl.id);
      await service.storage.from(REPORT_TEMPLATE_BUCKET).remove([tpl.path]);
    }
    if (userId) {
      // report_exports của PM tạm xóa theo dự án perf ở perf-clean; requested_by thành null.
      await service
        .from("project_members")
        .delete()
        .eq("project_id", PERF_PROJECT_ID)
        .eq("user_id", userId);
      await service.auth.admin.deleteUser(userId);
    }
  });

  it.each(formats())(
    "%s, 2.000 task: mỗi lần xuất dưới 30 giây",
    async (format) => {
      const samples: number[] = [];
      let rows = 0;
      let bytes = 0;
      const rssBefore = process.resourceUsage().maxRSS * 1024;
      const heapBefore = process.memoryUsage().heapUsed;
      let heapPeak = heapBefore;
      for (let i = 0; i < iterations(); i++) {
        const started = performance.now();
        const res = await handleExportReport(
          new Request(
            new URL(`/api/v1/projects/${PERF_PROJECT_ID}/reports`, APP_ORIGIN),
            {
              method: "POST",
              headers: {
                origin: APP_ORIGIN,
                "content-type": "application/json",
              },
              body: JSON.stringify({ format, ...PERIOD }),
            },
          ),
          PERF_PROJECT_ID,
          {
            session: sessionClient(jar),
            rateLimit: async () => ({ ok: true }),
            timeoutMs: NFR03_MS,
          },
        );
        const body = await res.arrayBuffer();
        samples.push(performance.now() - started);
        const mem = process.memoryUsage();
        heapPeak = Math.max(heapPeak, mem.heapUsed);
        expect(res.status).toBe(200);
        expect(res.headers.get("content-type")).toBe(REPORT_MIME[format]);
        bytes = body.byteLength;
        if (i === 0) rows = await countRows(format, body);
      }
      const sorted = [...samples].sort((a, b) => a - b);
      const p50 = sorted[Math.floor((sorted.length - 1) / 2)];
      const max = sorted[sorted.length - 1];
      console.log(
        `[perf-report] ${format} · ${taskCount} task · ${samples.length} lần · P50 ${Math.round(p50)} ms · max ${Math.round(max)} ms · ${rows} dòng · ${Math.round(bytes / 1024)} KB · RSS đỉnh của tiến trình ${mb(process.resourceUsage().maxRSS * 1024)} MB (trước khi đo ${mb(rssBefore)} MB) · heap tăng tối đa ${mb(heapPeak - heapBefore)} MB · ngưỡng NFR-03 ${NFR03_MS} ms`,
      );
      expect(max).toBeLessThan(NFR03_MS);
      if (usingSample.has(format)) {
        // Template mẫu, kỳ phủ mọi task: xlsx thêm dòng bố cục quanh bảng; docx đúng một dòng bảng mỗi task.
        expect(rows).toBeGreaterThanOrEqual(taskCount);
      }
    },
    400_000,
  );
});
