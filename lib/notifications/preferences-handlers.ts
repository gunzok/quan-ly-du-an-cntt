import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isSameOrigin, readJsonBody } from "@/lib/api/request";
import { apiError, errorResponse, jsonResponse } from "@/lib/api/respond";
import { requireActiveUser } from "@/lib/departments/handlers";
import {
  PREFERENCES_BODY_MAX_BYTES,
  toEmailPreferences,
  validatePreferencesPut,
  type EmailPreferences,
} from "./preferences";

/**
 * Lõi GET/PUT /api/v1/me/notification-preferences (Story E4-2): người đang đăng nhập xem và bật/tắt
 * email theo loại của CHÍNH MÌNH. Thứ tự kiểm: Origin 403 (PUT) → phiên 401 (khóa: 403) → schema
 * 400 (từ chối trường lạ) → ghi. Chỉ client phiên: RLS notification_preferences chính chủ; ghi qua
 * public.set_my_notification_preferences (SECURITY INVOKER, nguyên tử). Không dùng service_role.
 */
export interface PreferencesDeps {
  session: SupabaseClient;
  requestId?: string;
}

function internal(requestId: string, where: string, error: unknown) {
  const e = error as { code?: unknown; message?: unknown };
  console.error(
    `[api/v1/me/notification-preferences] ${where} request_id=${requestId} code=${String(e?.code ?? "")} message=${String(e?.message ?? error).slice(0, 200)}`,
  );
  return errorResponse(apiError("internal_error"), requestId);
}

async function gateUser(session: SupabaseClient, requestId: string) {
  try {
    const gate = await requireActiveUser(session);
    if (!gate.ok) {
      return {
        ok: false as const,
        response: errorResponse(gate.error, requestId),
      };
    }
    return { ok: true as const };
  } catch (error) {
    return { ok: false as const, response: internal(requestId, "gate", error) };
  }
}

/** Đọc đủ mọi loại. null = RLS/hàm không trả gì (vừa bị khóa giữa chừng). */
export async function loadEmailPreferences(
  session: SupabaseClient,
): Promise<EmailPreferences | null> {
  const { data, error } = await session.rpc("my_notification_preferences");
  if (error) throw error;
  return toEmailPreferences(
    (data ?? []) as { type: string; email_enabled: boolean }[],
  );
}

async function respondWithCurrent(
  session: SupabaseClient,
  requestId: string,
): Promise<Response> {
  try {
    const email = await loadEmailPreferences(session);
    if (!email) return errorResponse(apiError("forbidden"), requestId);
    return jsonResponse({ data: { email } }, 200);
  } catch (error) {
    return internal(requestId, "load", error);
  }
}

export async function handleGetNotificationPreferences(
  _request: Request,
  deps: PreferencesDeps,
): Promise<Response> {
  const requestId = deps.requestId ?? randomUUID();
  const gate = await gateUser(deps.session, requestId);
  if (!gate.ok) return gate.response;
  return respondWithCurrent(deps.session, requestId);
}

export async function handlePutNotificationPreferences(
  request: Request,
  deps: PreferencesDeps,
): Promise<Response> {
  const requestId = deps.requestId ?? randomUUID();
  if (!isSameOrigin(request)) {
    return errorResponse(apiError("forbidden"), requestId);
  }
  const gate = await gateUser(deps.session, requestId);
  if (!gate.ok) return gate.response;

  const read = await readJsonBody(request, PREFERENCES_BODY_MAX_BYTES);
  if (!read.ok) return errorResponse(read.error, requestId);
  const parsed = validatePreferencesPut(read.body);
  if (!parsed.ok) {
    return errorResponse(
      apiError("validation_failed", undefined, parsed.details),
      requestId,
    );
  }

  const { error } = await deps.session.rpc("set_my_notification_preferences", {
    p_prefs: parsed.data.email,
  });
  if (error) {
    // RLS chặn (vừa bị khóa giữa lúc kiểm và lúc ghi).
    if (error.code === "42501") {
      return errorResponse(apiError("forbidden"), requestId);
    }
    return internal(requestId, "update", error);
  }
  return respondWithCurrent(deps.session, requestId);
}
