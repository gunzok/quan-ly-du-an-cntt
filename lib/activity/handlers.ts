import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ApiError } from "@/lib/api/errors";
import { isUuid } from "@/lib/api/request";
import { apiError, errorResponse, jsonResponse } from "@/lib/api/respond";
import { strings } from "@/lib/strings";
import {
  ACTIVITY_SELECT,
  collectRefIds,
  sanitizeRow,
  toEntry,
  type ActivityListResponse,
  type ActivityRow,
  type RefNames,
  type SanitizedRow,
} from "./model";
import { vnDateRangeToUtc } from "./time";
import {
  encodeActivityCursor,
  validateProjectActivityQuery,
  validateTaskActivityQuery,
  type ActivityQuery,
} from "./validate";

/**
 * Lõi của GET /api/v1/projects/{id}/activity và GET /api/v1/tasks/{id}/activity (Story E6-2,
 * FR-16, UC-12). Route Handler chỉ tạo client phiên rồi gọi các hàm này; test tích hợp gọi thẳng.
 *
 * Client PHIÊN của người gọi (khóa anon, RLS áp dụng), không service_role. RLS của activity_logs
 * (E6-1) chỉ cho PM của dự án và Admin đọc: đó là lớp quyết định cuối; kiểm vai trò ở đây để trả
 * 403 rõ ràng thay vì danh sách rỗng. Thứ tự kiểm (api-contract.md, security.md):
 *   1. Phiên: getUser(); không có: 401. (GET nên không kiểm Origin.)
 *   2. Dự án/task người gọi không thấy (người ngoài, bị khóa, id sai, task đã xóa): 404 (BR-10).
 *   3. Vai trò: Thành viên, Người xem của dự án: 403.
 *   4. Query string sai, tham số lạ: 400.
 * Tên trạng thái, loại, người, task được tra bằng dữ liệu hiện có (RLS) và chỉ trong dự án này;
 * thứ gì không còn thì để null (xem lib/activity/model.ts).
 */
