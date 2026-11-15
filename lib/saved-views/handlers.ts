import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ApiError } from "@/lib/api/errors";
import {
  isPlainObject,
  isSameOrigin,
  isUuid,
  readJsonBody,
} from "@/lib/api/request";
import { apiError, errorResponse, jsonResponse } from "@/lib/api/respond";
import type { ProjectRole } from "@/lib/project-config/policy";
import {
  SAVED_VIEW_BODY_MAX_BYTES,
  SAVED_VIEW_COLUMNS,
  SAVED_VIEW_VISIBILITIES,
  compareSavedViews,
  type SavedView,
  type SavedViewRow,
  type SavedViewVisibility,
} from "./model";
import {
  canCreateView,
  canEditView,
  canSetVisibility,
  editForbidden,
  mapViewWriteError,
  visibilityForbidden,
  type ViewActor,
} from "./policy";
import {
  validateNoParams,
  validateViewCreate,
  validateViewPatch,
} from "./validate";

/**
 * Lõi của API chế độ xem đã lưu (Story E13-1, QLDA-53; FR-19, BR-12).
 *   GET|POST          /api/v1/projects/{id}/views
 *   GET|PATCH|DELETE  /api/v1/views/{id}
 * Route Handler chỉ tạo client phiên rồi gọi các hàm này; test tích hợp gọi thẳng.
 *
 * Mọi truy vấn chạy bằng client PHIÊN của người gọi (khóa anon, RLS áp dụng), không dùng
 * service_role. Thứ tự kiểm giống API cấu hình dự án (lib/project-config/handlers.ts):
 *   1. (POST/PATCH/DELETE) Origin trùng ứng dụng, chống CSRF: 403.
 *   2. Phiên: getUser(); không có: 401.
 *   3. Dự án/chế độ xem người gọi không được thấy: 404 (BR-10). Chế độ xem riêng tư của người
 *      khác cũng là 404 (kể cả với Admin), không lộ sự tồn tại.
 *   4. Vai trò: công khai chỉ PM của dự án và Admin; riêng tư chỉ chủ sở hữu; mặc định không ai: 403.
 *      Quyền phụ thuộc thân request (visibility muốn đặt), nên thân JSON được ĐỌC trước bước này
 *      (JSON hỏng: 400) nhưng chỉ KIỂM schema sau bước này.
 *   5. Schema, từ chối trường lạ: 400; trùng tên: 409.
 *
 * Yêu thích là của riêng từng người: PATCH chỉ có `is_favorite` chỉ cần đọc được chế độ xem (kể cả
 * công khai của người khác và mặc định).
 */
export interface ViewDeps {
  /** Client theo phiên cookie của người gọi (khóa anon, RLS áp dụng). */
  session: SupabaseClient;
  requestId?: string;
}

interface Ctx {
  requestId: string;
}

type Step<T> = { ok: true; value: T } | { ok: false; response: Response };

function fail(error: ApiError, ctx: Ctx): Response {
  return errorResponse(error, ctx.requestId);
}

/** Ghi log lỗi hệ thống: chỉ mã, thông điệp ngắn và request_id. */
function internal(ctx: Ctx, where: string, error: unknown): Response {
  const e = error as { code?: unknown; message?: unknown };
  console.error(
    `[api/v1/views] ${where} request_id=${ctx.requestId} code=${String(e?.code ?? "")} message=${String(e?.message ?? error).slice(0, 200)}`,
  );
  return fail(apiError("internal_error"), ctx);
}

function newCtx(deps: ViewDeps): Ctx {
  return { requestId: deps.requestId ?? randomUUID() };
}

async function requireUser(
  session: SupabaseClient,
  ctx: Ctx,
): Promise<Step<string>> {
  const { data, error } = await session.auth.getUser();
  const user = error ? null : data.user;
  if (!user) {
    return { ok: false, response: fail(apiError("unauthenticated"), ctx) };
  }
  return { ok: true, value: user.id };
}

