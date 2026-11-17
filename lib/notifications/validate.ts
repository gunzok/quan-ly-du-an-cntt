import type { ApiErrorDetail } from "@/lib/api/errors";
import {
  isPlainObject,
  unknownFields,
  type Validation,
} from "@/lib/api/request";
import {
  decodeTaskCursor,
  encodeTaskCursor,
  type TaskCursor,
} from "@/lib/tasks/validate";
import {
  NOTIFICATION_LIST_LIMIT_DEFAULT,
  NOTIFICATION_LIST_LIMIT_MAX,
} from "./model";

/** Con trỏ (created_at, id) dùng chung định dạng với danh sách task. */
export type NotificationCursor = TaskCursor;
export const encodeNotificationCursor = encodeTaskCursor;
export const decodeNotificationCursor = decodeTaskCursor;

export interface NotificationListQuery {
  limit: number;
  cursor: NotificationCursor | null;
  /** true: chỉ chưa đọc; false/không có: tất cả. */
  unread: boolean;
}

const LIST_PARAMS = ["limit", "cursor", "unread"] as const;

// GET /api/v1/notifications?limit=&cursor=&unread=true|false
export function validateNotificationListQuery(
  params: URLSearchParams,
): Validation<NotificationListQuery> {
  const details: ApiErrorDetail[] = unknownFields(
    new Set(params.keys()),
    LIST_PARAMS,
  );
  for (const name of LIST_PARAMS) {
    if (params.getAll(name).length > 1) {
      details.push({ field: name, issue: "invalid_value" });
    }
  }
  const query: NotificationListQuery = {
    limit: NOTIFICATION_LIST_LIMIT_DEFAULT,
    cursor: null,
    unread: false,
  };
  const rawLimit = params.get("limit");
  if (rawLimit !== null) {
    const n = /^\d{1,3}$/.test(rawLimit) ? Number(rawLimit) : NaN;
    if (!Number.isInteger(n) || n < 1 || n > NOTIFICATION_LIST_LIMIT_MAX) {
      details.push({ field: "limit", issue: "invalid_value" });
    } else {
      query.limit = n;
    }
  }
  const rawCursor = params.get("cursor");
  if (rawCursor !== null) {
    query.cursor = decodeNotificationCursor(rawCursor);
    if (!query.cursor)
      details.push({ field: "cursor", issue: "invalid_format" });
  }
  const rawUnread = params.get("unread");
  if (rawUnread !== null) {
    if (rawUnread === "true") query.unread = true;
    else if (rawUnread === "false") query.unread = false;
    else details.push({ field: "unread", issue: "invalid_value" });
  }
  return details.length > 0
    ? { ok: false, details }
    : { ok: true, data: query };
}

/** Không nhận tham số truy vấn nào (đếm chưa đọc, POST đánh dấu). */
export function validateNoParams(params: URLSearchParams): Validation<null> {
  const details = unknownFields(new Set(params.keys()), []);
  return details.length > 0 ? { ok: false, details } : { ok: true, data: null };
}

/**
 * Thân POST đánh dấu đã đọc: không bắt buộc; nếu có thì phải là JSON `{}` (trường lạ: 400).
 * `text` là thân thô đã đọc (rỗng = không có thân).
 */
export function validateEmptyBody(
  text: string,
  contentType: string | null,
): Validation<null> {
  if (text.trim() === "") return { ok: true, data: null };
  if (!/^application\/json(\s*;|$)/i.test(contentType ?? "")) {
    return { ok: false, details: [{ field: "body", issue: "invalid_format" }] };
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return { ok: false, details: [{ field: "body", issue: "invalid_format" }] };
  }
  if (!isPlainObject(body)) {
    return { ok: false, details: [{ field: "body", issue: "invalid_format" }] };
  }
  const details = unknownFields(Object.keys(body), []);
  return details.length > 0 ? { ok: false, details } : { ok: true, data: null };
}