export interface ActivityDeps {
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

/** Ghi log lỗi hệ thống: chỉ mã, thông điệp ngắn và request_id; không ghi nội dung nhật ký. */
function internal(ctx: Ctx, where: string, error: unknown): Response {
  const e = error as { code?: unknown; message?: unknown };
  console.error(
    `[api/v1/activity] ${where} request_id=${ctx.requestId} code=${String(e?.code ?? "")} message=${String(e?.message ?? error).slice(0, 200)}`,
  );
  return fail(apiError("internal_error"), ctx);
}

interface Access {
  projectId: string;
  projectName: string | null;
  isAdmin: boolean;
}

/**
 * Bước 1-3 cho một dự án đã biết id: phiên, dự án thấy được, vai trò PM/Admin.
 * `userId` đã kiểm ở nơi gọi.
 */
async function requireProjectAccess(
  session: SupabaseClient,
  userId: string,
  projectId: string,
  ctx: Ctx,
): Promise<Step<Access>> {
  const [project, member, profile] = await Promise.all([
    session
      .from("projects")
      .select("id, name")
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
      .select("is_admin, is_active")
      .eq("id", userId)
      .maybeSingle(),
  ]);
  for (const r of [project, member, profile]) {
    if (r.error) throw r.error;
  }
  if (!project.data) {
    return { ok: false, response: fail(apiError("not_found"), ctx) };
  }
  const isAdmin =
    profile.data?.is_admin === true && profile.data?.is_active === true;
  if (!isAdmin && member.data?.role !== "pm") {
    return {
      ok: false,
      response: fail(
        apiError("forbidden", strings.activity.errors.forbidden),
        ctx,
      ),
    };
  }
  return {
    ok: true,
    value: {
      projectId,
      projectName: (project.data.name as string | null) ?? null,
      isAdmin,
    },
  };
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

/** Tra tên cho các id xuất hiện trong trang, chỉ trong dự án `projectId`. */
async function loadNames(
  session: SupabaseClient,
  access: Access,
  rows: readonly SanitizedRow[],
): Promise<RefNames> {
  const ids = collectRefIds(rows);
  const people = [...ids.people];
  const statuses = [...ids.statuses];
  const types = [...ids.types];
  const tasks = [...ids.tasks];
  const none = Promise.resolve({ data: [], error: null });

  const [profiles, members, statusRows, typeRows, taskRows] = await Promise.all(
    [
      people.length
        ? session
            .from("profiles")
            .select("id, full_name, email")
            .in("id", people)
        : none,
      people.length && !access.isAdmin
        ? session
            .from("project_members")
            .select("user_id")
            .eq("project_id", access.projectId)
            .in("user_id", people)
        : none,
      statuses.length
        ? session
            .from("task_statuses")
            .select("id, name")
            .eq("project_id", access.projectId)
            .in("id", statuses)
        : none,
      types.length
        ? session
            .from("task_types")
            .select("id, name")
            .eq("project_id", access.projectId)
            .in("id", types)
        : none,
      tasks.length
        ? session
            .from("tasks")
            .select("id, title")
            .eq("project_id", access.projectId)
            .in("id", tasks)
        : none,
    ],
  );
  for (const r of [profiles, members, statusRows, typeRows, taskRows]) {
    if (r.error) throw r.error;
  }

  // Email chỉ khi người gọi được thấy: Admin, hoặc người đang là thành viên của dự án này.
  const memberIds = new Set(
    ((members.data ?? []) as { user_id: string }[]).map((m) => m.user_id),
  );
  const names: RefNames = {
    people: new Map(),
    statuses: new Map(),
    types: new Map(),
    tasks: new Map(),
    projectName: access.projectName,
  };
  for (const p of (profiles.data ?? []) as {
    id: string;
    full_name: string | null;
    email: string | null;
  }[]) {
    names.people.set(p.id, {
      full_name: p.full_name,
      email: access.isAdmin || memberIds.has(p.id) ? p.email : null,
    });
  }
  for (const s of (statusRows.data ?? []) as { id: string; name: string }[]) {
    names.statuses.set(s.id, s.name);
  }
  for (const s of (typeRows.data ?? []) as { id: string; name: string }[]) {
    names.types.set(s.id, s.name);
  }
  for (const s of (taskRows.data ?? []) as { id: string; title: string }[]) {
    names.tasks.set(s.id, s.title);
  }

  // Task đã xóa: lấy tên lưu trong bản ghi xóa của chính nhật ký (giá trị đã lưu, không phải dữ
  // liệu đã mất). Đọc qua RLS nên chỉ trong dự án người gọi được xem nhật ký.
  const missing = tasks.filter((id) => !names.tasks.has(id));
  if (missing.length > 0) {
    const { data, error } = await session
      .from("activity_logs")
      .select("entity_id, title:changes->before->>title")
      .eq("project_id", access.projectId)
      .eq("entity_type", "task")
      .eq("action", "delete")
      .in("entity_id", missing);
    if (error) throw error;
    for (const r of (data ?? []) as unknown as {
      entity_id: string;
      title: string | null;
    }[]) {
      if (typeof r.title === "string" && r.title.trim() !== "") {
        names.tasks.set(r.entity_id, r.title);
      }
    }
  }
  return names;
}

/** Đọc một trang nhật ký theo bộ lọc, mới nhất trước, rồi ghép tên. */
async function listPage(
  session: SupabaseClient,
  access: Access,
  query: ActivityQuery,
  scope: { taskId?: string },
): Promise<ActivityListResponse> {
  let q = session
    .from("activity_logs")
    .select(ACTIVITY_SELECT)
    .eq("project_id", access.projectId);
  if (scope.taskId) {
    q = q.eq("entity_type", "task").eq("entity_id", scope.taskId);
  }
  if (query.entity_type) q = q.eq("entity_type", query.entity_type);
  if (query.action) q = q.eq("action", query.action);
  if (query.actor_id) q = q.eq("actor_id", query.actor_id);
  const range = vnDateRangeToUtc(query.from, query.to);
  if (range.gte) q = q.gte("created_at", range.gte);
  if (range.lt) q = q.lt("created_at", range.lt);
  if (query.cursor) {
    // Con trỏ đã kiểm chặt (dấu thời gian ISO, số nguyên dương) nên ghép vào bộ lọc an toàn.
    const { created_at, id } = query.cursor;
    q = q.or(
      `created_at.lt."${created_at}",and(created_at.eq."${created_at}",id.lt.${id})`,
    );
  }
  const { data, error } = await q
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(query.limit + 1);
  if (error) throw error;

  const raw = (data ?? []) as unknown as ActivityRow[];
  const pageRaw = raw.slice(0, query.limit);
  const last = pageRaw[pageRaw.length - 1];
  const rows = pageRaw
    .map(sanitizeRow)
    .filter((r): r is SanitizedRow => r !== null);
  const names = await loadNames(session, access, rows);
  return {
    data: rows.map((r) => toEntry(r, names)),
    next_cursor:
      raw.length > query.limit && last
        ? encodeActivityCursor({
            created_at: last.created_at,
            id: Number(last.id),
          })
        : null,
  };
}

/** GET /api/v1/projects/{id}/activity */
export async function handleGetProjectActivity(
  request: Request,
  rawProjectId: string,
  deps: ActivityDeps,
): Promise<Response> {
  const ctx: Ctx = { requestId: deps.requestId ?? randomUUID() };
  try {
    const user = await requireUser(deps.session, ctx);
    if (!user.ok) return user.response;
    if (!isUuid(rawProjectId)) return fail(apiError("not_found"), ctx);
    const access = await requireProjectAccess(
      deps.session,
      user.value,
      rawProjectId.toLowerCase(),
      ctx,
    );
    if (!access.ok) return access.response;

    const parsed = validateProjectActivityQuery(
      new URL(request.url).searchParams,
    );
    if (!parsed.ok) {
      return fail(
        apiError("validation_failed", undefined, parsed.details),
        ctx,
      );
    }
    return jsonResponse(
      await listPage(deps.session, access.value, parsed.data, {}),
    );
  } catch (error) {
    return internal(ctx, "project", error);
  }
}

/** GET /api/v1/tasks/{id}/activity */
export async function handleGetTaskActivity(
  request: Request,
  rawTaskId: string,
  deps: ActivityDeps,
): Promise<Response> {
  const ctx: Ctx = { requestId: deps.requestId ?? randomUUID() };
  try {
    const user = await requireUser(deps.session, ctx);
    if (!user.ok) return user.response;
    if (!isUuid(rawTaskId)) return fail(apiError("not_found"), ctx);
    const taskId = rawTaskId.toLowerCase();
    const { data: task, error } = await deps.session
      .from("tasks")
      .select("id, project_id")
      .eq("id", taskId)
      .maybeSingle();
    if (error) throw error;
    if (!task) return fail(apiError("not_found"), ctx);
    const access = await requireProjectAccess(
      deps.session,
      user.value,
      task.project_id as string,
      ctx,
    );
    if (!access.ok) return access.response;

    const parsed = validateTaskActivityQuery(new URL(request.url).searchParams);
    if (!parsed.ok) {
      return fail(
        apiError("validation_failed", undefined, parsed.details),
        ctx,
      );
    }
    return jsonResponse(
      await listPage(deps.session, access.value, parsed.data, { taskId }),
    );
  } catch (error) {
    return internal(ctx, "task", error);
  }
}
