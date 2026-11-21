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
import { apiError, errorResponse, jsonResponse } from "@/lib/api/respond";
import { strings } from "@/lib/strings";
import {
  PROJECT_TEMPLATE_COLUMNS,
  toProjectTemplate,
  type ProjectTemplateRow,
} from "./model";
import {
  canManageTemplate,
  canSaveTemplate,
  decideTemplateGate,
  mapTemplateWriteError,
  type TemplateGate,
} from "./policy";
import {
  PROJECT_TEMPLATE_BODY_MAX_BYTES,
  validateTemplateListQuery,
  validateTemplatePatch,
  validateTemplateSave,
} from "./validate";

/**
 * Lõi của /api/v1/project-templates và POST /api/v1/projects/{id}/templates (Story E7-1, FR-04).
 * Route Handler chỉ tạo client phiên rồi gọi các hàm này; test tích hợp gọi thẳng.
 *
 * Mọi truy vấn chạy bằng client PHIÊN của người gọi (khóa anon, RLS áp dụng), không service_role
 * (riêng bộ đếm giới hạn tần suất dùng service_role bên trong lib/api/rate-limit như mọi API).
 * Thứ tự kiểm (api-contract.md mục 2):
 *   - Template (tài nguyên toàn hệ thống, như /report-templates): Origin 403 (ghi) → phiên 401 →
 *     không phải Admin/PM 403 → id sai hoặc không thấy 404 → không phải người lưu/Admin 403 →
 *     schema 400 → tên trùng 409.
 *   - Lưu dự án thành template: Origin 403 → phiên 401 → dự án không thấy 404 → không phải PM của
 *     dự án/Admin 403 → schema 400 → giới hạn tần suất 429 → quá 2.000 task / quá lớn 422 → tên
 *     trùng 409.
 */
export interface ProjectTemplateDeps {
  /** Client theo phiên cookie của người gọi (khóa anon, RLS áp dụng). */
  session: SupabaseClient;
  requestId?: string;
  /** Giới hạn tần suất lưu template; test truyền bản giả. Mặc định limitUser(id, "projectTemplate"). */
  rateLimit?: (userId: string) => Promise<RateLimitOutcome>;
}

interface Ctx {
  requestId: string;
}

function fail(error: ApiError, ctx: Ctx) {
  return errorResponse(error, ctx.requestId);
}

/** Log lỗi hệ thống: chỉ mã, thông điệp ngắn, request_id; không ghi tên template hay dữ liệu task. */
function internal(ctx: Ctx, where: string, error: unknown) {
  const e = error as { code?: unknown; message?: unknown };
  console.error(
    `[api/v1/project-templates] ${where} request_id=${ctx.requestId} code=${String(e?.code ?? "")} message=${String(e?.message ?? error).slice(0, 200)}`,
  );
  return fail(apiError("internal_error"), ctx);
}

/** Người gọi xem được template dự án: Admin hoặc PM (ở ≥ 1 dự án) đang hoạt động. */
export async function requireProjectTemplateReader(
  session: SupabaseClient,
): Promise<TemplateGate> {
  const { data: userData, error: userError } = await session.auth.getUser();
  const user = userError ? null : userData.user;
  if (!user) return decideTemplateGate(null, null, false);
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
  return decideTemplateGate(user, profile, (pm ?? []).length > 0);
}

type Gate =
  | { ok: true; userId: string; isAdmin: boolean }
  | { ok: false; response: Response };

async function gate(session: SupabaseClient, ctx: Ctx): Promise<Gate> {
  try {
    const result = await requireProjectTemplateReader(session);
    return result.ok
      ? result
      : { ok: false, response: fail(result.error, ctx) };
  } catch (error) {
    return { ok: false, response: internal(ctx, "gate", error) };
  }
}

