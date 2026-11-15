import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isSameOrigin } from "@/lib/api/csrf";
import type { ApiError } from "@/lib/api/errors";
import { apiError, errorResponse, jsonResponse } from "@/lib/api/respond";
import { strings } from "@/lib/strings";
import {
  toAdminUser,
  userStatus,
  type AdminUserRow,
  type UserListResponse,
} from "./model";
import {
  banDurationFor,
  checkSelfAction,
  decideAdminGate,
  mapAdminUpdateError,
  type AdminGate,
} from "./policy";
import {
  BODY_MAX_BYTES,
  encodeCursor,
  isUuid,
  validateInvitation,
  validateListQuery,
  validateUserPatch,
} from "./validate";

/**
 * Lõi của /api/v1/users, /users/invitations, /users/{id}. Route Handler trong app/api/v1/users
 * chỉ tạo client rồi gọi các hàm này; test tích hợp gọi thẳng với client tự tạo.
 *
 * Thứ tự kiểm cho mọi endpoint (security.md F1, F2):
 *   1. (POST/PATCH) Origin trùng ứng dụng, chống CSRF (lib/api/csrf.ts; proxy.ts đã chặn trước,
 *      handler kiểm lại để phòng thủ chiều sâu và cho test gọi thẳng handler).
 *   2. Phiên người gọi: getUser() hỏi Supabase Auth, rồi đọc is_admin/is_active của chính họ
 *      qua RLS bằng client phiên (không phải service_role). Chưa đăng nhập 401, không phải Admin 403.
 *   3. Kiểm đầu vào bằng schema, từ chối trường lạ.
 *   4. Chỉ sau đó mới tạo client service_role (`service()` được gọi lười) để thao tác quản trị.
 */
export interface AdminDeps {
  /** Client theo phiên cookie của người gọi (khóa anon, RLS áp dụng). */
  session: SupabaseClient;
  /** Tạo client service_role; chỉ gọi sau khi đã xác minh Admin. */
  service: () => SupabaseClient;
  requestId?: string;
}

interface Ctx {
  requestId: string;
}

function fail(error: ApiError, ctx: Ctx) {
  return errorResponse(error, ctx.requestId);
}

/** Ghi log lỗi hệ thống: chỉ mã, thông điệp ngắn và request_id; không ghi khóa hay dữ liệu cá nhân. */
function logInternal(ctx: Ctx, where: string, error: unknown) {
  const e = error as { code?: unknown; status?: unknown; message?: unknown };
  console.error(
    `[api/v1/users] ${where} request_id=${ctx.requestId} code=${String(e?.code ?? "")} status=${String(e?.status ?? "")} message=${String(e?.message ?? error).slice(0, 200)}`,
  );
}

function internal(ctx: Ctx, where: string, error: unknown) {
  logInternal(ctx, where, error);
  return fail(apiError("internal_error"), ctx);
}

/** Bước 2: xác minh người gọi là Admin đang hoạt động bằng chính phiên của họ. */
export async function requireAdmin(
  session: SupabaseClient,
): Promise<AdminGate> {
  const { data: userData, error: userError } = await session.auth.getUser();
  const user = userError ? null : userData.user;
  if (!user) {
    return decideAdminGate(null, null);
  }
  const { data: profile, error } = await session
    .from("profiles")
    .select("is_admin, is_active")
    .eq("id", user.id)
    .maybeSingle();
  if (error) {
    throw error;
  }
  return decideAdminGate(user, profile);
}

async function gate(
  deps: AdminDeps,
  ctx: Ctx,
): Promise<{ ok: true; userId: string } | { ok: false; response: Response }> {
  try {
    const result = await requireAdmin(deps.session);
    return result.ok
      ? result
      : { ok: false, response: fail(result.error, ctx) };
  } catch (error) {
    return { ok: false, response: internal(ctx, "requireAdmin", error) };
  }
}

