import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ApiError } from "@/lib/api/errors";
import { requireAdmin } from "@/lib/admin/users/handlers";
import { isSameOrigin, isUuid, readJsonBody } from "@/lib/api/request";
import { apiError, errorResponse, jsonResponse } from "@/lib/api/respond";
import { strings } from "@/lib/strings";
import {
  REPORT_TEMPLATE_BUCKET,
  REPORT_TEMPLATE_COLUMNS,
  REPORT_TEMPLATE_MAX_BYTES,
  REPORT_TEMPLATE_MAX_REQUEST_BYTES,
  REPORT_TEMPLATE_MIME,
  storagePathFor,
  toReportTemplate,
  type ReportTemplateRow,
} from "./model";
import { inspectOoxml } from "./ooxml";
import {
  decideReaderGate,
  mapWriteError,
  rejectionError,
  type ReaderGate,
} from "./policy";
import {
  checkFileName,
  mimeMatches,
  REPORT_TEMPLATE_PATCH_MAX_BYTES,
  validatePatch,
  validateUploadForm,
} from "./validate";

/**
 * Lõi của /api/v1/report-templates (Story E5-2, BR-08). Route Handler chỉ tạo client phiên rồi gọi
 * các hàm này; test tích hợp gọi thẳng với client tự tạo.
 *
 * Thứ tự kiểm (api-contract.md mục 2, giống /api/v1/departments vì đây là tài nguyên toàn hệ thống):
 *   1. (ghi) Origin trùng ứng dụng: 403.
 *   2. Phiên: getUser() 401; đọc hồ sơ/vai trò của chính mình qua RLS. Đọc: Admin hoặc PM (ở ít
 *      nhất một dự án) đang hoạt động; ghi: Admin đang hoạt động. Không đủ: 403.
 *   3. id không phải uuid hoặc không thấy: 404.
 *   4. Schema 400 (từ chối trường lạ), kích thước 413, nội dung tệp 422.
 *   5. Đọc/ghi bằng CHÍNH client phiên: RLS report_templates và storage.objects là lớp chặn thứ
 *      hai. Không dùng service_role.
 */
export interface ReportTemplateDeps {
  /** Client theo phiên cookie của người gọi (khóa anon, RLS áp dụng). */
  session: SupabaseClient;
  requestId?: string;
}

interface Ctx {
  requestId: string;
}

function fail(error: ApiError, ctx: Ctx) {
  return errorResponse(error, ctx.requestId);
}

/** Log lỗi hệ thống: chỉ mã, thông điệp ngắn, request_id; không ghi nội dung tệp hay dữ liệu cá nhân. */
function internal(ctx: Ctx, where: string, error: unknown) {
  const e = error as {
    code?: unknown;
    message?: unknown;
    statusCode?: unknown;
  };
  console.error(
    `[api/v1/report-templates] ${where} request_id=${ctx.requestId} code=${String(e?.code ?? e?.statusCode ?? "")} message=${String(e?.message ?? error).slice(0, 200)}`,
  );
  return fail(apiError("internal_error"), ctx);
}

/** Người gọi đọc được template: Admin hoặc PM đang hoạt động. */
export async function requireTemplateReader(
  session: SupabaseClient,
): Promise<ReaderGate> {
  const { data: userData, error: userError } = await session.auth.getUser();
  const user = userError ? null : userData.user;
  if (!user) return decideReaderGate(null, null, false);
  const [{ data: profile, error }, { data: pm, error: pmError }] =
    await Promise.all([
      session
        .from("profiles")
        .select("is_admin, is_active")
        .eq("id", user.id)
        .maybeSingle(),
      session
        .from("project_members")
        .select("project_id")
        .eq("user_id", user.id)
        .eq("role", "pm")
        .limit(1),
    ]);
  if (error) throw error;
  if (pmError) throw pmError;
  return decideReaderGate(user, profile, (pm ?? []).length > 0);
}

