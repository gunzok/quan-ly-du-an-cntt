import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ApiError } from "@/lib/api/errors";
import { apiError, errorResponse, jsonResponse } from "@/lib/api/respond";
import { requireAdmin } from "@/lib/admin/users/handlers";
import { isSameOrigin, isUuid, readJsonBody } from "@/lib/api/request";
import { DEPARTMENT_COLUMNS, toDepartment, type DepartmentRow } from "./model";
import {
  decideActiveUserGate,
  mapDepartmentWriteError,
  type ActiveUserGate,
} from "./policy";
import {
  DEPARTMENT_BODY_MAX_BYTES,
  POSITION_MAX,
  validateDepartmentCreate,
  validateDepartmentListQuery,
  validateDepartmentPatch,
} from "./validate";

/**
 * Lõi của /api/v1/departments và /api/v1/departments/{id}. Route Handler chỉ tạo client phiên
 * rồi gọi các hàm này; test tích hợp gọi thẳng với client tự tạo.
 *
 * Thứ tự kiểm giống /api/v1/users (security.md F1, F2):
 *   1. (POST/PATCH) Origin trùng ứng dụng, chống CSRF.
 *   2. Phiên: getUser(), rồi đọc hồ sơ của chính mình qua RLS. Đọc: người dùng đang hoạt động;
 *      ghi: Admin đang hoạt động. Chưa đăng nhập 401, không đủ quyền 403.
 *   3. Kiểm đầu vào bằng schema, từ chối trường lạ.
 *   4. Đọc/ghi bằng CHÍNH client phiên: RLS departments (Admin mới ghi được, chỉ xóa được phòng ban
 *      không còn ai) là lớp chặn thứ hai. Không cần service_role ở đây.
 */