async function loadIsAdmin(
  session: SupabaseClient,
  userId: string,
): Promise<boolean> {
  const { data, error } = await session
    .from("profiles")
    .select("is_admin, is_active")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw error;
  return data?.is_admin === true && data?.is_active === true;
}

/** Quyền trong dự án qua RLS; null = dự án không thấy được (nơi gọi trả 404). */
async function loadActor(
  session: SupabaseClient,
  userId: string,
  projectId: string,
): Promise<ViewActor | null> {
  const [project, member, isAdmin] = await Promise.all([
    session.from("projects").select("id").eq("id", projectId).maybeSingle(),
    session
      .from("project_members")
      .select("role")
      .eq("project_id", projectId)
      .eq("user_id", userId)
      .maybeSingle(),
    loadIsAdmin(session, userId),
  ]);
  for (const r of [project, member]) {
    if (r.error) throw r.error;
  }
  if (!project.data) return null;
  return {
    userId,
    isAdmin,
    role: (member.data?.role as ProjectRole | undefined) ?? null,
  };
}

/** Id các chế độ xem người gọi đã đánh dấu yêu thích (RLS: chỉ dấu của mình). */
async function favoriteIds(
  session: SupabaseClient,
  userId: string,
  viewIds: string[],
): Promise<Set<string>> {
  if (viewIds.length === 0) return new Set();
  const { data, error } = await session
    .from("saved_view_favorites")
    .select("view_id")
    .eq("user_id", userId)
    .in("view_id", viewIds);
  if (error) throw error;
  return new Set((data ?? []).map((r) => r.view_id as string));
}

function toView(
  row: SavedViewRow,
  actor: ViewActor,
  favorites: Set<string>,
): SavedView {
  return {
    ...row,
    is_favorite: favorites.has(row.id),
    can_edit: canEditView(actor, row),
  };
}

/** Bước 2-3 cho đường dẫn theo dự án. */
async function projectContext(
  rawProjectId: string,
  deps: ViewDeps,
  ctx: Ctx,
): Promise<Step<{ projectId: string; actor: ViewActor }>> {
  const user = await requireUser(deps.session, ctx);
  if (!user.ok) return user;
  if (!isUuid(rawProjectId)) {
    return { ok: false, response: fail(apiError("not_found"), ctx) };
  }
  const projectId = rawProjectId.toLowerCase();
  const actor = await loadActor(deps.session, user.value, projectId);
  if (!actor) return { ok: false, response: fail(apiError("not_found"), ctx) };
  return { ok: true, value: { projectId, actor } };
}

/** Bước 2-3 cho /views/{id}: phiên, chế độ xem thấy được (RLS), dự án của nó thấy được. */
async function viewContext(
  rawId: string,
  deps: ViewDeps,
  ctx: Ctx,
): Promise<Step<{ row: SavedViewRow; actor: ViewActor }>> {
  const user = await requireUser(deps.session, ctx);
  if (!user.ok) return user;
  if (!isUuid(rawId)) {
    return { ok: false, response: fail(apiError("not_found"), ctx) };
  }
  const { data, error } = await deps.session
    .from("saved_views")
    .select(SAVED_VIEW_COLUMNS)
    .eq("id", rawId.toLowerCase())
    .maybeSingle();
  if (error) throw error;
  const row = data as SavedViewRow | null;
  if (!row) return { ok: false, response: fail(apiError("not_found"), ctx) };
  const actor = row.project_id
    ? await loadActor(deps.session, user.value, row.project_id)
    : {
        userId: user.value,
        isAdmin: await loadIsAdmin(deps.session, user.value),
        role: null,
      };
  if (!actor) return { ok: false, response: fail(apiError("not_found"), ctx) };
  return { ok: true, value: { row, actor } };
}

function writeFailure(
  ctx: Ctx,
  where: string,
  error: { code?: string; message?: string },
): Response {
  const mapped = mapViewWriteError(error);
  return mapped ? fail(mapped, ctx) : internal(ctx, where, error);
}

