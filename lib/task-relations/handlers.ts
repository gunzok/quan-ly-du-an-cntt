import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ApiError } from "@/lib/api/errors";
import { isSameOrigin, isUuid, readJsonBody } from "@/lib/api/request";
import { apiError, errorResponse, jsonResponse } from "@/lib/api/respond";
import type { Actor, ProjectRole } from "@/lib/tasks/policy";
import {
  RELATION_COLUMNS,
  toRelationView,
  type RelatedTask,
  type TaskRelation,
  type TaskRelationListResponse,
} from "./model";
import {
  canManageRelation,
  crossProjectError,
  forbiddenRelation,
  mapRelationWriteError,
  selfRelationError,
} from "./policy";
import { RELATION_BODY_MAX_BYTES, validateRelationCreate } from "./validate";

/**
 * Lõi của /api/v1/tasks/{id}/relations và /api/v1/tasks/{id}/relations/{relation_id} (Story E8-1).
 * Route Handler chỉ tạo client phiên rồi gọi các hàm này; test tích hợp gọi thẳng.
 *
 * Mọi truy vấn chạy bằng client PHIÊN của người gọi (khóa anon, RLS áp dụng), không dùng
 * service_role: RLS là lớp kiểm thứ hai và quyết định cuối cùng.
 *
 * Thứ tự kiểm (giống API task, lib/tasks/handlers.ts):
 *   1. (POST/DELETE) Origin trùng ứng dụng, chống CSRF: 403 (proxy.ts đã kiểm, handler tự kiểm lại).
 *   2. Phiên: getUser(); không có: 401.
 *   3. Task {id} (và task đích, quan hệ) người gọi không thấy được: 404 (BR-10, không lộ tồn tại).
 *   4. Quyền: sửa được cả hai task (BR-03): 403.
 *   5. Schema đầu vào, từ chối trường lạ: 400; quy tắc nghiệp vụ: tự quan hệ, khác dự án 422;
 *      tạo vòng (BR-05), trùng: 409.
 */
export interface TaskRelationDeps {
  /** Client theo phiên cookie của người gọi (khóa anon, RLS áp dụng). */
  session: SupabaseClient;
  requestId?: string;
}

interface Ctx {
  requestId: string;
}

type Step<T> = { ok: true; value: T } | { ok: false; response: Response };

/** Task ở mức cần cho kiểm quyền và hiển thị. */
interface TaskRef extends RelatedTask {
  project_id: string;
  assignee_id: string | null;
  created_by: string | null;
}

const TASK_REF_COLUMNS =
  "id, project_id, title, status_id, assignee_id, created_by";

type RelationWithTasks = TaskRelation & {
  from_task: TaskRef | null;
  to_task: TaskRef | null;
};

// Nhúng hai task qua tên khóa ngoại (PostgREST); task không thấy được (RLS) thì nhúng ra null.
const RELATION_WITH_TASKS = `${RELATION_COLUMNS}, from_task:tasks!task_relations_from_task_id_fkey(${TASK_REF_COLUMNS}), to_task:tasks!task_relations_to_task_id_fkey(${TASK_REF_COLUMNS})`;

function fail(error: ApiError, ctx: Ctx): Response {
  return errorResponse(error, ctx.requestId);
}

/** Ghi log lỗi hệ thống: chỉ mã, thông điệp ngắn và request_id; không ghi dữ liệu task. */
function internal(ctx: Ctx, where: string, error: unknown): Response {
  const e = error as { code?: unknown; message?: unknown };
  console.error(
    `[api/v1/tasks/relations] ${where} request_id=${ctx.requestId} code=${String(e?.code ?? "")} message=${String(e?.message ?? error).slice(0, 200)}`,
  );
  return fail(apiError("internal_error"), ctx);
}

function newCtx(deps: TaskRelationDeps): Ctx {
  return { requestId: deps.requestId ?? randomUUID() };
}

function notFound(ctx: Ctx): { ok: false; response: Response } {
  return { ok: false, response: fail(apiError("not_found"), ctx) };
}

