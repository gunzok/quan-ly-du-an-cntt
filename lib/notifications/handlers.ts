import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ApiError } from "@/lib/api/errors";
import { isSameOrigin, isUuid } from "@/lib/api/request";
import { apiError, errorResponse, jsonResponse } from "@/lib/api/respond";
import {
  NOTIFICATION_BODY_MAX_BYTES,
  NOTIFICATION_COLUMNS,
  type Notification,
  type NotificationListResponse,
  type NotificationPayload,
  type NotificationRow,
} from "./model";
import {
  encodeNotificationCursor,
  validateEmptyBody,
  validateNoParams,
  validateNotificationListQuery,
} from "./validate";

/**
 * Lõi API thông báo trong app (Story E4-1, QLDA-59; FR-11).
 *   GET  /api/v1/notifications                 ?limit=&cursor=&unread=
 *   GET  /api/v1/notifications/unread-count     số chưa đọc cho chuông (nhẹ)
 *   POST /api/v1/notifications/{id}/read        đánh dấu một thông báo đã đọc
 *   POST /api/v1/notifications/read-all         đánh dấu tất cả đã đọc
 * Route Handler chỉ tạo client phiên rồi gọi các hàm này; test tích hợp gọi thẳng.
 *
 * Chỉ dùng client PHIÊN (RLS: chỉ thông báo của chính mình, người bị khóa không thấy gì), không
 * dùng service_role. Thứ tự kiểm: Origin 403 (ghi) → phiên 401 → không thấy 404 → (không có bước
 * vai trò: ai cũng chỉ có thông báo của mình) → schema 400.
 *
 * Không rò rỉ (quyết định 6 của migration): payload (tiêu đề task, tên trạng thái, người làm) chỉ
 * đọc qua RPC `notification_payloads`, hàm này chỉ trả khi người nhận CÒN đọc được task. Tên người
 * làm đọc qua RLS của profiles. Không đọc được thì trả bản trung tính (`task_visible: false`).
 */
export interface NotificationDeps {
  /** Client theo phiên cookie của người gọi (khóa anon, RLS áp dụng). */
  session: SupabaseClient;
  requestId?: string;
}

interface Ctx {
  requestId: string;
}

function fail(error: ApiError, ctx: Ctx): Response {
  return errorResponse(error, ctx.requestId);
}

function internal(ctx: Ctx, where: string, error: unknown): Response {
  const e = error as { code?: unknown; message?: unknown };
  console.error(
    `[api/v1/notifications] ${where} request_id=${ctx.requestId} code=${String(e?.code ?? "")} message=${String(e?.message ?? error).slice(0, 200)}`,
  );
  return fail(apiError("internal_error"), ctx);
}

function newCtx(deps: NotificationDeps): Ctx {
  return { requestId: deps.requestId ?? randomUUID() };
}

async function currentUserId(session: SupabaseClient): Promise<string | null> {
  const { data, error } = await session.auth.getUser();
  return error ? null : (data.user?.id ?? null);
}

async function unreadCount(
  session: SupabaseClient,
  userId: string,
): Promise<number> {
  const { count, error } = await session
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .is("read_at", null);
  if (error) throw error;
  return count ?? 0;
}

/** Ghép payload (chỉ khi còn đọc được task) và tên người làm vào các dòng. */
async function present(
  session: SupabaseClient,
  rows: NotificationRow[],
): Promise<Notification[]> {
  if (rows.length === 0) return [];
  const { data: payloadRows, error } = await session.rpc(
    "notification_payloads",
    { p_ids: rows.map((r) => r.id) },
  );
  if (error) throw error;
  const payloads = new Map<string, NotificationPayload>();
  for (const p of (payloadRows ?? []) as {
    id: string;
    payload: NotificationPayload;
  }[]) {
    payloads.set(p.id, p.payload ?? {});
  }
  const actorIds = [
    ...new Set(
      [...payloads.values()]
        .map((p) => p.actor_id)
        .filter((id): id is string => isUuid(id)),
    ),
  ];
  const names = new Map<string, string | null>();
  if (actorIds.length > 0) {
    const { data: profiles, error: pErr } = await session
      .from("profiles")
      .select("id, full_name")
      .in("id", actorIds);
    if (pErr) throw pErr;
    for (const p of (profiles ?? []) as {
      id: string;
      full_name: string | null;
    }[]) {
      names.set(p.id, p.full_name);
    }
  }
  return rows.map((row) => {
    const payload = payloads.get(row.id);
    if (!payload) {
      return {
        ...row,
        task_visible: false,
        title: null,
        status_name: null,
        actor: null,
      };
    }
    const actorId = payload.actor_id ?? null;
    return {
      ...row,
      task_visible: true,
      title: typeof payload.title === "string" ? payload.title : null,
      status_name:
        typeof payload.status_name === "string" ? payload.status_name : null,
      actor:
        actorId && names.has(actorId)
          ? { id: actorId, full_name: names.get(actorId) ?? null }
          : null,
    };
  });
}

/** Thân POST chỉ được rỗng hoặc `{}`; đọc có giới hạn kích thước. */
async function checkEmptyBody(
  request: Request,
  ctx: Ctx,
): Promise<Response | null> {
  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > NOTIFICATION_BODY_MAX_BYTES) {
    return fail(
      apiError("validation_failed", undefined, [
        { field: "body", issue: "too_long" },
      ]),
      ctx,
    );
  }
  const parsed = validateEmptyBody(text, request.headers.get("content-type"));
  if (!parsed.ok) {
    return fail(apiError("validation_failed", undefined, parsed.details), ctx);
  }
  const params = validateNoParams(new URL(request.url).searchParams);
  if (!params.ok) {
    return fail(apiError("validation_failed", undefined, params.details), ctx);
  }
  return null;
}