async function readRow(
  session: SupabaseClient,
  id: string,
): Promise<ProjectTemplateRow | null> {
  const { data, error } = await session
    .from("project_templates")
    .select(PROJECT_TEMPLATE_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return (data as unknown as ProjectTemplateRow | null) ?? null;
}

function writeFailure(
  ctx: Ctx,
  where: string,
  error: { code?: string; message?: string },
) {
  const mapped = mapTemplateWriteError(error);
  return mapped ? fail(mapped, ctx) : internal(ctx, where, error);
}

// ---------------------------------------------------------------------------
// GET /api/v1/project-templates?include_archived=
// ---------------------------------------------------------------------------
export async function handleListProjectTemplates(
  request: Request,
  deps: ProjectTemplateDeps,
): Promise<Response> {
  const ctx = { requestId: deps.requestId ?? randomUUID() };
  const g = await gate(deps.session, ctx);
  if (!g.ok) return g.response;
  const parsed = validateTemplateListQuery(new URL(request.url).searchParams);
  if (!parsed.ok) {
    return fail(apiError("validation_failed", undefined, parsed.details), ctx);
  }
  try {
    let query = deps.session
      .from("project_templates")
      .select(PROJECT_TEMPLATE_COLUMNS);
    if (!parsed.data.includeArchived) query = query.is("archived_at", null);
    // Template là danh mục nhỏ của công ty: không phân trang, trần 500 dòng.
    const { data, error } = await query
      .order("archived_at", { ascending: false, nullsFirst: true })
      .order("created_at", { ascending: false })
      .order("id")
      .limit(500);
    if (error) throw error;
    const rows = (data ?? []) as unknown as ProjectTemplateRow[];
    return jsonResponse({ data: rows.map((r) => toProjectTemplate(r, g)) });
  } catch (error) {
    return internal(ctx, "list", error);
  }
}

// ---------------------------------------------------------------------------
// GET /api/v1/project-templates/{id}
// ---------------------------------------------------------------------------
export async function handleGetProjectTemplate(
  _request: Request,
  templateId: string,
  deps: ProjectTemplateDeps,
): Promise<Response> {
  const ctx = { requestId: deps.requestId ?? randomUUID() };
  const g = await gate(deps.session, ctx);
  if (!g.ok) return g.response;
  if (!isUuid(templateId)) return fail(apiError("not_found"), ctx);
  try {
    const row = await readRow(deps.session, templateId.toLowerCase());
    if (!row) return fail(apiError("not_found"), ctx);
    return jsonResponse({ data: toProjectTemplate(row, g) });
  } catch (error) {
    return internal(ctx, "get", error);
  }
}

// ---------------------------------------------------------------------------
// PATCH /api/v1/project-templates/{id} { name?, archived? }
// ---------------------------------------------------------------------------
export async function handlePatchProjectTemplate(
  request: Request,
  templateId: string,
  deps: ProjectTemplateDeps,
): Promise<Response> {
  const ctx = { requestId: deps.requestId ?? randomUUID() };
  if (!isSameOrigin(request)) return fail(apiError("forbidden"), ctx);
  const g = await gate(deps.session, ctx);
  if (!g.ok) return g.response;
  if (!isUuid(templateId)) return fail(apiError("not_found"), ctx);
  const id = templateId.toLowerCase();

  let current: ProjectTemplateRow | null;
  try {
    current = await readRow(deps.session, id);
  } catch (error) {
    return internal(ctx, "read", error);
  }
  if (!current) return fail(apiError("not_found"), ctx);
  if (!canManageTemplate(g, current.created_by)) {
    return fail(
      apiError("forbidden", strings.projectTemplates.errors.forbiddenManage),
      ctx,
    );
  }

  const read = await readJsonBody(request, PROJECT_TEMPLATE_BODY_MAX_BYTES);
  if (!read.ok) return fail(read.error, ctx);
  const parsed = validateTemplatePatch(read.body);
  if (!parsed.ok) {
    return fail(apiError("validation_failed", undefined, parsed.details), ctx);
  }
  const patch = parsed.data;
  const update: { name?: string; archived_at?: string | null } = {};
  if (patch.name !== undefined && patch.name !== current.name) {
    update.name = patch.name;
  }
  if (
    patch.archived !== undefined &&
    patch.archived !== (current.archived_at !== null)
  ) {
    update.archived_at = patch.archived ? new Date().toISOString() : null;
  }

  try {
    if (Object.keys(update).length > 0) {
      const { data, error } = await deps.session
        .from("project_templates")
        .update(update)
        .eq("id", id)
        .select("id");
      if (error) return writeFailure(ctx, "update", error);
      // RLS lọc mất dòng (quyền vừa bị thu giữa lúc kiểm và lúc ghi).
      if ((data ?? []).length === 0) return fail(apiError("forbidden"), ctx);
    }
    const row = await readRow(deps.session, id);
    if (!row) return fail(apiError("not_found"), ctx);
    return jsonResponse({ data: toProjectTemplate(row, g) });
  } catch (error) {
    return internal(ctx, "update", error);
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/v1/project-templates/{id}
// ---------------------------------------------------------------------------
export async function handleDeleteProjectTemplate(
  request: Request,
  templateId: string,
  deps: ProjectTemplateDeps,
): Promise<Response> {
  const ctx = { requestId: deps.requestId ?? randomUUID() };
  if (!isSameOrigin(request)) return fail(apiError("forbidden"), ctx);
  const g = await gate(deps.session, ctx);
  if (!g.ok) return g.response;
  if (!isUuid(templateId)) return fail(apiError("not_found"), ctx);
  const id = templateId.toLowerCase();

  try {
    const current = await readRow(deps.session, id);
    if (!current) return fail(apiError("not_found"), ctx);
    if (!canManageTemplate(g, current.created_by)) {
      return fail(
        apiError("forbidden", strings.projectTemplates.errors.forbiddenManage),
        ctx,
      );
    }
    const { data, error } = await deps.session
      .from("project_templates")
      .delete()
      .eq("id", id)
      .select("id");
    if (error) return writeFailure(ctx, "delete", error);
    if ((data ?? []).length === 0) return fail(apiError("forbidden"), ctx);
    return new Response(null, {
      status: 204,
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    return internal(ctx, "delete", error);
  }
}

// ---------------------------------------------------------------------------
// POST /api/v1/projects/{id}/templates { name }: lưu dự án thành template
// ---------------------------------------------------------------------------
export async function handleSaveProjectAsTemplate(
  request: Request,
  rawProjectId: string,
  deps: ProjectTemplateDeps,
): Promise<Response> {
  const ctx = { requestId: deps.requestId ?? randomUUID() };
  if (!isSameOrigin(request)) return fail(apiError("forbidden"), ctx);

  let userId: string;
  let isAdmin: boolean;
  let projectId: string;
  try {
    const { data: auth, error: authError } = await deps.session.auth.getUser();
    if (authError || !auth.user) return fail(apiError("unauthenticated"), ctx);
    userId = auth.user.id;
    if (!isUuid(rawProjectId)) return fail(apiError("not_found"), ctx);
    projectId = rawProjectId.toLowerCase();
    const [project, member, profile] = await Promise.all([
      deps.session
        .from("projects")
        .select("id")
        .eq("id", projectId)
        .maybeSingle(),
      deps.session
        .from("project_members")
        .select("role")
        .eq("project_id", projectId)
        .eq("user_id", userId)
        .maybeSingle(),
      deps.session
        .from("profiles")
        .select("is_admin, is_active")
        .eq("id", userId)
        .maybeSingle(),
    ]);
    for (const r of [project, member, profile]) if (r.error) throw r.error;
    // RLS projects: chỉ thành viên dự án và Admin thấy (BR-10); người bị khóa không thấy gì.
    if (!project.data) return fail(apiError("not_found"), ctx);
    const p = profile.data as { is_admin: boolean; is_active: boolean } | null;
    isAdmin = p?.is_admin === true && p.is_active === true;
    if (
      !canSaveTemplate({
        isAdmin,
        isActive: p?.is_active === true,
        role: (member.data?.role as string | undefined) ?? null,
      })
    ) {
      return fail(
        apiError("forbidden", strings.projectTemplates.errors.forbiddenSave),
        ctx,
      );
    }
  } catch (error) {
    return internal(ctx, "gate", error);
  }

  const read = await readJsonBody(request, PROJECT_TEMPLATE_BODY_MAX_BYTES);
  if (!read.ok) return fail(read.error, ctx);
  const parsed = validateTemplateSave(read.body);
  if (!parsed.ok) {
    return fail(apiError("validation_failed", undefined, parsed.details), ctx);
  }

  const limit = await (
    deps.rateLimit ?? ((id) => limitUser(id, "projectTemplate"))
  )(userId);
  if (!limit.ok) {
    if (limit.reason === "limited") {
      return rateLimitedResponse(limit.retryAfterSeconds, ctx.requestId);
    }
    // Fail-open như giới hạn API chung: kiểm quyền và RLS vẫn áp dụng.
    logRateLimitUnavailable("projectTemplate", limit.detail, ctx.requestId);
  }

  try {
    const { data, error } = await deps.session.rpc("save_project_as_template", {
      p_project_id: projectId,
      p_name: parsed.data.name,
    });
    if (error) return writeFailure(ctx, "save", error);
    const id = typeof data === "string" ? data : null;
    if (!id) return internal(ctx, "save", new Error("empty_id"));
    const row = await readRow(deps.session, id);
    if (!row) return internal(ctx, "save", new Error("not_visible"));
    return jsonResponse(
      { data: toProjectTemplate(row, { userId, isAdmin }) },
      201,
      {
        location: `/api/v1/project-templates/${id}`,
      },
    );
  } catch (error) {
    return internal(ctx, "save", error);
  }
}
