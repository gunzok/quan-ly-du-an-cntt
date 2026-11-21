import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ApiError } from "@/lib/api/errors";
import { isSameOrigin, isUuid, readJsonBody } from "@/lib/api/request";
import { apiError, errorResponse, jsonResponse } from "@/lib/api/respond";
import {
  limitUser,
  logRateLimitUnavailable,
  rateLimitedResponse,
  type RateLimitOutcome,
} from "@/lib/api/rate-limit";
import { calcProgressPercent } from "@/lib/progress";
import { mapCreateFromTemplateError } from "@/lib/project-templates/policy";
import { strings } from "@/lib/strings";
import { todayIso } from "./format";
import {
  PROJECT_COLUMNS,
  type Project,
  type ProjectListResponse,
  type ProjectRole,
  type ProjectRow,
  type ProjectStatsRow,
  type ProjectStatus,
} from "./model";
import {
  canCreateProject,
  canDeleteProject,
  canEditProject,
  mapProjectWriteError,
  projectDateOrderError,
  type ProjectActor,
} from "./policy";
import {
  PROJECT_BODY_MAX_BYTES,
  encodeProjectCursor,
  isDateOrderValid,
  namePattern,
  validateProjectCreate,
  validateProjectListQuery,
  validateProjectPatch,
} from "./validate";

/**
 * Lõi của /api/v1/projects và /api/v1/projects/{id}. Route Handler chỉ tạo client phiên rồi gọi
 * các hàm này; test tích hợp gọi thẳng với client tự tạo.
 *
 * Mọi truy vấn chạy bằng client PHIÊN của người gọi (khóa anon, RLS áp dụng), không dùng
 * service_role. Thứ tự kiểm giống API task (lib/tasks/handlers.ts):
 *   1. (POST/PATCH/DELETE) Origin trùng ứng dụng, chống CSRF: 403 (proxy đã chặn, kiểm lại ở đây).
 *   2. Phiên: getUser() hỏi Supabase Auth; không có: 401.
 *   3. Dự án người gọi không được thấy (không thuộc dự án, bị khóa, id sai): 404 (BR-10).
 *   4. Quyền: tạo (Admin, PM ở ít nhất một dự án), sửa/lưu trữ (Admin, PM của dự án), xóa (Admin): 403.
 *   5. Schema đầu vào, từ chối trường lạ: 400; ngày kết thúc trước ngày bắt đầu: 422.
 */
export interface ProjectDeps {
  /** Client theo phiên cookie của người gọi (khóa anon, RLS áp dụng). */
  session: SupabaseClient;
  requestId?: string;
  /** Ngày "hôm nay" YYYY-MM-DD để tính trễ hạn; mặc định theo giờ Việt Nam (test truyền cố định). */
  today?: string;
  /** Giới hạn tần suất khi tạo TỪ TEMPLATE (E7-1); test truyền bản giả. */
  rateLimit?: (userId: string) => Promise<RateLimitOutcome>;
}

interface Ctx {
  requestId: string;
  today: string;
}

type Step<T> = { ok: true; value: T } | { ok: false; response: Response };

function fail(error: ApiError, ctx: Ctx): Response {
  return errorResponse(error, ctx.requestId);
}

/** Ghi log lỗi hệ thống: chỉ mã, thông điệp ngắn và request_id; không ghi dữ liệu dự án. */
function internal(ctx: Ctx, where: string, error: unknown): Response {
  const e = error as { code?: unknown; message?: unknown };
  console.error(
    `[api/v1/projects] ${where} request_id=${ctx.requestId} code=${String(e?.code ?? "")} message=${String(e?.message ?? error).slice(0, 200)}`,
  );
  return fail(apiError("internal_error"), ctx);
}