async function loadTaskRef(
  session: SupabaseClient,
  id: string,
): Promise<TaskRef | null> {
  const { data, error } = await session
    .from("tasks")
    .select(TASK_REF_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return (data as TaskRef | null) ?? null;
}

/** Quyền của người gọi trong dự án, đọc qua RLS. null = dự án không thấy được. */
async function loadActor(
  session: SupabaseClient,
  userId: string,
  projectId: string,
): Promise<Actor | null> {
  const [project, member, profile] = await Promise.all([
    session.from("projects").select("id").eq("id", projectId).maybeSingle(),
    session
      .from("project_members")
      .select("role")
      .eq("project_id", projectId)
      .eq("user_id", userId)
      .maybeSingle(),
    session.from("profiles").select("is_admin").eq("id", userId).maybeSingle(),
  ]);
  for (const r of [project, member, profile]) {
    if (r.error) throw r.error;
  }
  if (!project.data) return null;
  return {
    userId,
    isAdmin: profile.data?.is_admin === true,
    role: (member.data?.role as ProjectRole | undefined) ?? null,
  };
}

/** Bước 1-3: Origin (nếu ghi), phiên, task {id} thấy được, quyền người gọi trong dự án. */
async function taskContext(
  request: Request,
  rawId: string,
  deps: TaskRelationDeps,
  ctx: Ctx,
  write: boolean,
): Promise<Step<{ task: TaskRef; actor: Actor }>> {
  if (write && !isSameOrigin(request)) {
    return { ok: false, response: fail(apiError("forbidden"), ctx) };
  }
  const { data, error } = await deps.session.auth.getUser();
  const user = error ? null : data.user;
  if (!user) {
    return { ok: false, response: fail(apiError("unauthenticated"), ctx) };
  }
  if (!isUuid(rawId)) return notFound(ctx);
  const task = await loadTaskRef(deps.session, rawId.toLowerCase());
  if (!task) return notFound(ctx);
  const actor = await loadActor(deps.session, user.id, task.project_id);
  if (!actor) return notFound(ctx);
  return { ok: true, value: { task, actor } };
}

/** Quan hệ {relationId} có dính tới task {taskId} và người gọi thấy được cả hai đầu. */
async function loadRelation(
  session: SupabaseClient,
  rawRelationId: string,
  taskId: string,
): Promise<{ row: RelationWithTasks; other: TaskRef } | null> {
  if (!isUuid(rawRelationId)) return null;
  const { data, error } = await session
    .from("task_relations")
    .select(RELATION_WITH_TASKS)
    .eq("id", rawRelationId.toLowerCase())
    .maybeSingle();
  if (error) throw error;
  const row = data as RelationWithTasks | null;
  if (!row || !row.from_task || !row.to_task) return null;
  if (row.from_task_id === taskId) return { row, other: row.to_task };
  if (row.to_task_id === taskId) return { row, other: row.from_task };
  return null;
}

function stripTasks(row: RelationWithTasks): TaskRelation {
  return {
    id: row.id,
    from_task_id: row.from_task_id,
    to_task_id: row.to_task_id,
    kind: row.kind,
    lag_days: row.lag_days,
    created_by: row.created_by,
    created_at: row.created_at,
  };
}

// ---------------------------------------------------------------------------
// GET /api/v1/tasks/{id}/relations: mọi quan hệ của task, cả hai chiều (kèm quan hệ đảo).
// ---------------------------------------------------------------------------
export async function handleListRelations(
  request: Request,
  rawId: string,
  deps: TaskRelationDeps,
): Promise<Response> {
  const ctx = newCtx(deps);
  try {
    const c = await taskContext(request, rawId, deps, ctx, false);
    if (!c.ok) return c.response;
    const { task } = c.value;
    // task.id là uuid đã kiểm (đọc lại từ CSDL) nên ghép vào bộ lọc an toàn.
    const { data, error } = await deps.session
      .from("task_relations")
      .select(RELATION_WITH_TASKS)
      .or(`from_task_id.eq.${task.id},to_task_id.eq.${task.id}`)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true });
    if (error) throw error;

    const body: TaskRelationListResponse = { data: [] };
    for (const row of (data ?? []) as RelationWithTasks[]) {
      const other = row.from_task_id === task.id ? row.to_task : row.from_task;
      if (!other) continue; // RLS đã lọc; phòng thủ thêm
      body.data.push(toRelationView(stripTasks(row), task.id, other));
    }
    return jsonResponse(body);
  } catch (error) {
    return internal(ctx, "list", error);
  }
}

