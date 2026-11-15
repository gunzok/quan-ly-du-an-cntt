import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ApiError } from "@/lib/api/errors";
import { isSameOrigin, readJsonBody } from "@/lib/api/request";
import { apiError, errorResponse, jsonResponse } from "@/lib/api/respond";
import { requireActiveUser } from "@/lib/departments/handlers";
import { localeCookieHeader } from "@/lib/i18n/cookie";
import { ME_BODY_MAX_BYTES, validateMePatch } from "./validate";

/**
 * Lõi PATCH /api/v1/me (Story E10-2): người đang đăng nhập đổi ngôn ngữ giao diện của CHÍNH MÌNH.
 * Thứ tự kiểm: Origin 403 → phiên 401 (khóa: 403) → schema 400 → ghi.
 * Ghi bằng client phiên: quyền cột (chỉ full_name, locale) và RLS profiles_update_self (chỉ dòng
 * id = auth.uid()) là lớp chặn ở CSDL; câu UPDATE còn lọc id = người gọi. Không dùng service_role.
 * Phản hồi kèm cookie ngôn ngữ để trang đăng nhập sau khi đăng xuất giữ cùng ngôn ngữ.
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

export async function handlePatchMe(
  request: Request,
  deps: MeDeps,
): Promise<Response> {
  const requestId = deps.requestId ?? randomUUID();
  if (!isSameOrigin(request)) return fail(apiError("forbidden"), requestId);

  let userId: string;
  try {
    const gate = await requireActiveUser(deps.session);
    if (!gate.ok) return fail(gate.error, requestId);
    userId = gate.userId;
  } catch (error) {
    return internal(requestId, "gate", error);
  }

  const read = await readJsonBody(request, ME_BODY_MAX_BYTES);
  if (!read.ok) return fail(read.error, requestId);
  const parsed = validateMePatch(read.body);
  if (!parsed.ok) {
    return fail(
      apiError("validation_failed", undefined, parsed.details),
      requestId,
    );
  }

  try {
    const { data, error } = await deps.session
      .from("profiles")
      .update({ locale: parsed.data.locale })
      .eq("id", userId)
      .select("locale")
      .maybeSingle();
    if (error) {
      if (error.code === "42501") return fail(apiError("forbidden"), requestId);
      return internal(requestId, "update", error);
    }
    // RLS ẩn dòng (ví dụ vừa bị khóa giữa lúc kiểm và lúc ghi): không cập nhật được gì.
    if (!data) return fail(apiError("forbidden"), requestId);
    const locale = data.locale as string;
    return jsonResponse({ data: { locale } }, 200, {
      "set-cookie": localeCookieHeader(parsed.data.locale, {
        secure: deps.isProduction ?? process.env.NODE_ENV === "production",
      }),
    });
  } catch (error) {
    return internal(requestId, "update", error);
  }
}
