import type { ApiErrorDetail } from "@/lib/api/errors";
import { isUuid, unknownFields, type Validation } from "@/lib/api/request";
import { isIsoDate } from "@/lib/tasks/validate";
import {
  ACTIVITY_ACTIONS,
  ACTIVITY_ENTITY_TYPES,
  type ActivityAction,
  type ActivityEntityType,
} from "./model";

/**
 * Tham số truy vấn nhật ký (Story E6-2). Kiểm chặt: tham số lạ, lặp tham số, sai định dạng đều 400.
 *
 * GET /api/v1/projects/{id}/activity
 *   ?limit=1..100 (mặc định 50) &cursor=<mã>
 *   &actor_id=<uuid>                      người thực hiện
 *   &from=YYYY-MM-DD &to=YYYY-MM-DD       ngày theo giờ Việt Nam, tính cả hai đầu; from > to: 400
 *   &entity_type=task|project|project_member
 *   &action=create|update|delete
 * GET /api/v1/tasks/{id}/activity: chỉ limit, cursor.
 *
 * Sắp xếp cố định: mới nhất trước (created_at giảm dần, id giảm dần). Con trỏ là [created_at, id]
 * của dòng cuối trang, giữ nguyên chuỗi thời điểm Postgres trả về (độ chính xác micro giây, Date
 * của JS sẽ làm mất).
 */
export const ACTIVITY_LIMIT_DEFAULT = 50;
export const ACTIVITY_LIMIT_MAX = 100;
const CURSOR_MAX_LENGTH = 256;
const TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/;

export interface ActivityCursor {
  created_at: string;
  id: number;
}

export function encodeActivityCursor(cursor: ActivityCursor): string {
  return Buffer.from(JSON.stringify([cursor.created_at, cursor.id])).toString(
    "base64url",
  );
}

export function decodeActivityCursor(raw: string): ActivityCursor | null {
  if (raw.length > CURSOR_MAX_LENGTH || !/^[A-Za-z0-9_-]+$/.test(raw)) {
    return null;
  }
  try {
    const value: unknown = JSON.parse(
      Buffer.from(raw, "base64url").toString("utf8"),
    );
    if (
      Array.isArray(value) &&
      value.length === 2 &&
      typeof value[0] === "string" &&
      TIMESTAMP_PATTERN.test(value[0]) &&
      Number.isSafeInteger(value[1]) &&
      (value[1] as number) > 0
    ) {
      return { created_at: value[0], id: value[1] as number };
    }
  } catch {
    // rơi xuống null
  }
  return null;
}

export interface ActivityQuery {
  limit: number;
  cursor: ActivityCursor | null;
  actor_id: string | null;
  from: string | null;
  to: string | null;
  entity_type: ActivityEntityType | null;
  action: ActivityAction | null;
}

const PROJECT_PARAMS = [
  "limit",
  "cursor",
  "actor_id",
  "from",
  "to",
  "entity_type",
  "action",
] as const;
const TASK_PARAMS = ["limit", "cursor"] as const;

function validate(
  params: URLSearchParams,
  allowed: readonly string[],
): Validation<ActivityQuery> {
  const details: ApiErrorDetail[] = unknownFields(
    new Set(params.keys()),
    allowed,
  );
  for (const name of allowed) {
    if (params.getAll(name).length > 1) {
      details.push({ field: name, issue: "invalid_value" });
    }
  }
  const query: ActivityQuery = {
    limit: ACTIVITY_LIMIT_DEFAULT,
    cursor: null,
    actor_id: null,
    from: null,
    to: null,
    entity_type: null,
    action: null,
  };

  const rawLimit = params.get("limit");
  if (rawLimit !== null) {
    const n = /^\d{1,3}$/.test(rawLimit) ? Number(rawLimit) : NaN;
    if (!Number.isInteger(n) || n < 1 || n > ACTIVITY_LIMIT_MAX) {
      details.push({ field: "limit", issue: "invalid_value" });
    } else {
      query.limit = n;
    }
  }

  const rawCursor = params.get("cursor");
  if (rawCursor !== null) {
    query.cursor = decodeActivityCursor(rawCursor);
    if (!query.cursor) {
      details.push({ field: "cursor", issue: "invalid_format" });
    }
  }

  if (allowed.includes("actor_id")) {
    const raw = params.get("actor_id");
    if (raw !== null) {
      if (isUuid(raw)) query.actor_id = raw.toLowerCase();
      else details.push({ field: "actor_id", issue: "invalid_format" });
    }
  }

  for (const field of ["from", "to"] as const) {
    if (!allowed.includes(field)) continue;
    const raw = params.get(field);
    if (raw === null) continue;
    if (isIsoDate(raw)) query[field] = raw;
    else details.push({ field, issue: "invalid_format" });
  }
  if (query.from && query.to && query.from > query.to) {
    details.push({ field: "to", issue: "invalid_value" });
  }

  if (allowed.includes("entity_type")) {
    const raw = params.get("entity_type");
    if (raw !== null) {
      if ((ACTIVITY_ENTITY_TYPES as readonly string[]).includes(raw)) {
        query.entity_type = raw as ActivityEntityType;
      } else {
        details.push({ field: "entity_type", issue: "invalid_value" });
      }
    }
  }
  if (allowed.includes("action")) {
    const raw = params.get("action");
    if (raw !== null) {
      if ((ACTIVITY_ACTIONS as readonly string[]).includes(raw)) {
        query.action = raw as ActivityAction;
      } else {
        details.push({ field: "action", issue: "invalid_value" });
      }
    }
  }

  return details.length > 0
    ? { ok: false, details }
    : { ok: true, data: query };
}

export function validateProjectActivityQuery(
  params: URLSearchParams,
): Validation<ActivityQuery> {
  return validate(params, PROJECT_PARAMS);
}

export function validateTaskActivityQuery(
  params: URLSearchParams,
): Validation<ActivityQuery> {
  return validate(params, TASK_PARAMS);
}
