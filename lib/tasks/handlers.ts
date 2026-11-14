import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ApiError } from "@/lib/api/errors";
import { isSameOrigin, isUuid, readJsonBody } from "@/lib/api/request";
import { apiError, errorResponse, jsonResponse } from "@/lib/api/respond";
import { strings } from "@/lib/strings";
import { TASK_COLUMNS, type Task, type TaskListResponse } from "./model";
import {
  canCreateTask,
  canDeleteTask,
  canEditTask,
  dateOrderError,
  mapTaskWriteError,
  type Actor,
  type ProjectRole,
} from "./policy";
import {
  TASK_BODY_MAX_BYTES,
  encodeTaskCursor,
  isDateOrderValid,
  validateTaskCreate,
  validateTaskListQuery,
  validateTaskPatch,
} from "./validate";

/**
 * Lõi của /api/v1/projects/{id}/tasks và /api/v1/tasks/{id}. Route Handler chỉ tạo client phiên
 * rồi gọi các hàm này; test tích hợp gọi thẳng với client tự tạo.
 *
 * Mọi truy vấn chạy bằng client PHIÊN của người gọi (khóa anon, RLS áp dụng), không dùng
 * service_role: RLS là lớp kiểm thứ hai và quyết định cuối cùng.
 *
 * Thứ tự kiểm (security.md F1, F2; giống API quản trị người dùng):
 *   1. (POST/PATCH/DELETE) Origin trùng ứng dụng, chống CSRF: 403.
 *   2. Phiên: getUser() hỏi Supabase Auth; không có: 401.
 *   3. Tài nguyên người gọi không được thấy (không thuộc dự án, bị khóa, id sai): 404, không 403
 *      để không lộ sự tồn tại (BR-10).
 *   4. Quyền theo vai trò trong dự án (BR-02, BR-03): 403.
 *   5. Schema đầu vào, từ chối trường lạ: 400; quy tắc nghiệp vụ (BR-13, người được giao): 422.
 */