async function gate(
  check: () => Promise<
    { ok: true; userId: string } | { ok: false; error: ApiError }
  >,
  ctx: Ctx,
): Promise<{ ok: true; userId: string } | { ok: false; response: Response }> {
  try {
    const result = await check();
    return result.ok
      ? { ok: true, userId: result.userId }
      : { ok: false, response: fail(result.error, ctx) };
  } catch (error) {
    return { ok: false, response: internal(ctx, "gate", error) };
  }
}

function writeFailure(ctx: Ctx, where: string, error: { code?: string }) {
  const mapped = mapWriteError(error);
  return mapped ? fail(mapped, ctx) : internal(ctx, where, error);
}

async function readRow(session: SupabaseClient, id: string) {
  const { data, error } = await session
    .from("report_templates")
    .select(REPORT_TEMPLATE_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data as ReportTemplateRow | null;
}

/**
 * Đọc thân request có trần kích thước (không tin Content-Length): vượt trần thì dừng đọc ngay.
 */
async function readCappedBody(
  request: Request,
  maxBytes: number,
): Promise<{ ok: true; body: Uint8Array } | { ok: false; tooLarge: true }> {
  const declared = Number(request.headers.get("content-length") ?? "NaN");
  if (Number.isFinite(declared) && declared > maxBytes) {
    return { ok: false, tooLarge: true };
  }
  if (!request.body) return { ok: true, body: new Uint8Array() };
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return { ok: false, tooLarge: true };
    }
    chunks.push(value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, body };
}

// ---------------------------------------------------------------------------
// GET /api/v1/report-templates
// ---------------------------------------------------------------------------
export async function handleListReportTemplates(
  _request: Request,
  deps: ReportTemplateDeps,
): Promise<Response> {
  const ctx = { requestId: deps.requestId ?? randomUUID() };
  const g = await gate(() => requireTemplateReader(deps.session), ctx);
  if (!g.ok) return g.response;
  try {
    const { data, error } = await deps.session
      .from("report_templates")
      .select(REPORT_TEMPLATE_COLUMNS)
      .order("kind")
      .order("is_active", { ascending: false })
      .order("created_at", { ascending: false })
      .order("id");
    if (error) throw error;
    const rows = (data ?? []) as unknown as ReportTemplateRow[];
    return jsonResponse({ data: rows.map(toReportTemplate) });
  } catch (error) {
    return internal(ctx, "list", error);
  }
}

