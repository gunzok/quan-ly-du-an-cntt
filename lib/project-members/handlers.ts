import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ApiError } from "@/lib/api/errors";
import { isSameOrigin, isUuid, readJsonBody } from "@/lib/api/request";
import { apiError, errorResponse, jsonResponse } from "@/lib/api/respond";
import { strings } from "@/lib/strings";
import {
  MEMBER_SELECT,
  compareMembers,
  toProjectMember,
  toUserCandidate,
  type ProjectMember,
  type ProjectRole,
} from "./model";
import {
  canManageMembers,
  canSearchUsers,
  mapMemberWriteError,
  type MemberActor,
} from "./policy";
import {
  MEMBER_BODY_MAX_BYTES,
  validateMemberListQuery,
  validateMemberPut,
  validateMemberUserId,
  validateUserSearchQuery,
} from "./validate";

/**
 * Lõi của API thành viên dự án và tìm người (Story E1-6):
 *   GET          /api/v1/projects/{id}/members
 *   GET|PUT|DELETE /api/v1/projects/{id}/members/{user_id}
 *   GET          /api/v1/users/search?q=&exclude_project_id=&limit=
 * Route Handler chỉ tạo client phiên rồi gọi các hàm này; test tích hợp gọi thẳng.
 *
 * Mọi truy vấn chạy bằng client PHIÊN của người gọi (khóa anon, RLS áp dụng), không dùng
 * service_role. Thứ tự kiểm giống API cấu hình dự án (lib/project-config/handlers.ts):
 *   1. (PUT/DELETE) Origin trùng ứng dụng, chống CSRF: 403.
 *   2. Phiên: getUser(); không có: 401.
 *   3. Dự án người gọi không được thấy: 404 (BR-10).
 *   4. Vai trò: chỉ PM của dự án và Admin ghi: 403.
 *   5. Schema (từ chối trường lạ): 400; người đích không hoạt động: 422; PM cuối cùng: 409.
 */
export interface MemberDeps {
  /** Client theo phiên cookie của người gọi (khóa anon, RLS áp dụng). */
  session: SupabaseClient;
  requestId?: string;
}

interface Ctx {
  requestId: string;
}

type Step<T> = { ok: true; value: T } | { ok: false; response: Response };

const t = strings.projectMembers.errors;

function fail(error: ApiError, ctx: Ctx): Response {
  return errorResponse(error, ctx.requestId);
}

/** Ghi log lỗi hệ thống: chỉ mã, thông điệp ngắn và request_id. */
function internal(ctx: Ctx, where: string, error: unknown): Response {
  const e = error as { code?: unknown; message?: unknown };
  console.error(
    `[api/v1/project-members] ${where} request_id=${ctx.requestId} code=${String(e?.code ?? "")} message=${String(e?.message ?? error).slice(0, 200)}`,
  );
  return fail(apiError("internal_error"), ctx);
}