export interface TaskDeps {
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

/** Ghi log lỗi hệ thống: chỉ mã, thông điệp ngắn và request_id; không ghi dữ liệu task. */
function internal(ctx: Ctx, where: string, error: unknown): Response {
  const e = error as { code?: unknown; message?: unknown };
  console.error(
    `[api/v1/tasks] ${where} request_id=${ctx.requestId} code=${String(e?.code ?? "")} message=${String(e?.message ?? error).slice(0, 200)}`,
  );
  return fail(apiError("internal_error"), ctx);
}

function newCtx(deps: TaskDeps): Ctx {
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

/**
 * Quyền của người gọi trong một dự án, đọc qua RLS bằng phiên của họ. null = dự án không thấy được
 * (không tồn tại, không thuộc dự án, hoặc bị khóa): nơi gọi trả 404.
 */
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

/** Task theo id qua RLS; null nếu không tồn tại hoặc người gọi không được thấy. */
async function loadTask(
  session: SupabaseClient,
  id: string,
): Promise<Task | null> {
  const { data, error } = await session
    .from("tasks")
    .select(TASK_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return (data as Task | null) ?? null;
}

/** Bước 1-3 chung cho /tasks/{id}: Origin (nếu ghi), phiên, task thấy được, quyền trong dự án. */
async function taskContext(
  request: Request,
  rawId: string,
  deps: TaskDeps,
  ctx: Ctx,
  write: boolean,
): Promise<Step<{ task: Task; actor: Actor }>> {
  if (write && !isSameOrigin(request)) {
    return { ok: false, response: fail(apiError("forbidden"), ctx) };
  }
  const user = await requireUser(deps.session, ctx);
  if (!user.ok) return user;
  if (!isUuid(rawId)) {
    return { ok: false, response: fail(apiError("not_found"), ctx) };
  }
  const task = await loadTask(deps.session, rawId.toLowerCase());
  if (!task) {
    return { ok: false, response: fail(apiError("not_found"), ctx) };
  }
  const actor = await loadActor(deps.session, user.value, task.project_id);
  if (!actor) {
    return { ok: false, response: fail(apiError("not_found"), ctx) };
  }
  return { ok: true, value: { task, actor } };
}

// ---------------------------------------------------------------------------
// GET /api/v1/projects/{id}/tasks
// ---------------------------------------------------------------------------
export async function handleListTasks(
  request: Request,
  rawProjectId: string,
  deps: TaskDeps,
): Promise<Response> {
  const ctx = newCtx(deps);
  try {
    const user = await requireUser(deps.session, ctx);
    if (!user.ok) return user.response;
    if (!isUuid(rawProjectId)) return fail(apiError("not_found"), ctx);
    const projectId = rawProjectId.toLowerCase();
    const actor = await loadActor(deps.session, user.value, projectId);
    if (!actor) return fail(apiError("not_found"), ctx);

    const parsed = validateTaskListQuery(new URL(request.url).searchParams);
    if (!parsed.ok) {
      return fail(
        apiError("validation_failed", undefined, parsed.details),
        ctx,
      );
    }
    const { limit, cursor, assignee_id, status_id, priority } = parsed.data;

    let query = deps.session
      .from("tasks")
      .select(TASK_COLUMNS)
      .eq("project_id", projectId);
    if (assignee_id) query = query.eq("assignee_id", assignee_id);
    if (status_id) query = query.eq("status_id", status_id);
    if (priority) query = query.eq("priority", priority);
    if (cursor) {
      // Giá trị con trỏ đã kiểm chặt định dạng (dấu thời gian ISO, uuid) nên ghép vào bộ lọc an toàn.
      query = query.or(
        `created_at.lt."${cursor.created_at}",and(created_at.eq."${cursor.created_at}",id.lt.${cursor.id})`,
      );
    }
    const { data, error } = await query
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(limit + 1);
    if (error) throw error;

    const rows = (data ?? []) as Task[];
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    const body: TaskListResponse = {
      data: page,
      next_cursor:
        rows.length > limit && last
          ? encodeTaskCursor({ created_at: last.created_at, id: last.id })
          : null,
    };
    return jsonResponse(body);
  } catch (error) {
    return internal(ctx, "list", error);
  }
}

// ---------------------------------------------------------------------------
// POST /api/v1/projects/{id}/tasks
// ---------------------------------------------------------------------------
export async function handleCreateTask(
  request: Request,
  rawProjectId: string,
  deps: TaskDeps,
): Promise<Response> {
  const ctx = newCtx(deps);
  if (!isSameOrigin(request)) return fail(apiError("forbidden"), ctx);
  try {
    const user = await requireUser(deps.session, ctx);
    if (!user.ok) return user.response;
    if (!isUuid(rawProjectId)) return fail(apiError("not_found"), ctx);
    const projectId = rawProjectId.toLowerCase();
    const actor = await loadActor(deps.session, user.value, projectId);
    if (!actor) return fail(apiError("not_found"), ctx);
    if (!canCreateTask(actor)) {
      return fail(
        apiError("forbidden", strings.tasks.errors.forbiddenCreate),
        ctx,
      );
    }

    const read = await readJsonBody(request, TASK_BODY_MAX_BYTES);
    if (!read.ok) return fail(read.error, ctx);
    const parsed = validateTaskCreate(read.body);
    if (!parsed.ok) {
      return fail(
        apiError("validation_failed", undefined, parsed.details),
        ctx,
      );
    }
    const input = parsed.data;
    if (!isDateOrderValid(input.start_date, input.due_date)) {
      return fail(dateOrderError(), ctx);
    }

    // created_by không gửi: cột lấy mặc định auth.uid() và trình duyệt không có quyền cột này.
    const { data, error } = await deps.session
      .from("tasks")
      .insert({ ...input, project_id: projectId })
      .select(TASK_COLUMNS)
      .single();
    if (error) {
      const mapped = mapTaskWriteError(error);
      return mapped ? fail(mapped, ctx) : internal(ctx, "create", error);
    }
    const task = data as Task;
    return jsonResponse({ data: task }, 201, {
      location: `/api/v1/tasks/${task.id}`,
    });
  } catch (error) {
    return internal(ctx, "create", error);
  }
}

// ---------------------------------------------------------------------------
// GET /api/v1/tasks/{id}
// ---------------------------------------------------------------------------
export async function handleGetTask(
  request: Request,
  rawId: string,
  deps: TaskDeps,
): Promise<Response> {
  const ctx = newCtx(deps);
  try {
    const c = await taskContext(request, rawId, deps, ctx, false);
    if (!c.ok) return c.response;
    return jsonResponse({ data: c.value.task });
  } catch (error) {
    return internal(ctx, "get", error);
  }
}

// ---------------------------------------------------------------------------
// PATCH /api/v1/tasks/{id}
// ---------------------------------------------------------------------------
export async function handlePatchTask(
  request: Request,
  rawId: string,
  deps: TaskDeps,
): Promise<Response> {
  const ctx = newCtx(deps);
  try {
    const c = await taskContext(request, rawId, deps, ctx, true);
    if (!c.ok) return c.response;
    const { task, actor } = c.value;
    if (!canEditTask(actor, task)) {
      return fail(
        apiError("forbidden", strings.tasks.errors.forbiddenEdit),
        ctx,
      );
    }

    const read = await readJsonBody(request, TASK_BODY_MAX_BYTES);
    if (!read.ok) return fail(read.error, ctx);
    const parsed = validateTaskPatch(read.body);
    if (!parsed.ok) {
      return fail(
        apiError("validation_failed", undefined, parsed.details),
        ctx,
      );
    }
    const patch = parsed.data;

    // Sau khi sửa người gọi vẫn phải còn quyền (RLS WITH CHECK): Thành viên chỉ phụ trách, không
    // tạo task, thì không giao task đi cho người khác.
    const after = {
      created_by: task.created_by,
      assignee_id:
        patch.assignee_id !== undefined ? patch.assignee_id : task.assignee_id,
    };
    if (!canEditTask(actor, after)) {
      return fail(
        apiError("forbidden", strings.tasks.errors.forbiddenEdit),
        ctx,
      );
    }

    const start =
      patch.start_date !== undefined ? patch.start_date : task.start_date;
    const due = patch.due_date !== undefined ? patch.due_date : task.due_date;
    if (!isDateOrderValid(start, due)) {
      return fail(dateOrderError(), ctx);
    }

    const { data, error } = await deps.session
      .from("tasks")
      .update(patch)
      .eq("id", task.id)
      .select(TASK_COLUMNS)
      .maybeSingle();
    if (error) {
      const mapped = mapTaskWriteError(error);
      return mapped ? fail(mapped, ctx) : internal(ctx, "update", error);
    }
    // Không dòng nào: task vừa bị xóa hoặc quyền vừa đổi giữa lúc đọc và ghi.
    if (!data) return fail(apiError("not_found"), ctx);
    return jsonResponse({ data: data as Task });
  } catch (error) {
    return internal(ctx, "update", error);
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/v1/tasks/{id}: xóa vĩnh viễn (BR-11). Hộp thoại xác nhận là việc của giao diện.
// ---------------------------------------------------------------------------
export async function handleDeleteTask(
  request: Request,
  rawId: string,
  deps: TaskDeps,
): Promise<Response> {
  const ctx = newCtx(deps);
  try {
    const c = await taskContext(request, rawId, deps, ctx, true);
    if (!c.ok) return c.response;
    const { task, actor } = c.value;
    if (!canDeleteTask(actor, task)) {
      return fail(
        apiError("forbidden", strings.tasks.errors.forbiddenDelete),
        ctx,
      );
    }
    const { data, error } = await deps.session
      .from("tasks")
      .delete()
      .eq("id", task.id)
      .select("id");
    if (error) {
      const mapped = mapTaskWriteError(error);
      return mapped ? fail(mapped, ctx) : internal(ctx, "delete", error);
    }
    if (!data || data.length === 0) return fail(apiError("not_found"), ctx);
    return new Response(null, {
      status: 204,
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    return internal(ctx, "delete", error);
  }
}