function rawVisibility(body: unknown): SavedViewVisibility | null {
  if (!isPlainObject(body)) return null;
  const v = body.visibility;
  return typeof v === "string" &&
    (SAVED_VIEW_VISIBILITIES as readonly string[]).includes(v)
    ? (v as SavedViewVisibility)
    : null;
}

// ---------------------------------------------------------------------------
// GET /api/v1/projects/{id}/views: chế độ xem của dự án mà người gọi thấy (công khai, riêng của
// mình, mặc định của dự án và mặc định dùng chung). Không phân trang (số lượng nhỏ).
// ---------------------------------------------------------------------------
export async function handleListViews(
  request: Request,
  rawProjectId: string,
  deps: ViewDeps,
): Promise<Response> {
  const ctx = newCtx(deps);
  try {
    const c = await projectContext(rawProjectId, deps, ctx);
    if (!c.ok) return c.response;
    const { projectId, actor } = c.value;
    const parsed = validateNoParams(new URL(request.url).searchParams);
    if (!parsed.ok) {
      return fail(
        apiError("validation_failed", undefined, parsed.details),
        ctx,
      );
    }
    const { data, error } = await deps.session
      .from("saved_views")
      .select(SAVED_VIEW_COLUMNS)
      .or(
        `project_id.eq.${projectId},and(project_id.is.null,is_default.eq.true)`,
      );
    if (error) throw error;
    const rows = (data ?? []) as SavedViewRow[];
    const favorites = await favoriteIds(
      deps.session,
      actor.userId,
      rows.map((r) => r.id),
    );
    const views = rows
      .map((row) => toView(row, actor, favorites))
      .sort(compareSavedViews);
    return jsonResponse({ data: views });
  } catch (error) {
    return internal(ctx, "list views", error);
  }
}

// ---------------------------------------------------------------------------
// POST /api/v1/projects/{id}/views {name, query, visibility?}
// ---------------------------------------------------------------------------
export async function handleCreateView(
  request: Request,
  rawProjectId: string,
  deps: ViewDeps,
): Promise<Response> {
  const ctx = newCtx(deps);
  if (!isSameOrigin(request)) return fail(apiError("forbidden"), ctx);
  try {
    const c = await projectContext(rawProjectId, deps, ctx);
    if (!c.ok) return c.response;
    const { projectId, actor } = c.value;
    const read = await readJsonBody(request, SAVED_VIEW_BODY_MAX_BYTES);
    if (!read.ok) return fail(read.error, ctx);
    const wanted = rawVisibility(read.body) ?? "private";
    if (!canCreateView(actor, wanted)) {
      return fail(visibilityForbidden(wanted), ctx);
    }
    const parsed = validateViewCreate(read.body);
    if (!parsed.ok) {
      return fail(
        apiError("validation_failed", undefined, parsed.details),
        ctx,
      );
    }
    const { data, error } = await deps.session
      .from("saved_views")
      .insert({ ...parsed.data, project_id: projectId })
      .select(SAVED_VIEW_COLUMNS)
      .single();
    if (error) return writeFailure(ctx, "create view", error);
    const row = data as SavedViewRow;
    return jsonResponse({ data: toView(row, actor, new Set()) }, 201, {
      location: `/api/v1/views/${row.id}`,
    });
  } catch (error) {
    return internal(ctx, "create view", error);
  }
}

// ---------------------------------------------------------------------------
// GET /api/v1/views/{id}
// ---------------------------------------------------------------------------
export async function handleGetView(
  request: Request,
  rawId: string,
  deps: ViewDeps,
): Promise<Response> {
  const ctx = newCtx(deps);
  try {
    const c = await viewContext(rawId, deps, ctx);
    if (!c.ok) return c.response;
    const parsed = validateNoParams(new URL(request.url).searchParams);
    if (!parsed.ok) {
      return fail(
        apiError("validation_failed", undefined, parsed.details),
        ctx,
      );
    }
    const { row, actor } = c.value;
    const favorites = await favoriteIds(deps.session, actor.userId, [row.id]);
    return jsonResponse({ data: toView(row, actor, favorites) });
  } catch (error) {
    return internal(ctx, "get view", error);
  }
}

