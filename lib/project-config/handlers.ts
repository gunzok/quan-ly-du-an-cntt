import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ApiError } from "@/lib/api/errors";
import { isSameOrigin, isUuid, readJsonBody } from "@/lib/api/request";
import { apiError, errorResponse, jsonResponse } from "@/lib/api/respond";
import { strings } from "@/lib/strings";
import {
  CONFIG_TABLES,
  compareConfigItems,
  type ConfigItemByKind,
  type ConfigKind,
} from "./model";
import {
  canManageConfig,
  mapConfigWriteError,
  type ConfigActor,
  type ProjectRole,
} from "./policy";
import {
  CONFIG_BODY_MAX_BYTES,
  CONFIG_POSITION_MAX_ABS,
  validateConfigCreate,
  validateConfigDeleteQuery,
  validateConfigListQuery,
  validateConfigPatch,
  validateTaskTypesQuery,
  type ConfigWrite,
} from "./validate";

/**
 * Lõi của API cấu hình dự án (Story E2-3): trạng thái, loại task, nhãn.
 *   GET|POST   /api/v1/projects/{id}/statuses | task-types | labels
 *   GET        /api/v1/task-types?project_id=   (api-contract.md)
 *   PATCH|DELETE /api/v1/statuses/{id} | task-types/{id} | labels/{id}
 * Route Handler chỉ tạo client phiên rồi gọi các hàm này; test tích hợp gọi thẳng.
 *
 * Mọi truy vấn chạy bằng client PHIÊN của người gọi (khóa anon, RLS áp dụng), không dùng
 * service_role. Thứ tự kiểm giống API task (lib/tasks/handlers.ts):
 *   1. (POST/PATCH/DELETE) Origin trùng ứng dụng, chống CSRF: 403.
 *   2. Phiên: getUser(); không có: 401.
 *   3. Dự án/mục người gọi không được thấy: 404 (BR-10).
 *   4. Vai trò: chỉ PM của dự án và Admin ghi: 403.
 *   5. Schema đầu vào, từ chối trường lạ: 400; trùng tên, còn task dùng: 409; quy tắc khác: 422.
 */
export interface ConfigDeps {
  /** Client theo phiên cookie của người gọi (khóa anon, RLS áp dụng). */
  session: SupabaseClient;
  requestId?: string;
}

interface Ctx {
  requestId: string;
}

type Step<T> = { ok: true; value: T } | { ok: false; response: Response };

type Row = Record<string, unknown> & {
  id: string;
  project_id: string;
  name: string;
  position?: number;
};

function fail(error: ApiError, ctx: Ctx): Response {
  return errorResponse(error, ctx.requestId);
}

/** Ghi log lỗi hệ thống: chỉ mã, thông điệp ngắn và request_id. */
function internal(ctx: Ctx, where: string, error: unknown): Response {
  const e = error as { code?: unknown; message?: unknown };
  console.error(
    `[api/v1/project-config] ${where} request_id=${ctx.requestId} code=${String(e?.code ?? "")} message=${String(e?.message ?? error).slice(0, 200)}`,
  );
  return fail(apiError("internal_error"), ctx);
}