function newCtx(deps: MemberDeps): Ctx {
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
): Promise<MemberActor | null> {
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

/** Bước 1-4. `write`: kiểm Origin và quyền ghi. */
async function projectContext(
  request: Request,
  rawProjectId: string,
  write: boolean,
  deps: MemberDeps,
  ctx: Ctx,
): Promise<Step<{ projectId: string; actor: MemberActor }>> {
  if (write && !isSameOrigin(request)) {
    return { ok: false, response: fail(apiError("forbidden"), ctx) };
  }
  const user = await requireUser(deps.session, ctx);
  if (!user.ok) return user;
  if (!isUuid(rawProjectId)) {
    return { ok: false, response: fail(apiError("not_found"), ctx) };
  }
  const projectId = rawProjectId.toLowerCase();
  const actor = await loadActor(deps.session, user.value, projectId);
  if (!actor) return { ok: false, response: fail(apiError("not_found"), ctx) };
  if (write && !canManageMembers(actor)) {
    return {
      ok: false,
      response: fail(apiError("forbidden", t.forbidden), ctx),
    };
  }
  return { ok: true, value: { projectId, actor } };
}

async function readMember(
  session: SupabaseClient,
  projectId: string,
  userId: string,
): Promise<ProjectMember | null> {
  const { data, error } = await session
    .from("project_members")
    .select(MEMBER_SELECT)
    .eq("project_id", projectId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data ? toProjectMember(data) : null;
}

function writeFailure(
  ctx: Ctx,
  where: string,
  error: { code?: string; message?: string },
): Response {
  const mapped = mapMemberWriteError(error);
  return mapped ? fail(mapped, ctx) : internal(ctx, where, error);
}

// ---------------------------------------------------------------------------
// GET /api/v1/projects/{id}/members — mọi vai trò trong dự án và Admin
// ---------------------------------------------------------------------------
export async function handleListMembers(
  request: Request,
  rawProjectId: string,
  deps: MemberDeps,
): Promise<Response> {
  const ctx = newCtx(deps);
  try {
    const c = await projectContext(request, rawProjectId, false, deps, ctx);
    if (!c.ok) return c.response;
    const parsed = validateMemberListQuery(new URL(request.url).searchParams);
    if (!parsed.ok) {
      return fail(
        apiError("validation_failed", undefined, parsed.details),
        ctx,
      );
    }
    const { data, error } = await deps.session
      .from("project_members")
      .select(MEMBER_SELECT)
      .eq("project_id", c.value.projectId);
    if (error) throw error;
    const members = (data ?? []).map(toProjectMember).sort(compareMembers);
    return jsonResponse({ data: members });
  } catch (error) {
    return internal(ctx, "list members", error);
  }
}

// ---------------------------------------------------------------------------
// GET /api/v1/projects/{id}/members/{user_id} — một thành viên (đích của Location)
// ---------------------------------------------------------------------------
export async function handleGetMember(
  request: Request,
  rawProjectId: string,
  rawUserId: string,
  deps: MemberDeps,
): Promise<Response> {
  const ctx = newCtx(deps);
  try {
    const c = await projectContext(request, rawProjectId, false, deps, ctx);
    if (!c.ok) return c.response;
    const userId = validateMemberUserId(rawUserId);
    if (!userId.ok) return fail(apiError("not_found"), ctx);
    const member = await readMember(
      deps.session,
      c.value.projectId,
      userId.data,
    );
    if (!member) return fail(apiError("not_found"), ctx);
    return jsonResponse({ data: member });
  } catch (error) {
    return internal(ctx, "get member", error);
  }
}

// ---------------------------------------------------------------------------
// PUT /api/v1/projects/{id}/members/{user_id} {role} — thêm (201) hoặc đổi vai trò (200)
// ---------------------------------------------------------------------------
export async function handlePutMember(
  request: Request,
  rawProjectId: string,
  rawUserId: string,
  deps: MemberDeps,
): Promise<Response> {
  const ctx = newCtx(deps);
  try {
    const c = await projectContext(request, rawProjectId, true, deps, ctx);
    if (!c.ok) return c.response;
    const { projectId } = c.value;
    const userId = validateMemberUserId(rawUserId);
    if (!userId.ok) {
      return fail(
        apiError("validation_failed", undefined, userId.details),
        ctx,
      );
    }
    const read = await readJsonBody(request, MEMBER_BODY_MAX_BYTES);
    if (!read.ok) return fail(read.error, ctx);
    const parsed = validateMemberPut(read.body);
    if (!parsed.ok) {
      return fail(
        apiError("validation_failed", undefined, parsed.details),
        ctx,
      );
    }
    const { data, error } = await deps.session.rpc("set_project_member", {
      p_project_id: projectId,
      p_user_id: userId.data,
      p_role: parsed.data.role,
    });
    if (error) return writeFailure(ctx, "put member", error);
    const row = (Array.isArray(data) ? data[0] : data) as
      { created?: boolean } | undefined;
    if (!row) return internal(ctx, "put member", { message: "empty result" });
    const member = await readMember(deps.session, projectId, userId.data);
    if (!member) return fail(apiError("not_found"), ctx);
    return row.created
      ? jsonResponse({ data: member }, 201, {
          location: `/api/v1/projects/${projectId}/members/${userId.data}`,
        })
      : jsonResponse({ data: member });
  } catch (error) {
    return internal(ctx, "put member", error);
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/v1/projects/{id}/members/{user_id} — gỡ (204). Task giữ assignee_id cũ (E2-2).
// ---------------------------------------------------------------------------
export async function handleDeleteMember(
  request: Request,
  rawProjectId: string,
  rawUserId: string,
  deps: MemberDeps,
): Promise<Response> {
  const ctx = newCtx(deps);
  try {
    const c = await projectContext(request, rawProjectId, true, deps, ctx);
    if (!c.ok) return c.response;
    const userId = validateMemberUserId(rawUserId);
    if (!userId.ok) return fail(apiError("not_found"), ctx);
    const { data, error } = await deps.session
      .from("project_members")
      .delete()
      .eq("project_id", c.value.projectId)
      .eq("user_id", userId.data)
      .select("user_id");
    if (error) return writeFailure(ctx, "delete member", error);
    if (!data || data.length === 0) return fail(apiError("not_found"), ctx);
    return new Response(null, {
      status: 204,
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    return internal(ctx, "delete member", error);
  }
}

// ---------------------------------------------------------------------------
// GET /api/v1/users/search — Admin hoặc PM của ít nhất một dự án
// ---------------------------------------------------------------------------
export async function handleSearchUsers(
  request: Request,
  deps: MemberDeps,
): Promise<Response> {
  const ctx = newCtx(deps);
  try {
    const user = await requireUser(deps.session, ctx);
    if (!user.ok) return user.response;
    const [profile, pm] = await Promise.all([
      deps.session
        .from("profiles")
        .select("is_admin, is_active")
        .eq("id", user.value)
        .maybeSingle(),
      deps.session
        .from("project_members")
        .select("project_id")
        .eq("user_id", user.value)
        .eq("role", "pm")
        .limit(1),
    ]);
    if (profile.error) throw profile.error;
    if (pm.error) throw pm.error;
    const active = profile.data?.is_active === true;
    const allowed =
      active &&
      canSearchUsers({
        isAdmin: profile.data?.is_admin === true,
        isPmSomewhere: (pm.data ?? []).length > 0,
      });
    if (!allowed) return fail(apiError("forbidden", t.searchForbidden), ctx);
    const parsed = validateUserSearchQuery(new URL(request.url).searchParams);
    if (!parsed.ok) {
      return fail(
        apiError("validation_failed", undefined, parsed.details),
        ctx,
      );
    }
    const { data, error } = await deps.session.rpc(
      "search_users_for_membership",
      {
        p_q: parsed.data.q,
        p_exclude_project_id: parsed.data.exclude_project_id,
        p_limit: parsed.data.limit,
      },
    );
    if (error) {
      if (error.code === "42501") {
        return fail(apiError("forbidden", t.searchForbidden), ctx);
      }
      throw error;
    }
    return jsonResponse({
      data: ((data ?? []) as unknown[]).map(toUserCandidate),
    });
  } catch (error) {
    return internal(ctx, "search users", error);
  }
}