// ---------------------------------------------------------------------------
// PATCH /api/v1/views/{id} {name?, query?, visibility?, is_favorite?}
// ---------------------------------------------------------------------------
export async function handlePatchView(
  request: Request,
  rawId: string,
  deps: ViewDeps,
): Promise<Response> {
  const ctx = newCtx(deps);
  if (!isSameOrigin(request)) return fail(apiError("forbidden"), ctx);
  try {
    const c = await viewContext(rawId, deps, ctx);
    if (!c.ok) return c.response;
    const { actor } = c.value;
    let row = c.value.row;
    const read = await readJsonBody(request, SAVED_VIEW_BODY_MAX_BYTES);
    if (!read.ok) return fail(read.error, ctx);

    // Bước 4: mọi trường khác is_favorite là sửa chế độ xem, cần quyền sửa.
    if (isPlainObject(read.body)) {
      const edits = Object.keys(read.body).some((k) => k !== "is_favorite");
      if (edits && !canEditView(actor, row)) {
        return fail(editForbidden(row), ctx);
      }
      const next = rawVisibility(read.body);
      if (
        next &&
        next !== row.visibility &&
        !canSetVisibility(actor, row, next)
      ) {
        return fail(visibilityForbidden(next), ctx);
      }
    }

    const parsed = validateViewPatch(read.body);
    if (!parsed.ok) {
      return fail(
        apiError("validation_failed", undefined, parsed.details),
        ctx,
      );
    }
    const { is_favorite, ...fields } = parsed.data;
    if (Object.keys(fields).length > 0) {
      const { data, error } = await deps.session
        .from("saved_views")
        .update(fields)
        .eq("id", row.id)
        .select(SAVED_VIEW_COLUMNS)
        .maybeSingle();
      if (error) return writeFailure(ctx, "update view", error);
      // Không dòng nào: chế độ xem vừa bị xóa hoặc quyền vừa đổi giữa lúc đọc và ghi.
      if (!data) return fail(apiError("not_found"), ctx);
      row = data as SavedViewRow;
    }

    if (is_favorite === true) {
      const { error } = await deps.session
        .from("saved_view_favorites")
        .insert({ view_id: row.id });
      // Đã yêu thích từ trước: coi như thành công.
      if (error && error.code !== "23505") {
        return writeFailure(ctx, "favorite view", error);
      }
    } else if (is_favorite === false) {
      const { error } = await deps.session
        .from("saved_view_favorites")
        .delete()
        .eq("view_id", row.id)
        .eq("user_id", actor.userId);
      if (error) return writeFailure(ctx, "unfavorite view", error);
    }

    const favorites =
      is_favorite === undefined
        ? await favoriteIds(deps.session, actor.userId, [row.id])
        : new Set(is_favorite ? [row.id] : []);
    return jsonResponse({ data: toView(row, actor, favorites) });
  } catch (error) {
    return internal(ctx, "update view", error);
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/v1/views/{id}
// ---------------------------------------------------------------------------
export async function handleDeleteView(
  request: Request,
  rawId: string,
  deps: ViewDeps,
): Promise<Response> {
  const ctx = newCtx(deps);
  if (!isSameOrigin(request)) return fail(apiError("forbidden"), ctx);
  try {
    const c = await viewContext(rawId, deps, ctx);
    if (!c.ok) return c.response;
    const { row, actor } = c.value;
    if (!canEditView(actor, row)) return fail(editForbidden(row), ctx);
    const parsed = validateNoParams(new URL(request.url).searchParams);
    if (!parsed.ok) {
      return fail(
        apiError("validation_failed", undefined, parsed.details),
        ctx,
      );
    }
    const { data, error } = await deps.session
      .from("saved_views")
      .delete()
      .eq("id", row.id)
      .select("id");
    if (error) return writeFailure(ctx, "delete view", error);
    if (!data || data.length === 0) return fail(apiError("not_found"), ctx);
    return new Response(null, {
      status: 204,
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    return internal(ctx, "delete view", error);
  }
}