function newCtx(deps: ConfigDeps): Ctx {
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

/** Quyền trong dự án qua RLS; null = dự án không thấy được (nơi gọi trả 404). */
async function loadActor(
  session: SupabaseClient,
  userId: string,
  projectId: string,
): Promise<ConfigActor | null> {
  const [project, member, profile] = await Promise.all([
    session.from("projects").select("id").eq("id", projectId).maybeSingle(),
    session
      .from("project_members")
      .select("role")
      .eq("project_id", projectId)
      .eq("user_id", userId)
      .maybeSingle(),
    session
      .from("profiles")
      .select("is_admin, is_active")
      .eq("id", userId)
      .maybeSingle(),
  ]);
  for (const r of [project, member, profile]) {
    if (r.error) throw r.error;
  }
  if (!project.data) return null;
  return {
    userId,
    isAdmin:
      profile.data?.is_admin === true && profile.data?.is_active === true,
    role: (member.data?.role as ProjectRole | undefined) ?? null,
  };
}

/** Gắn task_count (public.project_config_task_counts, qua RLS) và sắp xếp. */
async function withCounts<K extends ConfigKind>(
  session: SupabaseClient,
  kind: K,
  projectId: string,
  rows: Row[],
): Promise<ConfigItemByKind[K][]> {
  if (rows.length === 0) return [];
  const { data, error } = await session.rpc("project_config_task_counts", {
    p_project_id: projectId,
  });
  if (error) throw error;
  const wanted = CONFIG_TABLES[kind].countKind;
  const counts = new Map<string, number>();
  for (const c of (data ?? []) as {
    kind: string;
    config_id: string;
    task_count: number;
  }[]) {
    if (c.kind === wanted) counts.set(c.config_id, c.task_count);
  }
  return rows
    .map((row) => ({ ...row, task_count: counts.get(row.id) ?? 0 }))
    .sort(compareConfigItems) as unknown as ConfigItemByKind[K][];
}

async function listRows(
  session: SupabaseClient,
  kind: ConfigKind,
  projectId: string,
): Promise<Row[]> {
  const config = CONFIG_TABLES[kind];
  const { data, error } = await session
    .from(config.table)
    .select(config.columns)
    .eq("project_id", projectId);
  if (error) throw error;
  return (data ?? []) as unknown as Row[];
}

/** Bước 2-3 cho đường dẫn theo dự án. */
async function projectContext(
  rawProjectId: string,
  deps: ConfigDeps,
  ctx: Ctx,
): Promise<Step<{ projectId: string; actor: ConfigActor }>> {
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

/** Bước 1-4 cho /{kind}/{id}: Origin, phiên, mục thấy được, quyền ghi. */
async function itemContext(
  request: Request,
  kind: ConfigKind,
  rawId: string,
  deps: ConfigDeps,
  ctx: Ctx,
): Promise<Step<{ row: Row; actor: ConfigActor }>> {
  if (!isSameOrigin(request)) {
    return { ok: false, response: fail(apiError("forbidden"), ctx) };
  }
  const user = await requireUser(deps.session, ctx);
  if (!user.ok) return user;
  if (!isUuid(rawId)) {
    return { ok: false, response: fail(apiError("not_found"), ctx) };
  }
  const config = CONFIG_TABLES[kind];
  const { data, error } = await deps.session
    .from(config.table)
    .select(config.columns)
    .eq("id", rawId.toLowerCase())
    .maybeSingle();
  if (error) throw error;
  const row = data as unknown as Row | null;
  if (!row) return { ok: false, response: fail(apiError("not_found"), ctx) };
  const actor = await loadActor(deps.session, user.value, row.project_id);
  if (!actor) return { ok: false, response: fail(apiError("not_found"), ctx) };
  if (!canManageConfig(actor)) {
    return {
      ok: false,
      response: fail(
        apiError("forbidden", strings.projectConfig.errors.forbidden),
        ctx,
      ),
    };
  }
  return { ok: true, value: { row, actor } };
}

function writeFailure(
  kind: ConfigKind,
  ctx: Ctx,
  where: string,
  error: { code?: string; message?: string; details?: string | null },
): Response {
  const mapped = mapConfigWriteError(kind, error);
  return mapped ? fail(mapped, ctx) : internal(ctx, where, error);
}

// ---------------------------------------------------------------------------
// GET /api/v1/projects/{id}/{kind}
// ---------------------------------------------------------------------------
export async function handleListConfig(
  request: Request,
  kind: ConfigKind,
  rawProjectId: string,
  deps: ConfigDeps,
): Promise<Response> {
  const ctx = newCtx(deps);
  try {
    const c = await projectContext(rawProjectId, deps, ctx);
    if (!c.ok) return c.response;
    const parsed = validateConfigListQuery(new URL(request.url).searchParams);
    if (!parsed.ok) {
      return fail(
        apiError("validation_failed", undefined, parsed.details),
        ctx,
      );
    }
    const rows = await listRows(deps.session, kind, c.value.projectId);
    const data = await withCounts(deps.session, kind, c.value.projectId, rows);
    return jsonResponse({ data });
  } catch (error) {
    return internal(ctx, `list ${kind}`, error);
  }
}

// ---------------------------------------------------------------------------
// GET /api/v1/task-types?project_id= (api-contract.md mục 3)
// ---------------------------------------------------------------------------
export async function handleListTaskTypesByQuery(
  request: Request,
  deps: ConfigDeps,
): Promise<Response> {
  const ctx = newCtx(deps);
  try {
    const user = await requireUser(deps.session, ctx);
    if (!user.ok) return user.response;
    const parsed = validateTaskTypesQuery(new URL(request.url).searchParams);
    if (!parsed.ok) {
      return fail(
        apiError("validation_failed", undefined, parsed.details),
        ctx,
      );
    }
    const projectId = parsed.data.project_id;
    const actor = await loadActor(deps.session, user.value, projectId);
    if (!actor) return fail(apiError("not_found"), ctx);
    const rows = await listRows(deps.session, "task-types", projectId);
    const data = await withCounts(deps.session, "task-types", projectId, rows);
    return jsonResponse({ data });
  } catch (error) {
    return internal(ctx, "list task-types", error);
  }
}

// ---------------------------------------------------------------------------
// POST /api/v1/projects/{id}/{kind}
// ---------------------------------------------------------------------------
export async function handleCreateConfig(
  request: Request,
  kind: ConfigKind,
  rawProjectId: string,
  deps: ConfigDeps,
): Promise<Response> {
  const ctx = newCtx(deps);
  if (!isSameOrigin(request)) return fail(apiError("forbidden"), ctx);
  try {
    const c = await projectContext(rawProjectId, deps, ctx);
    if (!c.ok) return c.response;
    const { projectId, actor } = c.value;
    if (!canManageConfig(actor)) {
      return fail(
        apiError("forbidden", strings.projectConfig.errors.forbidden),
        ctx,
      );
    }
    const read = await readJsonBody(request, CONFIG_BODY_MAX_BYTES);
    if (!read.ok) return fail(read.error, ctx);
    const parsed = validateConfigCreate(kind, read.body);
    if (!parsed.ok) {
      return fail(
        apiError("validation_failed", undefined, parsed.details),
        ctx,
      );
    }
    const config = CONFIG_TABLES[kind];
    const values: ConfigWrite & { project_id: string } = {
      ...parsed.data,
      project_id: projectId,
    };
    if (config.ordered && values.position === undefined) {
      // Xếp cuối. Hai lần thêm cùng lúc có thể trùng position: vô hại (sắp tiếp theo tên).
      const { data: last, error } = await deps.session
        .from(config.table)
        .select("position")
        .eq("project_id", projectId)
        .order("position", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      const max = (last?.position as number | undefined) ?? 0;
      values.position = Math.min(Math.floor(max) + 1, CONFIG_POSITION_MAX_ABS);
    }
    const { data, error } = await deps.session
      .from(config.table)
      .insert(values)
      .select(config.columns)
      .single();
    if (error) return writeFailure(kind, ctx, `create ${kind}`, error);
    const row = data as unknown as Row;
    return jsonResponse({ data: { ...row, task_count: 0 } }, 201, {
      location: `/api/v1/${kind}/${row.id}`,
    });
  } catch (error) {
    return internal(ctx, `create ${kind}`, error);
  }
}

// ---------------------------------------------------------------------------
// PATCH /api/v1/{kind}/{id}: đổi tên, nhóm, màu, thứ tự, mốc
// ---------------------------------------------------------------------------
export async function handlePatchConfig(
  request: Request,
  kind: ConfigKind,
  rawId: string,
  deps: ConfigDeps,
): Promise<Response> {
  const ctx = newCtx(deps);
  try {
    const c = await itemContext(request, kind, rawId, deps, ctx);
    if (!c.ok) return c.response;
    const { row } = c.value;
    const read = await readJsonBody(request, CONFIG_BODY_MAX_BYTES);
    if (!read.ok) return fail(read.error, ctx);
    const parsed = validateConfigPatch(kind, read.body);
    if (!parsed.ok) {
      return fail(
        apiError("validation_failed", undefined, parsed.details),
        ctx,
      );
    }
    const config = CONFIG_TABLES[kind];
    const { data, error } = await deps.session
      .from(config.table)
      .update(parsed.data)
      .eq("id", row.id)
      .select(config.columns)
      .maybeSingle();
    if (error) return writeFailure(kind, ctx, `update ${kind}`, error);
    // Không dòng nào: mục vừa bị xóa hoặc quyền vừa đổi giữa lúc đọc và ghi.
    if (!data) return fail(apiError("not_found"), ctx);
    const [item] = await withCounts(deps.session, kind, row.project_id, [
      data as unknown as Row,
    ]);
    return jsonResponse({ data: item });
  } catch (error) {
    return internal(ctx, `update ${kind}`, error);
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/v1/{kind}/{id}[?replace_with=<uuid>]
// Trạng thái/loại đang có task: 409 trừ khi có replace_with; khi đó chuyển task rồi xóa trong
// cùng giao dịch (public.delete_task_status / delete_task_type, AC2). Nhãn: xóa thẳng (gỡ khỏi
// task theo ON DELETE CASCADE).
// ---------------------------------------------------------------------------
export async function handleDeleteConfig(
  request: Request,
  kind: ConfigKind,
  rawId: string,
  deps: ConfigDeps,
): Promise<Response> {
  const ctx = newCtx(deps);
  try {
    const c = await itemContext(request, kind, rawId, deps, ctx);
    if (!c.ok) return c.response;
    const { row } = c.value;
    const parsed = validateConfigDeleteQuery(
      kind,
      new URL(request.url).searchParams,
    );
    if (!parsed.ok) {
      return fail(
        apiError("validation_failed", undefined, parsed.details),
        ctx,
      );
    }
    const config = CONFIG_TABLES[kind];
    if (config.deleteRpc) {
      const { error } = await deps.session.rpc(config.deleteRpc.fn, {
        [config.deleteRpc.idArg]: row.id,
        p_replace_with: parsed.data.replace_with,
      });
      if (error) return writeFailure(kind, ctx, `delete ${kind}`, error);
    } else {
      const { data, error } = await deps.session
        .from(config.table)
        .delete()
        .eq("id", row.id)
        .select("id");
      if (error) return writeFailure(kind, ctx, `delete ${kind}`, error);
      if (!data || data.length === 0) return fail(apiError("not_found"), ctx);
    }
    return new Response(null, {
      status: 204,
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    return internal(ctx, `delete ${kind}`, error);
  }
}