// ---------------------------------------------------------------------------
// GET /api/v1/tasks/{id}/relations/{relation_id}: một quan hệ (đích của Location khi tạo).
// ---------------------------------------------------------------------------
export async function handleGetRelation(
  request: Request,
  rawId: string,
  rawRelationId: string,
  deps: TaskRelationDeps,
): Promise<Response> {
  const ctx = newCtx(deps);
  try {
    const c = await taskContext(request, rawId, deps, ctx, false);
    if (!c.ok) return c.response;
    const { task } = c.value;
    const found = await loadRelation(deps.session, rawRelationId, task.id);
    if (!found) return fail(apiError("not_found"), ctx);
    return jsonResponse({
      data: toRelationView(stripTasks(found.row), task.id, found.other),
    });
  } catch (error) {
    return internal(ctx, "get", error);
  }
}

// ---------------------------------------------------------------------------
// POST /api/v1/tasks/{id}/relations: { kind, to_task_id, lag_days? }
// ---------------------------------------------------------------------------
export async function handleCreateRelation(
  request: Request,
  rawId: string,
  deps: TaskRelationDeps,
): Promise<Response> {
  const ctx = newCtx(deps);
  try {
    const c = await taskContext(request, rawId, deps, ctx, true);
    if (!c.ok) return c.response;
    const { task: from, actor } = c.value;
    // Bước 4 (một phần): không sửa được task nguồn thì dừng trước khi đọc thân request.
    if (!canManageRelation(actor, from, from)) {
      return fail(forbiddenRelation(), ctx);
    }

    const read = await readJsonBody(request, RELATION_BODY_MAX_BYTES);
    if (!read.ok) return fail(read.error, ctx);
    const parsed = validateRelationCreate(read.body);
    if (!parsed.ok) {
      return fail(
        apiError("validation_failed", undefined, parsed.details),
        ctx,
      );
    }
    const input = parsed.data;

    if (input.to_task_id === from.id) return fail(selfRelationError(), ctx);
    const to = await loadTaskRef(deps.session, input.to_task_id);
    if (!to) return fail(apiError("not_found"), ctx);
    if (to.project_id !== from.project_id) {
      return fail(crossProjectError(), ctx);
    }
    if (!canManageRelation(actor, from, to)) {
      return fail(forbiddenRelation(), ctx);
    }

    // created_by không gửi: cột lấy mặc định auth.uid() và trình duyệt không có quyền cột này.
    const { data, error } = await deps.session
      .from("task_relations")
      .insert({
        from_task_id: from.id,
        to_task_id: to.id,
        kind: input.kind,
        lag_days: input.lag_days,
      })
      .select(RELATION_COLUMNS)
      .single();
    if (error) {
      const mapped = mapRelationWriteError(error);
      return mapped ? fail(mapped, ctx) : internal(ctx, "create", error);
    }
    const row = data as TaskRelation;
    return jsonResponse({ data: toRelationView(row, from.id, to) }, 201, {
      location: `/api/v1/tasks/${from.id}/relations/${row.id}`,
    });
  } catch (error) {
    return internal(ctx, "create", error);
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/v1/tasks/{id}/relations/{relation_id}: gọi được từ task ở đầu nào của quan hệ.
// ---------------------------------------------------------------------------
export async function handleDeleteRelation(
  request: Request,
  rawId: string,
  rawRelationId: string,
  deps: TaskRelationDeps,
): Promise<Response> {
  const ctx = newCtx(deps);
  try {
    const c = await taskContext(request, rawId, deps, ctx, true);
    if (!c.ok) return c.response;
    const { task, actor } = c.value;
    const found = await loadRelation(deps.session, rawRelationId, task.id);
    if (!found) return fail(apiError("not_found"), ctx);
    if (!canManageRelation(actor, task, found.other)) {
      return fail(forbiddenRelation(), ctx);
    }
    const { data, error } = await deps.session
      .from("task_relations")
      .delete()
      .eq("id", found.row.id)
      .select("id");
    if (error) {
      const mapped = mapRelationWriteError(error);
      return mapped ? fail(mapped, ctx) : internal(ctx, "delete", error);
    }
    // Không dòng nào: quan hệ vừa bị xóa hoặc quyền vừa đổi giữa lúc đọc và ghi.
    if (!data || data.length === 0) return fail(apiError("not_found"), ctx);
    return new Response(null, {
      status: 204,
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    return internal(ctx, "delete", error);
  }
}
