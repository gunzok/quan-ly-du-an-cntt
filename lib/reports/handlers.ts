import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ApiError } from "@/lib/api/errors";
import {
  limitUser,
  logRateLimitUnavailable,
  rateLimitedResponse,
  type RateLimitOutcome,
} from "@/lib/api/rate-limit";
import { isSameOrigin, isUuid, readJsonBody } from "@/lib/api/request";
import { apiError, errorResponse } from "@/lib/api/respond";
import type { Locale } from "@/lib/i18n/config";
import { getMessages } from "@/lib/i18n/messages";
import { todayIso } from "@/lib/projects/format";
import { requireTemplateReader } from "@/lib/report-templates/handlers";
import { REPORT_TEMPLATE_BUCKET } from "@/lib/report-templates/model";
import { strings } from "@/lib/strings";
import { loadDashboard, loadPeriodTasks, TooManyTasksError } from "./data";
import { TemplateSyntaxError, UnsafeTemplateError } from "./docx-fill";
import {
  REPORT_FORMATS,
  REPORT_MIME,
  REPORT_TIMEOUT_MS,
  reportFileName,
  type ExportReportInput,
  type ReportFormat,
} from "./model";
import type { ReportProject } from "./placeholders";
import { renderDocxReport, renderXlsxReport } from "./render";
import { buildSampleDocxTemplate } from "./sample-docx-template";
import { buildSampleXlsxTemplate } from "./sample-template";
import { EXPORT_REPORT_MAX_BODY_BYTES, validateExportReport } from "./validate";

/**
 * Lõi của POST /api/v1/projects/{id}/reports (Story E5-3 xlsx FR-14, Story E5-4 docx FR-15, S07). Route Handler chỉ tạo client
 * phiên rồi gọi hàm này; test tích hợp gọi thẳng.
 *
 * Client PHIÊN của người gọi (RLS áp dụng), không service_role (riêng bộ đếm giới hạn tần suất dùng
 * khóa service như mọi nơi khác, chỉ đụng bảng đếm). Thứ tự kiểm:
 *   1. Origin trùng ứng dụng: 403 (proxy đã chặn, kiểm lại ở đây).
 *   2. Phiên: 401.
 *   3. Dự án không thấy (người ngoài, bị khóa, id sai): 404 (BR-10).
 *   4. Vai trò: PM của dự án hoặc Admin, đang hoạt động; Thành viên, Người xem: 403.
 *   5. Thân JSON: `format`, `period_start`, `period_end`; sai hoặc trường lạ: 400.
 *   6. Giới hạn tần suất `export` 10 lần / 10 phút / người dùng: 429 (bộ đếm lỗi: cho qua, ghi log).
 *   7. Không có template đang dùng CỦA ĐỊNH DẠNG được chọn: 422 report_template_missing.
 *   8. Xuất (đọc template, số liệu, task trong kỳ, điền, ghi report_exports) trong trần
 *      REPORT_TIMEOUT_MS; quá: 504 report_timeout. Kỳ có quá REPORT_MAX_TASKS task: 422.
 *      Template hỏng/sai quy ước: 422 business_rule_violated. Template docx có lệnh cấm (chạy mã,
 *      chèn ảnh/HTML/liên kết...): 422 business_rule_violated, không chạy gì (docx-fill.ts).
 * Thành công: 200, thân là tệp xlsx/docx, Content-Disposition attachment.
 */
export interface ReportDeps {
  /** Client theo phiên cookie của người gọi (khóa anon, RLS áp dụng). */
  session: SupabaseClient;
  requestId?: string;
  /** Ngôn ngữ chữ trong tệp (ưu tiên, nhóm trạng thái, định dạng ngày khi lẫn chữ). */
  locale?: Locale;
  /** Giờ hiện tại (test cố định). */
  now?: () => Date;
  timeoutMs?: number;
  /** Giới hạn tần suất; test thay để không phụ thuộc bộ đếm dùng chung. */
  rateLimit?: (userId: string) => Promise<RateLimitOutcome>;
}

interface Ctx {
  requestId: string;
}

function fail(error: ApiError, ctx: Ctx) {
  return errorResponse(error, ctx.requestId);
}

/** Log lỗi hệ thống: chỉ mã, thông điệp ngắn, request_id; không ghi dữ liệu dự án. */
function internal(ctx: Ctx, where: string, error: unknown) {
  const e = error as {
    code?: unknown;
    message?: unknown;
    statusCode?: unknown;
  };
  console.error(
    `[api/v1/reports] ${where} request_id=${ctx.requestId} code=${String(e?.code ?? e?.statusCode ?? "")} message=${String(e?.message ?? error).slice(0, 200)}`,
  );
  return fail(apiError("internal_error"), ctx);
}