// ---------------------------------------------------------------------------
// POST /api/v1/report-templates (multipart/form-data: file, name?)
// ---------------------------------------------------------------------------
export async function handleUploadReportTemplate(
  request: Request,
  deps: ReportTemplateDeps,
): Promise<Response> {
  const ctx = { requestId: deps.requestId ?? randomUUID() };
  if (!isSameOrigin(request)) return fail(apiError("forbidden"), ctx);
  const g = await gate(() => requireAdmin(deps.session), ctx);
  if (!g.ok) return g.response;

  const type = request.headers.get("content-type") ?? "";
  if (!/^multipart\/form-data\s*;/i.test(type)) {
    return fail(
      apiError("validation_failed", undefined, [
        { field: "body", issue: "invalid_format" },
      ]),
      ctx,
    );
  }
  const read = await readCappedBody(request, REPORT_TEMPLATE_MAX_REQUEST_BYTES);
  if (!read.ok) {
    return fail(
      apiError("payload_too_large", strings.reportTemplates.errors.tooLarge, [
        { field: "file", issue: "too_long" },
      ]),
      ctx,
    );
  }
  let form: FormData;
  try {
    form = await new Response(read.body as BodyInit, {
      headers: { "content-type": type },
    }).formData();
  } catch {
    return fail(
      apiError("validation_failed", undefined, [
        { field: "body", issue: "invalid_format" },
      ]),
      ctx,
    );
  }
  const parsed = validateUploadForm(form);
  if (!parsed.ok) {
    return fail(apiError("validation_failed", undefined, parsed.details), ctx);
  }
  const { file } = parsed.data;

  const fileName = checkFileName(file.name);
  if (!fileName.ok) {
    return fileName.reason === "invalid_name"
      ? fail(
          apiError(
            "validation_failed",
            strings.reportTemplates.errors.invalidName,
            [{ field: "file", issue: "invalid_value" }],
          ),
          ctx,
        )
      : fail(rejectionError("unsupported_type"), ctx);
  }
  const kind = fileName.kind;
  if (file.size > REPORT_TEMPLATE_MAX_BYTES) {
    return fail(
      apiError("payload_too_large", strings.reportTemplates.errors.tooLarge, [
        { field: "file", issue: "too_long" },
      ]),
      ctx,
    );
  }
  if (!mimeMatches(kind, file.type)) {
    return fail(rejectionError("mime_mismatch"), ctx);
  }
  const bytes = Buffer.from(await file.arrayBuffer());
  const inspection = inspectOoxml(bytes, kind);
  if (!inspection.ok) return fail(rejectionError(inspection.reason), ctx);

  const id = randomUUID();
  const path = storagePathFor(id, kind);
  const name = parsed.data.name ?? fileName.baseName.slice(0, 200).trim();
  try {
    const { error: uploadError } = await deps.session.storage
      .from(REPORT_TEMPLATE_BUCKET)
      .upload(path, bytes, {
        contentType: REPORT_TEMPLATE_MIME[kind],
        upsert: false,
        cacheControl: "0",
      });
    if (uploadError) return internal(ctx, "upload", uploadError);

    const { error: insertError } = await deps.session
      .from("report_templates")
      .insert({
        id,
        kind,
        name,
        storage_path: path,
        size_bytes: bytes.length,
        uploaded_by: g.userId,
      });
    if (insertError) {
      // Dọn tệp vừa tải để không bỏ lại tệp mồ côi.
      await deps.session.storage
        .from(REPORT_TEMPLATE_BUCKET)
        .remove([path])
        .catch(() => undefined);
      return writeFailure(ctx, "insert", insertError);
    }

    // Định dạng chưa có template đang dùng: template đầu tiên tự bật để xuất báo cáo dùng được ngay.
    const { data: active, error: activeError } = await deps.session
      .from("report_templates")
      .select("id")
      .eq("kind", kind)
      .eq("is_active", true)
      .limit(1);
    if (activeError) throw activeError;
    if ((active ?? []).length === 0) {
      const { error: setError } = await deps.session.rpc(
        "set_report_template_active",
        { p_id: id, p_active: true },
      );
      // Hai lần tải cùng lúc: lần kia đã bật trước (23505) thì giữ template này ở trạng thái tắt.
      if (setError && setError.code !== "23505") throw setError;
    }

    const row = await readRow(deps.session, id);
    if (!row) return internal(ctx, "reread", new Error("row not visible"));
    return jsonResponse({ data: toReportTemplate(row) }, 201, {
      location: `/api/v1/report-templates/${id}`,
    });
  } catch (error) {
    return internal(ctx, "create", error);
  }
}