function newCtx(deps: ProjectDeps): Ctx {
  return {
    requestId: deps.requestId ?? randomUUID(),
    today: deps.today ?? todayIso(),
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

/** Admin đang hoạt động? Người bị khóa không đọc được hồ sơ của mình (RLS) nên ra false. */
async function isActiveAdmin(
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

/** Gắn số liệu (public.project_stats, qua RLS) vào các dòng dự án, giữ nguyên thứ tự. */
async function withStats(
  session: SupabaseClient,
  rows: ProjectRow[],
  ctx: Ctx,
): Promise<Project[]> {
  if (rows.length === 0) return [];
  const { data, error } = await session.rpc("project_stats", {
    p_project_ids: rows.map((r) => r.id),
    p_today: ctx.today,
  });
  if (error) throw error;
  const stats = new Map(
    ((data ?? []) as ProjectStatsRow[]).map((s) => [s.project_id, s]),
  );
  return rows.map((row) => {
    const s = stats.get(row.id);
    const total = s?.task_count ?? 0;
    const done = Math.min(s?.done_task_count ?? 0, total);
    return {
      ...row,
      my_role: s?.my_role ?? null,
      member_count: s?.member_count ?? 0,
      task_count: total,
      done_task_count: done,
      overdue_task_count: s?.overdue_task_count ?? 0,
      progress: calcProgressPercent(done, total),
      members_preview: s?.members_preview ?? [],
    };
  });
}

/** Dự án theo id qua RLS; null nếu không tồn tại hoặc người gọi không được thấy. */
async function loadProject(
  session: SupabaseClient,
  id: string,
): Promise<ProjectRow | null> {
  const { data, error } = await session
    .from("projects")
    .select(PROJECT_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return (data as ProjectRow | null) ?? null;
}

/** Bước 1-3 chung cho /projects/{id}: Origin (nếu ghi), phiên, dự án thấy được, vai trò. */
async function projectContext(
  request: Request,
  rawId: string,
  deps: ProjectDeps,
  ctx: Ctx,
  write: boolean,
): Promise<Step<{ project: ProjectRow; actor: ProjectActor }>> {
  if (write && !isSameOrigin(request)) {
    return { ok: false, response: fail(apiError("forbidden"), ctx) };
  }
  const user = await requireUser(deps.session, ctx);
  if (!user.ok) return user;
  if (!isUuid(rawId)) {
    return { ok: false, response: fail(apiError("not_found"), ctx) };
  }
  const id = rawId.toLowerCase();
  const [project, member, isAdmin] = await Promise.all([
    loadProject(deps.session, id),
    deps.session
      .from("project_members")
      .select("role")
      .eq("project_id", id)
      .eq("user_id", user.value)
      .maybeSingle(),
    isActiveAdmin(deps.session, user.value),
  ]);
  if (member.error) throw member.error;
  if (!project) {
    return { ok: false, response: fail(apiError("not_found"), ctx) };
  }
  return {
    ok: true,
    value: {
      project,
      actor: {
        userId: user.value,
        isAdmin,
        role: (member.data?.role as ProjectRole | undefined) ?? null,
      },
    },
  };
}

// ---------------------------------------------------------------------------
// GET /api/v1/projects
// ---------------------------------------------------------------------------
export async function handleListProjects(
  request: Request,
  deps: ProjectDeps,
): Promise<Response> {
  const ctx = newCtx(deps);
  try {
    const user = await requireUser(deps.session, ctx);
    if (!user.ok) return user.response;

    const parsed = validateProjectListQuery(new URL(request.url).searchParams);
    if (!parsed.ok) {
      return fail(
        apiError("validation_failed", undefined, parsed.details),
        ctx,
      );
    }
    const { status, q, limit, cursor } = parsed.data;
    const pattern = q ? namePattern(q) : null;

    // RLS quyết định phạm vi: thành viên thấy dự án mình thuộc, Admin thấy tất cả (AC2, BR-10).
    let query = deps.session
      .from("projects")
      .select(PROJECT_COLUMNS)
      .eq("status", status);
    if (pattern) query = query.ilike("name", pattern);
    if (cursor) {
      // Giá trị con trỏ đã kiểm chặt định dạng (dấu thời gian ISO, uuid) nên ghép vào bộ lọc an toàn.
      query = query.or(
        `created_at.lt."${cursor.created_at}",and(created_at.eq."${cursor.created_at}",id.lt.${cursor.id})`,
      );
    }
    const count = (s: ProjectStatus) => {
      let c = deps.session
        .from("projects")
        .select("id", { count: "exact", head: true })
        .eq("status", s);
      if (pattern) c = c.ilike("name", pattern);
      return c;
    };

    const [page, active, archived] = await Promise.all([
      query
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(limit + 1),
      count("active"),
      count("archived"),
    ]);
    for (const r of [page, active, archived]) {
      if (r.error) throw r.error;
    }

    const rows = (page.data ?? []) as ProjectRow[];
    const items = await withStats(deps.session, rows.slice(0, limit), ctx);
    const last = items[items.length - 1];
    const body: ProjectListResponse = {
      data: items,
      next_cursor:
        rows.length > limit && last
          ? encodeProjectCursor({ created_at: last.created_at, id: last.id })
          : null,
      counts: { active: active.count ?? 0, archived: archived.count ?? 0 },
    };
    return jsonResponse(body);
  } catch (error) {
    return internal(ctx, "list", error);
  }
}

// ---------------------------------------------------------------------------
// POST /api/v1/projects: người tạo thành PM của dự án (trigger add_creator_as_pm, AC1).
// ---------------------------------------------------------------------------
export async function handleCreateProject(
  request: Request,
  deps: ProjectDeps,
): Promise<Response> {
  const ctx = newCtx(deps);
  if (!isSameOrigin(request)) return fail(apiError("forbidden"), ctx);
  try {
    const user = await requireUser(deps.session, ctx);
    if (!user.ok) return user.response;

    const [isAdmin, pm] = await Promise.all([
      isActiveAdmin(deps.session, user.value),
      deps.session
        .from("project_members")
        .select("project_id")
        .eq("user_id", user.value)
        .eq("role", "pm")
        .limit(1),
    ]);
    if (pm.error) throw pm.error;
    if (
      !canCreateProject({ isAdmin, isPmAnywhere: (pm.data ?? []).length > 0 })
    ) {
      return fail(
        apiError("forbidden", strings.projects.errors.forbiddenCreate),
        ctx,
      );
    }

    const read = await readJsonBody(request, PROJECT_BODY_MAX_BYTES);
    if (!read.ok) return fail(read.error, ctx);
    const parsed = validateProjectCreate(read.body);
    if (!parsed.ok) {
      return fail(
        apiError("validation_failed", undefined, parsed.details),
        ctx,
      );
    }
    const input = parsed.data;
    if (!isDateOrderValid(input.start_date, input.end_date)) {
      return fail(projectDateOrderError(), ctx);
    }

    if (input.template_id) {
      // Nhân bản tới 2.000 task trong một giao dịch: giới hạn tần suất riêng (như xuất báo cáo).
      const limit = await (
        deps.rateLimit ?? ((id) => limitUser(id, "projectTemplate"))
      )(user.value);
      if (!limit.ok) {
        if (limit.reason === "limited") {
          return rateLimitedResponse(limit.retryAfterSeconds, ctx.requestId);
        }
        logRateLimitUnavailable("projectTemplate", limit.detail, ctx.requestId);
      }
    }

    // INSERT ... RETURNING bị chính sách SELECT chặn với PM không phải Admin (database.md mục 5):
    // dùng public.create_project() (SECURITY INVOKER, RLS và quyền cột vẫn áp dụng). Có template:
    // public.create_project_from_template (SECURITY DEFINER, tự kiểm quyền tạo dự án như
    // projects_insert, nhân bản trạng thái, loại, nhãn, cây task trong cùng giao dịch; E7-1).
    const { data, error } = input.template_id
      ? await deps.session
          .rpc("create_project_from_template", {
            p_template_id: input.template_id,
            p_name: input.name,
            p_description: input.description,
            p_start_date: input.start_date,
            p_end_date: input.end_date,
          })
          .single()
      : await deps.session
          .rpc("create_project", {
            p_name: input.name,
            p_description: input.description,
            p_start_date: input.start_date,
            p_end_date: input.end_date,
          })
          .single();
    if (error) {
      const mapped =
        mapCreateFromTemplateError(error) ?? mapProjectWriteError(error);
      return mapped ? fail(mapped, ctx) : internal(ctx, "create", error);
    }
    const row = data as ProjectRow | null;
    if (!row?.id) return internal(ctx, "create", new Error("empty_row"));
    const reloaded = await loadProject(deps.session, row.id);
    if (!reloaded) return internal(ctx, "create", new Error("not_visible"));
    const [project] = await withStats(deps.session, [reloaded], ctx);
    return jsonResponse({ data: project }, 201, {
      location: `/api/v1/projects/${project.id}`,
    });
  } catch (error) {
    return internal(ctx, "create", error);
  }
}

// ---------------------------------------------------------------------------
// GET /api/v1/projects/{id}
// ---------------------------------------------------------------------------
export async function handleGetProject(
  request: Request,
  rawId: string,
  deps: ProjectDeps,
): Promise<Response> {
  const ctx = newCtx(deps);
  try {
    const c = await projectContext(request, rawId, deps, ctx, false);
    if (!c.ok) return c.response;
    const [project] = await withStats(deps.session, [c.value.project], ctx);
    return jsonResponse({ data: project });
  } catch (error) {
    return internal(ctx, "get", error);
  }
}

// ---------------------------------------------------------------------------
// PATCH /api/v1/projects/{id}: sửa tên, mô tả, ngày; lưu trữ/khôi phục bằng `status`.
// ---------------------------------------------------------------------------
export async function handlePatchProject(
  request: Request,
  rawId: string,
  deps: ProjectDeps,
): Promise<Response> {
  const ctx = newCtx(deps);
  try {
    const c = await projectContext(request, rawId, deps, ctx, true);
    if (!c.ok) return c.response;
    const { project, actor } = c.value;
    if (!canEditProject(actor)) {
      return fail(
        apiError("forbidden", strings.projects.errors.forbiddenEdit),
        ctx,
      );
    }

    const read = await readJsonBody(request, PROJECT_BODY_MAX_BYTES);
    if (!read.ok) return fail(read.error, ctx);
    const parsed = validateProjectPatch(read.body);
    if (!parsed.ok) {
      return fail(
        apiError("validation_failed", undefined, parsed.details),
        ctx,
      );
    }
    const patch = parsed.data;
    const start =
      patch.start_date !== undefined ? patch.start_date : project.start_date;
    const end =
      patch.end_date !== undefined ? patch.end_date : project.end_date;
    if (!isDateOrderValid(start, end)) {
      return fail(projectDateOrderError(), ctx);
    }

    const { data, error } = await deps.session
      .from("projects")
      .update(patch)
      .eq("id", project.id)
      .select(PROJECT_COLUMNS)
      .maybeSingle();
    if (error) {
      const mapped = mapProjectWriteError(error);
      return mapped ? fail(mapped, ctx) : internal(ctx, "update", error);
    }
    // Không dòng nào: dự án vừa bị xóa hoặc quyền vừa đổi giữa lúc đọc và ghi.
    if (!data) return fail(apiError("not_found"), ctx);
    const [updated] = await withStats(deps.session, [data as ProjectRow], ctx);
    return jsonResponse({ data: updated });
  } catch (error) {
    return internal(ctx, "update", error);
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/v1/projects/{id}: xóa vĩnh viễn (BR-11), chỉ Admin. Task và thành viên xóa theo
// (ON DELETE CASCADE). Hộp thoại xác nhận là việc của giao diện.
// ---------------------------------------------------------------------------
export async function handleDeleteProject(
  request: Request,
  rawId: string,
  deps: ProjectDeps,
): Promise<Response> {
  const ctx = newCtx(deps);
  try {
    const c = await projectContext(request, rawId, deps, ctx, true);
    if (!c.ok) return c.response;
    const { project, actor } = c.value;
    if (!canDeleteProject(actor)) {
      return fail(
        apiError("forbidden", strings.projects.errors.forbiddenDelete),
        ctx,
      );
    }
    const { data, error } = await deps.session
      .from("projects")
      .delete()
      .eq("id", project.id)
      .select("id");
    if (error) {
      const mapped = mapProjectWriteError(error);
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