// ---------------------------------------------------------------------------
// GET /api/v1/notifications
// ---------------------------------------------------------------------------
export async function handleListNotifications(
  request: Request,
  deps: NotificationDeps,
): Promise<Response> {
  const ctx = newCtx(deps);
  try {
    const userId = await currentUserId(deps.session);
    if (!userId) return fail(apiError("unauthenticated"), ctx);
    const parsed = validateNotificationListQuery(
      new URL(request.url).searchParams,
    );
    if (!parsed.ok) {
      return fail(
        apiError("validation_failed", undefined, parsed.details),
        ctx,
      );
    }
    const { limit, cursor, unread } = parsed.data;
    let query = deps.session
      .from("notifications")
      .select(NOTIFICATION_COLUMNS)
      .eq("user_id", userId);
    if (unread) query = query.is("read_at", null);
    if (cursor) {
      // Con trỏ đã kiểm chặt định dạng (dấu thời gian ISO, uuid) nên ghép vào bộ lọc an toàn.
      query = query.or(
        `created_at.lt."${cursor.created_at}",and(created_at.eq."${cursor.created_at}",id.lt.${cursor.id})`,
      );
    }
    const [{ data, error }, count] = await Promise.all([
      query
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(limit + 1),
      unreadCount(deps.session, userId),
    ]);
    if (error) throw error;
    const rows = (data ?? []) as NotificationRow[];
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    const body: NotificationListResponse = {
      data: await present(deps.session, page),
      next_cursor:
        rows.length > limit && last
          ? encodeNotificationCursor({
              created_at: last.created_at,
              id: last.id,
            })
          : null,
      unread_count: count,
    };
    return jsonResponse(body);
  } catch (error) {
    return internal(ctx, "list", error);
  }
}

// ---------------------------------------------------------------------------
// GET /api/v1/notifications/unread-count
// ---------------------------------------------------------------------------
export async function handleUnreadCount(
  request: Request,
  deps: NotificationDeps,
): Promise<Response> {
  const ctx = newCtx(deps);
  try {
    const userId = await currentUserId(deps.session);
    if (!userId) return fail(apiError("unauthenticated"), ctx);
    const params = validateNoParams(new URL(request.url).searchParams);
    if (!params.ok) {
      return fail(
        apiError("validation_failed", undefined, params.details),
        ctx,
      );
    }
    return jsonResponse({
      data: { unread_count: await unreadCount(deps.session, userId) },
    });
  } catch (error) {
    return internal(ctx, "unread count", error);
  }
}

// ---------------------------------------------------------------------------
// POST /api/v1/notifications/{id}/read — idempotent: đã đọc rồi thì trả nguyên trạng.
// ---------------------------------------------------------------------------
export async function handleMarkRead(
  request: Request,
  rawId: string,
  deps: NotificationDeps,
): Promise<Response> {
  const ctx = newCtx(deps);
  if (!isSameOrigin(request)) return fail(apiError("forbidden"), ctx);
  try {
    const userId = await currentUserId(deps.session);
    if (!userId) return fail(apiError("unauthenticated"), ctx);
    if (!isUuid(rawId)) return fail(apiError("not_found"), ctx);
    const id = rawId.toLowerCase();
    const { data: existing, error: readErr } = await deps.session
      .from("notifications")
      .select(NOTIFICATION_COLUMNS)
      .eq("id", id)
      .maybeSingle();
    if (readErr) throw readErr;
    if (!existing) return fail(apiError("not_found"), ctx);
    const bad = await checkEmptyBody(request, ctx);
    if (bad) return bad;

    let row = existing as NotificationRow;
    if (row.read_at === null) {
      const { data, error } = await deps.session
        .from("notifications")
        .update({ read_at: new Date().toISOString() })
        .eq("id", id)
        .is("read_at", null)
        .select(NOTIFICATION_COLUMNS)
        .maybeSingle();
      if (error) throw error;
      // null: yêu cầu khác vừa đánh dấu trước; đọc lại để trả trạng thái mới nhất.
      if (data) {
        row = data as NotificationRow;
      } else {
        const again = await deps.session
          .from("notifications")
          .select(NOTIFICATION_COLUMNS)
          .eq("id", id)
          .maybeSingle();
        if (again.error) throw again.error;
        if (!again.data) return fail(apiError("not_found"), ctx);
        row = again.data as NotificationRow;
      }
    }
    const [item] = await present(deps.session, [row]);
    return jsonResponse({
      data: item,
      unread_count: await unreadCount(deps.session, userId),
    });
  } catch (error) {
    return internal(ctx, "mark read", error);
  }
}

// ---------------------------------------------------------------------------
// POST /api/v1/notifications/read-all
// ---------------------------------------------------------------------------
export async function handleMarkAllRead(
  request: Request,
  deps: NotificationDeps,
): Promise<Response> {
  const ctx = newCtx(deps);
  if (!isSameOrigin(request)) return fail(apiError("forbidden"), ctx);
  try {
    const userId = await currentUserId(deps.session);
    if (!userId) return fail(apiError("unauthenticated"), ctx);
    const bad = await checkEmptyBody(request, ctx);
    if (bad) return bad;
    const { data, error } = await deps.session
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("user_id", userId)
      .is("read_at", null)
      .select("id");
    if (error) throw error;
    return jsonResponse({
      data: {
        updated: (data ?? []).length,
        unread_count: await unreadCount(deps.session, userId),
      },
    });
  } catch (error) {
    return internal(ctx, "mark all read", error);
  }
}