/** Đọc thân JSON có giới hạn kích thước; sai kiểu nội dung hoặc JSON hỏng: 400. */
async function readJsonBody(
  request: Request,
): Promise<{ ok: true; body: unknown } | { ok: false; error: ApiError }> {
  const invalid = apiError("validation_failed", undefined, [
    { field: "body", issue: "invalid_format" },
  ]);
  const type = request.headers.get("content-type") ?? "";
  if (!/^application\/json(\s*;|$)/i.test(type)) {
    return { ok: false, error: invalid };
  }
  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > BODY_MAX_BYTES) {
    return {
      ok: false,
      error: apiError("validation_failed", undefined, [
        { field: "body", issue: "too_long" },
      ]),
    };
  }
  try {
    return { ok: true, body: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, error: invalid };
  }
}

async function fetchUserRow(
  service: SupabaseClient,
  id: string,
): Promise<AdminUserRow | null> {
  const { data, error } = await service.rpc("admin_list_users", {
    p_user_id: id,
  });
  if (error) {
    throw error;
  }
  const rows = (data ?? []) as AdminUserRow[];
  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// GET /api/v1/users
// ---------------------------------------------------------------------------
export async function handleListUsers(
  request: Request,
  deps: AdminDeps,
): Promise<Response> {
  const ctx = { requestId: deps.requestId ?? randomUUID() };
  const g = await gate(deps, ctx);
  if (!g.ok) return g.response;

  const parsed = validateListQuery(new URL(request.url).searchParams);
  if (!parsed.ok) {
    return fail(apiError("validation_failed", undefined, parsed.details), ctx);
  }
  const { q, limit, cursor } = parsed.data;

  try {
    const { data, error } = await deps.service().rpc("admin_list_users", {
      p_q: q,
      p_after_key: cursor?.key ?? null,
      p_after_id: cursor?.id ?? null,
      p_limit: limit + 1,
    });
    if (error) throw error;
    const rows = (data ?? []) as AdminUserRow[];
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    const body: UserListResponse = {
      data: page.map(toAdminUser),
      next_cursor:
        rows.length > limit && last
          ? encodeCursor({ key: last.sort_key, id: last.id })
          : null,
    };
    return jsonResponse(body);
  } catch (error) {
    return internal(ctx, "list", error);
  }
}

// ---------------------------------------------------------------------------
// POST /api/v1/users/invitations
// ---------------------------------------------------------------------------
export async function handleInviteUser(
  request: Request,
  deps: AdminDeps,
): Promise<Response> {
  const ctx = { requestId: deps.requestId ?? randomUUID() };
  if (!isSameOrigin(request)) {
    return fail(apiError("forbidden"), ctx);
  }
  const g = await gate(deps, ctx);
  if (!g.ok) return g.response;

  const read = await readJsonBody(request);
  if (!read.ok) return fail(read.error, ctx);
  const parsed = validateInvitation(read.body);
  if (!parsed.ok) {
    return fail(apiError("validation_failed", undefined, parsed.details), ctx);
  }
  const input = parsed.data;

  try {
    const service = deps.service();

    if (input.department_id) {
      const { data: dept, error } = await service
        .from("departments")
        .select("id")
        .eq("id", input.department_id)
        .maybeSingle();
      if (error) throw error;
      if (!dept) {
        return fail(
          apiError(
            "validation_failed",
            strings.adminUsers.errors.departmentNotFound,
            [{ field: "department_id", issue: "invalid_value" }],
          ),
          ctx,
        );
      }
    }

    // Email đã có tài khoản: chỉ cho gửi lại khi người đó vẫn đang chờ nhận lời mời (chưa đăng
    // nhập lần nào); tài khoản đã dùng thì 409. Supabase Auth tự gửi lại với tài khoản chờ.
    const { data: existing, error: existingError } = await service
      .from("profiles")
      .select("id")
      .eq("email", input.email)
      .maybeSingle();
    if (existingError) throw existingError;
    let resend = false;
    if (existing) {
      const row = await fetchUserRow(service, existing.id as string);
      if (!row || userStatus(row) !== "invited") {
        return fail(
          apiError("conflict", strings.adminUsers.errors.emailExists, [
            { field: "email", issue: "invalid_value" },
          ]),
          ctx,
        );
      }
      resend = true;
    }

    // Supabase Auth tạo tài khoản ở trạng thái được mời và gửi email (cục bộ: Mailpit).
    // Trigger on_auth_user_created tạo dòng profiles với full_name từ metadata.
    const { data: invited, error: inviteError } =
      await service.auth.admin.inviteUserByEmail(input.email, {
        data: input.full_name ? { full_name: input.full_name } : undefined,
      });
    if (inviteError || !invited.user) {
      const code = (inviteError as { code?: string } | null)?.code;
      const alreadyRegistered =
        code === "email_exists" ||
        /already been registered/i.test(inviteError?.message ?? "");
      if (alreadyRegistered) {
        return fail(
          apiError("conflict", strings.adminUsers.errors.emailExists, [
            { field: "email", issue: "invalid_value" },
          ]),
          ctx,
        );
      }
      if (inviteError?.status === 429) {
        return fail(apiError("rate_limited", strings.errors.rateLimited), ctx);
      }
      return internal(ctx, "invite", inviteError);
    }
    const userId = invited.user.id;

    if (input.department_id) {
      const { error } = await service
        .from("profiles")
        .update({ department_id: input.department_id })
        .eq("id", userId);
      if (error) throw error;
    }

    const row = await fetchUserRow(service, userId);
    if (!row) {
      return internal(ctx, "invite:readback", new Error("profile missing"));
    }
    // Gửi lại lời mời: 200 (không tạo tài khoản mới); mời mới: 201 kèm Location.
    return resend
      ? jsonResponse({ data: toAdminUser(row) }, 200)
      : jsonResponse({ data: toAdminUser(row) }, 201, {
          location: `/api/v1/users/${userId}`,
        });
  } catch (error) {
    return internal(ctx, "invite", error);
  }
}

// ---------------------------------------------------------------------------
// PATCH /api/v1/users/{id}
// ---------------------------------------------------------------------------
export async function handlePatchUser(
  request: Request,
  targetId: string,
  deps: AdminDeps,
): Promise<Response> {
  const ctx = { requestId: deps.requestId ?? randomUUID() };
  if (!isSameOrigin(request)) {
    return fail(apiError("forbidden"), ctx);
  }
  const g = await gate(deps, ctx);
  if (!g.ok) return g.response;

  if (!isUuid(targetId)) {
    return fail(apiError("not_found"), ctx);
  }
  const id = targetId.toLowerCase();

  const read = await readJsonBody(request);
  if (!read.ok) return fail(read.error, ctx);
  const parsed = validateUserPatch(read.body);
  if (!parsed.ok) {
    return fail(apiError("validation_failed", undefined, parsed.details), ctx);
  }
  const patch = parsed.data;

  const self = checkSelfAction(g.userId, id, patch);
  if (self) return fail(self, ctx);

  try {
    const service = deps.service();

    // Quy tắc (tự khóa, Admin cuối cùng, phòng ban tồn tại) kiểm trong giao dịch có khóa hàng.
    const { error: updateError } = await service.rpc("admin_update_user", {
      p_actor_id: g.userId,
      p_target_id: id,
      p_is_admin: patch.is_admin ?? null,
      p_is_active: patch.is_active ?? null,
      p_set_department: patch.department_id !== undefined,
      p_department_id: patch.department_id ?? null,
    });
    if (updateError) {
      const mapped = mapAdminUpdateError(updateError);
      return mapped ? fail(mapped, ctx) : internal(ctx, "update", updateError);
    }

    // Đồng bộ lệnh cấm đăng nhập ở Supabase Auth mỗi khi is_active có trong yêu cầu (idempotent,
    // nên gửi lại cùng yêu cầu sẽ sửa được trạng thái lệch nếu lần trước lỗi ở bước này).
    // Lệch trạng thái nếu bước này lỗi vẫn an toàn: bị khóa mà chưa ban thì RLS đã chặn mọi dữ
    // liệu; mở khóa mà chưa gỡ ban thì người đó chỉ chưa đăng nhập được.
    if (patch.is_active !== undefined) {
      const { error: banError } = await service.auth.admin.updateUserById(id, {
        ban_duration: banDurationFor(patch.is_active),
      });
      if (banError) {
        logInternal(ctx, "ban", banError);
        return fail(
          apiError("internal_error", strings.adminUsers.errors.authSyncFailed),
          ctx,
        );
      }
    }

    const row = await fetchUserRow(service, id);
    if (!row) return fail(apiError("not_found"), ctx);
    return jsonResponse({ data: toAdminUser(row) });
  } catch (error) {
    return internal(ctx, "update", error);
  }
}