// ---------------------------------------------------------------------------
// PATCH /api/v1/report-templates/{id} { name?, is_active? }
// ---------------------------------------------------------------------------
export async function handlePatchReportTemplate(
  request: Request,
  templateId: string,
  deps: ReportTemplateDeps,
): Promise<Response> {
  const ctx = { requestId: deps.requestId ?? randomUUID() };
  if (!isSameOrigin(request)) return fail(apiError("forbidden"), ctx);
  const g = await gate(() => requireAdmin(deps.session), ctx);
  if (!g.ok) return g.response;
  if (!isUuid(templateId)) return fail(apiError("not_found"), ctx);
  const id = templateId.toLowerCase();

  const read = await readJsonBody(request, REPORT_TEMPLATE_PATCH_MAX_BYTES);
  if (!read.ok) return fail(read.error, ctx);
  const parsed = validatePatch(read.body);
  if (!parsed.ok) {
    return fail(apiError("validation_failed", undefined, parsed.details), ctx);
  }
  const patch = parsed.data;

  try {
    const current = await readRow(deps.session, id);
    if (!current) return fail(apiError("not_found"), ctx);

    if (patch.name !== undefined && patch.name !== current.name) {
      const { error } = await deps.session
        .from("report_templates")
        .update({ name: patch.name })
        .eq("id", id);
      if (error) return writeFailure(ctx, "rename", error);
    }
    if (
      patch.is_active !== undefined &&
      patch.is_active !== current.is_active
    ) {
      const { error } = await deps.session.rpc("set_report_template_active", {
        p_id: id,
        p_active: patch.is_active,
      });
      if (error) return writeFailure(ctx, "activate", error);
    }
    const row = await readRow(deps.session, id);
    if (!row) return fail(apiError("not_found"), ctx);
    return jsonResponse({ data: toReportTemplate(row) });
  } catch (error) {
    return internal(ctx, "update", error);
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/v1/report-templates/{id}
// ---------------------------------------------------------------------------
export async function handleDeleteReportTemplate(
  request: Request,
  templateId: string,
  deps: ReportTemplateDeps,
): Promise<Response> {
  const ctx = { requestId: deps.requestId ?? randomUUID() };
  if (!isSameOrigin(request)) return fail(apiError("forbidden"), ctx);
  const g = await gate(() => requireAdmin(deps.session), ctx);
  if (!g.ok) return g.response;
  if (!isUuid(templateId)) return fail(apiError("not_found"), ctx);
  const id = templateId.toLowerCase();

  try {
    // Xóa dòng TRƯỚC: dòng mất thì không ai dùng được tệp nữa. Xóa tệp lỗi chỉ để lại tệp mồ côi
    // riêng tư (ghi log), không bao giờ để dòng trỏ tới tệp đã mất.
    const { data, error } = await deps.session
      .from("report_templates")
      .delete()
      .eq("id", id)
      .select("storage_path");
    if (error) return writeFailure(ctx, "delete", error);
    const deleted = (data ?? []) as { storage_path: string }[];
    if (deleted.length === 0) return fail(apiError("not_found"), ctx);

    const { error: removeError } = await deps.session.storage
      .from(REPORT_TEMPLATE_BUCKET)
      .remove([deleted[0].storage_path]);
    if (removeError) {
      console.error(
        `[api/v1/report-templates] remove-object request_id=${ctx.requestId} message=${String(removeError.message).slice(0, 200)}`,
      );
    }
    return new Response(null, {
      status: 204,
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    return internal(ctx, "delete", error);
  }
}

/** Tên tệp tải xuống an toàn cho Content-Disposition (ASCII dự phòng + UTF-8 theo RFC 6266). */
export function contentDisposition(name: string, kind: string): string {
  const full = `${name}.${kind}`;
  const ascii =
    full
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[đĐ]/g, (c) => (c === "đ" ? "d" : "D"))
      .replace(/[^A-Za-z0-9._ -]/g, "_")
      .trim() || `template.${kind}`;
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(full)}`;
}

// ---------------------------------------------------------------------------
// GET /api/v1/report-templates/{id}/file — tải tệp (Admin, PM), đọc qua client phiên
// ---------------------------------------------------------------------------
export async function handleDownloadReportTemplate(
  _request: Request,
  templateId: string,
  deps: ReportTemplateDeps,
): Promise<Response> {
  const ctx = { requestId: deps.requestId ?? randomUUID() };
  const g = await gate(() => requireTemplateReader(deps.session), ctx);
  if (!g.ok) return g.response;
  if (!isUuid(templateId)) return fail(apiError("not_found"), ctx);
  const id = templateId.toLowerCase();

  try {
    const row = await readRow(deps.session, id);
    if (!row) return fail(apiError("not_found"), ctx);
    const { data, error } = await deps.session.storage
      .from(REPORT_TEMPLATE_BUCKET)
      .download(row.storage_path);
    if (error || !data) {
      const status = (error as { status?: number } | null)?.status;
      if (status === 400 || status === 404) {
        return fail(apiError("not_found"), ctx);
      }
      return internal(ctx, "download", error);
    }
    return new Response(data, {
      status: 200,
      headers: {
        "content-type": REPORT_TEMPLATE_MIME[row.kind],
        "content-disposition": contentDisposition(row.name, row.kind),
        "content-length": String(data.size),
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    return internal(ctx, "download", error);
  }
}