export interface DepartmentDeps {
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

/** Ghi log lỗi hệ thống: chỉ mã, thông điệp ngắn và request_id; không ghi dữ liệu cá nhân. */
function internal(ctx: Ctx, where: string, error: unknown) {
  const e = error as { code?: unknown; message?: unknown };
  console.error(
    `[api/v1/departments] ${where} request_id=${ctx.requestId} code=${String(e?.code ?? "")} message=${String(e?.message ?? error).slice(0, 200)}`,
  );
  return fail(apiError("internal_error"), ctx);
}

/** Người gọi là người dùng đăng nhập đang hoạt động (đọc hồ sơ của chính mình qua RLS). */
export async function requireActiveUser(
  session: SupabaseClient,
): Promise<ActiveUserGate> {
  const { data: userData, error: userError } = await session.auth.getUser();
  const user = userError ? null : userData.user;
  if (!user) {
    return decideActiveUserGate(null, null);
  }
  const { data: profile, error } = await session
    .from("profiles")
    .select("is_active")
    .eq("id", user.id)
    .maybeSingle();
  if (error) throw error;
  return decideActiveUserGate(user, profile);
}

async function gate(
  check: () => Promise<
    { ok: true; userId: string } | { ok: false; error: ApiError }
  >,
  ctx: Ctx,
): Promise<{ ok: true } | { ok: false; response: Response }> {
  try {
    const result = await check();
    return result.ok
      ? { ok: true }
      : { ok: false, response: fail(result.error, ctx) };
  } catch (error) {
    return { ok: false, response: internal(ctx, "gate", error) };
  }
}

function writeFailure(ctx: Ctx, where: string, error: { code?: string }) {
  const mapped = mapDepartmentWriteError(error);
  return mapped ? fail(mapped, ctx) : internal(ctx, where, error);
}

// ---------------------------------------------------------------------------
// GET /api/v1/departments?include_archived=
// ---------------------------------------------------------------------------
export async function handleListDepartments(
  request: Request,
  deps: DepartmentDeps,
): Promise<Response> {
  const ctx = { requestId: deps.requestId ?? randomUUID() };
  const g = await gate(() => requireActiveUser(deps.session), ctx);
  if (!g.ok) return g.response;

  const parsed = validateDepartmentListQuery(new URL(request.url).searchParams);
  if (!parsed.ok) {
    return fail(apiError("validation_failed", undefined, parsed.details), ctx);
  }

  try {
    let query = deps.session.from("departments").select(DEPARTMENT_COLUMNS);
    if (!parsed.data.include_archived) {
      query = query.is("archived_at", null);
    }
    const { data, error } = await query
      .order("position")
      .order("name")
      .order("id");
    if (error) throw error;
    const rows = (data ?? []) as DepartmentRow[];
    return jsonResponse({ data: rows.map(toDepartment) });
  } catch (error) {
    return internal(ctx, "list", error);
  }
}

// ---------------------------------------------------------------------------
// POST /api/v1/departments { name, position? }
// ---------------------------------------------------------------------------
export async function handleCreateDepartment(
  request: Request,
  deps: DepartmentDeps,
): Promise<Response> {
  const ctx = { requestId: deps.requestId ?? randomUUID() };
  if (!isSameOrigin(request)) {
    return fail(apiError("forbidden"), ctx);
  }
  const g = await gate(() => requireAdmin(deps.session), ctx);
  if (!g.ok) return g.response;

  const read = await readJsonBody(request, DEPARTMENT_BODY_MAX_BYTES);
  if (!read.ok) return fail(read.error, ctx);
  const parsed = validateDepartmentCreate(read.body);
  if (!parsed.ok) {
    return fail(apiError("validation_failed", undefined, parsed.details), ctx);
  }
  const input = parsed.data;

  try {
    let position = input.position;
    if (position === undefined) {
      // Xếp cuối danh mục. Hai lần thêm cùng lúc có thể trùng position: vô hại (sắp tiếp theo tên).
      const { data: last, error } = await deps.session
        .from("departments")
        .select("position")
        .order("position", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      position = Math.min(
        ((last?.position as number | undefined) ?? 0) + 1,
        POSITION_MAX,
      );
    }

    const { data, error } = await deps.session
      .from("departments")
      .insert({ name: input.name, position })
      .select(DEPARTMENT_COLUMNS)
      .single();
    if (error) return writeFailure(ctx, "create", error);
    const row = data as DepartmentRow;
    return jsonResponse({ data: toDepartment(row) }, 201, {
      location: `/api/v1/departments/${row.id}`,
    });
  } catch (error) {
    return internal(ctx, "create", error);
  }
}

// ---------------------------------------------------------------------------
// PATCH /api/v1/departments/{id} { name?, position?, archived? }
// ---------------------------------------------------------------------------
export async function handlePatchDepartment(
  request: Request,
  departmentId: string,
  deps: DepartmentDeps,
): Promise<Response> {
  const ctx = { requestId: deps.requestId ?? randomUUID() };
  if (!isSameOrigin(request)) {
    return fail(apiError("forbidden"), ctx);
  }
  const g = await gate(() => requireAdmin(deps.session), ctx);
  if (!g.ok) return g.response;

  if (!isUuid(departmentId)) {
    return fail(apiError("not_found"), ctx);
  }
  const id = departmentId.toLowerCase();

  const read = await readJsonBody(request, DEPARTMENT_BODY_MAX_BYTES);
  if (!read.ok) return fail(read.error, ctx);
  const parsed = validateDepartmentPatch(read.body);
  if (!parsed.ok) {
    return fail(apiError("validation_failed", undefined, parsed.details), ctx);
  }
  const patch = parsed.data;

  try {
    const { data: current, error: readError } = await deps.session
      .from("departments")
      .select(DEPARTMENT_COLUMNS)
      .eq("id", id)
      .maybeSingle();
    if (readError) throw readError;
    if (!current) return fail(apiError("not_found"), ctx);
    const existing = current as DepartmentRow;

    const values: Record<string, unknown> = {};
    if (patch.name !== undefined) values.name = patch.name;
    if (patch.position !== undefined) values.position = patch.position;
    // Lưu trữ lại phòng ban đã lưu trữ thì giữ nguyên thời điểm cũ.
    if (patch.archived === true && existing.archived_at === null) {
      values.archived_at = new Date().toISOString();
    } else if (patch.archived === false && existing.archived_at !== null) {
      values.archived_at = null;
    }
    if (Object.keys(values).length === 0) {
      return jsonResponse({ data: toDepartment(existing) });
    }

    const { data, error } = await deps.session
      .from("departments")
      .update(values)
      .eq("id", id)
      .select(DEPARTMENT_COLUMNS)
      .maybeSingle();
    if (error) return writeFailure(ctx, "update", error);
    if (!data) return fail(apiError("not_found"), ctx);
    return jsonResponse({ data: toDepartment(data as DepartmentRow) });
  } catch (error) {
    return internal(ctx, "update", error);
  }
}