export function contentDisposition(fileName: string): string {
  const ascii = fileName.replace(/[^A-Za-z0-9._-]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

function fileResponse(
  bytes: Buffer,
  fileName: string,
  format: ReportFormat,
): Response {
  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "content-type": REPORT_MIME[format],
      "content-disposition": contentDisposition(fileName),
      "content-length": String(bytes.length),
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

class ExportTimeoutError extends Error {
  constructor() {
    super("report timeout");
    this.name = "ExportTimeoutError";
  }
}

class TemplateUnreadableError extends Error {
  constructor(readonly cause: unknown) {
    super("template unreadable");
    this.name = "TemplateUnreadableError";
  }
}

/** Chữ lỗi theo định dạng (xlsx giữ nguyên chữ của E5-3). */
function templateMessages(format: ReportFormat) {
  return format === "docx" ? strings.reportsDocx.api : strings.reports.api;
}

/** Chạy `work` trong trần thời gian; quá thì hủy (AbortSignal) và ném ExportTimeoutError. */
async function withTimeout<T>(
  ms: number,
  work: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new ExportTimeoutError());
    }, ms);
  });
  try {
    return await Promise.race([work(controller.signal), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function readProjectAndRole(
  session: SupabaseClient,
  userId: string,
  projectId: string,
) {
  const [project, member, profile] = await Promise.all([
    session
      .from("projects")
      .select("id, name, description, start_date, end_date, status")
      .eq("id", projectId)
      .maybeSingle(),
    session
      .from("project_members")
      .select("role")
      .eq("project_id", projectId)
      .eq("user_id", userId)
      .maybeSingle(),
    session
      .from("profiles")
      .select("full_name, email, is_admin, is_active")
      .eq("id", userId)
      .maybeSingle(),
  ]);
  for (const r of [project, member, profile]) if (r.error) throw r.error;
  const p = profile.data as {
    full_name: string | null;
    email: string | null;
    is_admin: boolean;
    is_active: boolean;
  } | null;
  const active = p?.is_active === true;
  const canExport =
    active && (p?.is_admin === true || member.data?.role === "pm");
  return {
    project: project.data as ReportProject | null,
    canExport,
    displayName: p?.full_name?.trim() || p?.email || "",
  };
}

export async function handleExportReport(
  request: Request,
  rawProjectId: string,
  deps: ReportDeps,
): Promise<Response> {
  const ctx: Ctx = { requestId: deps.requestId ?? randomUUID() };
  if (!isSameOrigin(request)) return fail(apiError("forbidden"), ctx);

  let userId: string;
  let projectId: string;
  let project: ReportProject;
  let displayName: string;
  try {
    const { data: auth, error: authError } = await deps.session.auth.getUser();
    if (authError || !auth.user) return fail(apiError("unauthenticated"), ctx);
    userId = auth.user.id;
    if (!isUuid(rawProjectId)) return fail(apiError("not_found"), ctx);
    projectId = rawProjectId.toLowerCase();
    const found = await readProjectAndRole(deps.session, userId, projectId);
    if (!found.project) return fail(apiError("not_found"), ctx);
    if (!found.canExport) return fail(apiError("forbidden"), ctx);
    project = found.project;
    displayName = found.displayName;
  } catch (error) {
    return internal(ctx, "gate", error);
  }

  const read = await readJsonBody(request, EXPORT_REPORT_MAX_BODY_BYTES);
  if (!read.ok) return fail(read.error, ctx);
  const parsed = validateExportReport(read.body);
  if (!parsed.ok) {
    return fail(apiError("validation_failed", undefined, parsed.details), ctx);
  }
  const input = parsed.data;

  const limit = await (deps.rateLimit ?? ((id) => limitUser(id, "export")))(
    userId,
  );
  if (!limit.ok) {
    if (limit.reason === "limited") {
      return rateLimitedResponse(limit.retryAfterSeconds, ctx.requestId);
    }
    // Fail-open như giới hạn API chung: RLS và kiểm quyền vẫn áp dụng.
    logRateLimitUnavailable("export", limit.detail, ctx.requestId);
  }

  let template: { id: string; storage_path: string } | null;
  try {
    const { data, error } = await deps.session
      .from("report_templates")
      .select("id, storage_path")
      .eq("kind", input.format)
      .eq("is_active", true)
      .maybeSingle();
    if (error) throw error;
    template = data as { id: string; storage_path: string } | null;
  } catch (error) {
    return internal(ctx, "template", error);
  }
  if (!template) {
    return fail(
      apiError(
        "report_template_missing",
        templateMessages(input.format).templateMissing,
      ),
      ctx,
    );
  }
  const activeTemplate = template;

  const now = (deps.now ?? (() => new Date()))();
  const locale = deps.locale ?? "vi";
  try {
    const bytes = await withTimeout(
      deps.timeoutMs ?? REPORT_TIMEOUT_MS,
      async (signal) => {
        const [file, dashboard] = await Promise.all([
          downloadTemplate(deps.session, activeTemplate.storage_path, signal),
          loadDashboard(deps.session, projectId, todayIso(now), signal),
        ]);
        if (!dashboard) throw new Error("dashboard not visible");
        const tasks = await loadPeriodTasks(
          deps.session,
          projectId,
          { start: input.period_start, end: input.period_end },
          dashboard,
          signal,
        );
        signal.throwIfAborted();
        let out: Buffer;
        const render =
          input.format === "docx" ? renderDocxReport : renderXlsxReport;
        try {
          out = await render(
            file,
            {
              project,
              period: { start: input.period_start, end: input.period_end },
              generatedAt: now,
              generatedBy: displayName,
              dashboard,
              tasks,
            },
            locale,
          );
        } catch (error) {
          if (error instanceof UnsafeTemplateError) throw error;
          throw new TemplateUnreadableError(error);
        }
        signal.throwIfAborted();
        await recordExport(deps.session, {
          projectId,
          templateId: activeTemplate.id,
          userId,
          input,
          signal,
        });
        return out;
      },
    );
    return fileResponse(
      bytes,
      reportFileName(project.name, input),
      input.format,
    );
  } catch (error) {
    if (error instanceof ExportTimeoutError) {
      console.error(
        `[api/v1/reports] timeout request_id=${ctx.requestId} project=${projectId}`,
      );
      return fail(apiError("report_timeout", strings.reports.api.timeout), ctx);
    }
    if (error instanceof TooManyTasksError) {
      return fail(
        apiError("business_rule_violated", strings.reports.api.tooManyTasks, [
          { field: "period_end", issue: "invalid_value" },
        ]),
        ctx,
      );
    }
    if (error instanceof UnsafeTemplateError) {
      // Ghi log để Admin/vận hành truy ra template; chỉ tên lệnh, không ghi dữ liệu dự án.
      console.error(
        `[api/v1/reports] unsafe-template request_id=${ctx.requestId} template=${activeTemplate.id} command=${JSON.stringify(error.command.slice(0, 40))}`,
      );
      return fail(
        apiError(
          "business_rule_violated",
          strings.reportsDocx.api.templateUnsafe,
        ),
        ctx,
      );
    }
    if (error instanceof TemplateUnreadableError) {
      if (!(error.cause instanceof TemplateSyntaxError)) {
        internal(ctx, "render", error.cause);
      }
      return fail(
        apiError(
          "business_rule_violated",
          templateMessages(input.format).templateUnreadable,
        ),
        ctx,
      );
    }
    return internal(ctx, "export", error);
  }
}

async function downloadTemplate(
  session: SupabaseClient,
  path: string,
  signal: AbortSignal,
): Promise<Uint8Array> {
  const { data, error } = await session.storage
    .from(REPORT_TEMPLATE_BUCKET)
    .download(path, undefined, { signal });
  if (error || !data) throw error ?? new Error("template download failed");
  return new Uint8Array(await data.arrayBuffer());
}

async function recordExport(
  session: SupabaseClient,
  args: {
    projectId: string;
    templateId: string;
    userId: string;
    input: ExportReportInput;
    signal: AbortSignal;
  },
) {
  // Không dùng RETURNING: chính sách SELECT không cần chạy khi thêm.
  const { error } = await session
    .from("report_exports")
    .insert({
      id: randomUUID(),
      project_id: args.projectId,
      template_id: args.templateId,
      format: args.input.format,
      period_start: args.input.period_start,
      period_end: args.input.period_end,
      requested_by: args.userId,
    })
    .abortSignal(args.signal);
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// GET /api/v1/report-templates/sample?format=xlsx|docx — template mẫu (Admin, PM)
// ---------------------------------------------------------------------------
export async function handleSampleTemplate(
  request: Request,
  deps: { session: SupabaseClient; requestId?: string; locale?: Locale },
): Promise<Response> {
  const ctx: Ctx = { requestId: deps.requestId ?? randomUUID() };
  try {
    const gate = await requireTemplateReader(deps.session);
    if (!gate.ok) return fail(gate.error, ctx);
  } catch (error) {
    return internal(ctx, "sample-gate", error);
  }
  const params = new URL(request.url).searchParams;
  const keys = [...params.keys()];
  const format = params.get("format");
  if (keys.some((k) => k !== "format") || params.getAll("format").length > 1) {
    return fail(
      apiError(
        "validation_failed",
        undefined,
        keys
          .filter((k) => k !== "format")
          .map((k) => ({ field: k.slice(0, 64), issue: "unknown_field" })),
      ),
      ctx,
    );
  }
  if (!REPORT_FORMATS.includes(format as ReportFormat)) {
    return fail(
      apiError("validation_failed", undefined, [
        { field: "format", issue: format ? "invalid_value" : "required" },
      ]),
      ctx,
    );
  }
  try {
    const locale = deps.locale ?? "vi";
    const kind = format as ReportFormat;
    const t = getMessages(locale);
    const bytes =
      kind === "docx"
        ? buildSampleDocxTemplate(t)
        : await buildSampleXlsxTemplate(t);
    return fileResponse(
      bytes,
      locale === "vi"
        ? `template-bao-cao-mau.${kind}`
        : `sample-report-template.${kind}`,
      kind,
    );
  } catch (error) {
    return internal(ctx, "sample", error);
  }
}
