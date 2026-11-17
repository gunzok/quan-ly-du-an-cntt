import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ApiError } from "@/lib/api/errors";
import { isSameOrigin, readJsonBody } from "@/lib/api/request";
import { apiError, errorResponse, jsonResponse } from "@/lib/api/respond";
import { requireActiveUser } from "@/lib/departments/handlers";
import { localeCookieHeader } from "@/lib/i18n/cookie";
import { loadMe } from "./load";
import { ME_BODY_MAX_BYTES, validateMePatch, type MePatch } from "./validate";

/**
 * Lõi GET/PATCH /api/v1/me (Story E10-2, E1-7): người đang đăng nhập xem và sửa hồ sơ của CHÍNH MÌNH.
 * PATCH kiểm theo thứ tự: Origin 403 → phiên 401 (khóa: 403) → schema 400 (từ chối trường lạ) → ghi.
 * Ghi bằng client phiên: quyền cột (profiles chỉ full_name, locale; profile_contacts chỉ phone) và
 * RLS profiles_update_self, profile_contacts_*_self (chỉ dòng của auth.uid()) là lớp chặn ở CSDL;
 * câu lệnh còn lọc theo id người gọi. Không dùng service_role.
 * Đổi ngôn ngữ thì phản hồi kèm cookie để trang đăng nhập sau khi đăng xuất giữ cùng ngôn ngữ.
 */
export interface MeDeps {
  session: SupabaseClient;
  requestId?: string;
  isProduction?: boolean;
}

function fail(error: ApiError, requestId: string) {
  return errorResponse(error, requestId);
}

function internal(requestId: string, where: string, error: unknown) {
  const e = error as { code?: unknown; message?: unknown };
  console.error(
    `[api/v1/me] ${where} request_id=${requestId} code=${String(e?.code ?? "")} message=${String(e?.message ?? error).slice(0, 200)}`,
  );
  return fail(apiError("internal_error"), requestId);
}

async function gateUser(
  session: SupabaseClient,
  requestId: string,
): Promise<{ ok: true; userId: string } | { ok: false; response: Response }> {
  try {
    const gate = await requireActiveUser(session);
    if (!gate.ok) return { ok: false, response: fail(gate.error, requestId) };
    return { ok: true, userId: gate.userId };
  } catch (error) {
    return { ok: false, response: internal(requestId, "gate", error) };
  }
}

/** GET /api/v1/me: hồ sơ, số điện thoại, phòng ban, vai trò theo từng dự án. */
export async function handleGetMe(
  _request: Request,
  deps: MeDeps,
): Promise<Response> {
  const requestId = deps.requestId ?? randomUUID();
  const gate = await gateUser(deps.session, requestId);
  if (!gate.ok) return gate.response;
  try {
    const me = await loadMe(deps.session, gate.userId);
    // RLS ẩn hồ sơ (vừa bị khóa giữa lúc kiểm và lúc đọc).
    if (!me) return fail(apiError("forbidden"), requestId);
    return jsonResponse({ data: me }, 200);
  } catch (error) {
    return internal(requestId, "load", error);
  }
}

type DbError = { code?: string; message?: string };

/** Ghi số điện thoại vào profile_contacts: null xóa; có giá trị thì sửa, chưa có dòng thì thêm. */
async function writePhone(
  session: SupabaseClient,
  userId: string,
  phone: string | null,
): Promise<DbError | null> {
  if (phone === null) {
    const { error } = await session
      .from("profile_contacts")
      .delete()
      .eq("user_id", userId);
    return error;
  }
  // Không dùng upsert: PostgREST đặt lại mọi cột trong thân (cả user_id) khi trùng khóa, trong
  // khi authenticated chỉ có quyền UPDATE cột phone.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const updated = await session
      .from("profile_contacts")
      .update({ phone })
      .eq("user_id", userId)
      .select("user_id");
    if (updated.error) return updated.error;
    if ((updated.data ?? []).length > 0) return null;
    const inserted = await session
      .from("profile_contacts")
      .insert({ user_id: userId, phone });
    // Hai request song song cùng thêm: lần sau sửa dòng vừa có.
    if (inserted.error?.code === "23505") continue;
    return inserted.error;
  }
  return null;
}

function writeFailure(requestId: string, where: string, error: DbError) {
  if (error.code === "42501") return fail(apiError("forbidden"), requestId);
  // Ràng buộc CSDL (định dạng số điện thoại, độ dài tên) lệch với schema ở trên: vẫn là 400.
  if (error.code === "23514") {
    const field = /phone/.test(error.message ?? "") ? "phone" : "full_name";
    return fail(
      apiError("validation_failed", undefined, [
        { field, issue: "invalid_format" },
      ]),
      requestId,
    );
  }
  return internal(requestId, where, error);
}

export async function handlePatchMe(
  request: Request,
  deps: MeDeps,
): Promise<Response> {
  const requestId = deps.requestId ?? randomUUID();
  if (!isSameOrigin(request)) return fail(apiError("forbidden"), requestId);

  const gate = await gateUser(deps.session, requestId);
  if (!gate.ok) return gate.response;
  const userId = gate.userId;

  const read = await readJsonBody(request, ME_BODY_MAX_BYTES);
  if (!read.ok) return fail(read.error, requestId);
  const parsed = validateMePatch(read.body);
  if (!parsed.ok) {
    return fail(
      apiError("validation_failed", undefined, parsed.details),
      requestId,
    );
  }
  const patch: MePatch = parsed.data;
  const result: MePatch = {};

  try {
    const profileChanges: { full_name?: string; locale?: string } = {};
    if (patch.full_name !== undefined)
      profileChanges.full_name = patch.full_name;
    if (patch.locale !== undefined) profileChanges.locale = patch.locale;

    if (Object.keys(profileChanges).length > 0) {
      const { data, error } = await deps.session
        .from("profiles")
        .update(profileChanges)
        .eq("id", userId)
        .select("full_name, locale")
        .maybeSingle();
      if (error) return writeFailure(requestId, "update", error);
      // RLS ẩn dòng (ví dụ vừa bị khóa giữa lúc kiểm và lúc ghi): không cập nhật được gì.
      if (!data) return fail(apiError("forbidden"), requestId);
      if (patch.full_name !== undefined)
        result.full_name = data.full_name as string;
      if (patch.locale !== undefined)
        result.locale = data.locale as MePatch["locale"];
    }

    if (patch.phone !== undefined) {
      const error = await writePhone(deps.session, userId, patch.phone);
      if (error) return writeFailure(requestId, "phone", error);
      result.phone = patch.phone;
    }
  } catch (error) {
    return internal(requestId, "update", error);
  }

  const headers: Record<string, string> = {};
  if (patch.locale !== undefined) {
    headers["set-cookie"] = localeCookieHeader(patch.locale, {
      secure: deps.isProduction ?? process.env.NODE_ENV === "production",
    });
  }
  return jsonResponse({ data: result }, 200, headers);
}
