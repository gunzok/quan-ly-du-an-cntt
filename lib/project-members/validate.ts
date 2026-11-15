import type { ApiErrorDetail } from "@/lib/api/errors";
import {
  isPlainObject,
  isUuid,
  unknownFields,
  type Validation,
} from "@/lib/api/request";
import {
  PROJECT_ROLES,
  SEARCH_Q_MAX,
  SEARCH_Q_MIN,
  type ProjectRole,
} from "./model";

/**
 * Schema phía máy chủ cho PUT /api/v1/projects/{id}/members/{user_id} và
 * GET /api/v1/users/search (viết tay như lib/api/request.ts). Từ chối trường lạ.
 */
export const MEMBER_BODY_MAX_BYTES = 512;
export { SEARCH_Q_MAX, SEARCH_Q_MIN };
/** Khớp giới hạn cứng trong public.search_users_for_membership(). */
export const SEARCH_LIMIT_MAX = 20;

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

export function validateMemberUserId(raw: string): Validation<string> {
  return isUuid(raw)
    ? { ok: true, data: raw.toLowerCase() }
    : { ok: false, details: [{ field: "user_id", issue: "invalid_format" }] };
}

export function validateMemberPut(body: unknown): Validation<{
  role: ProjectRole;
}> {
  if (!isPlainObject(body)) {
    return { ok: false, details: [{ field: "body", issue: "invalid_format" }] };
  }
  const details: ApiErrorDetail[] = unknownFields(Object.keys(body), ["role"]);
  const role = body.role;
  if (role === undefined || role === null) {
    details.push({ field: "role", issue: "required" });
  } else if (
    typeof role !== "string" ||
    !(PROJECT_ROLES as readonly string[]).includes(role)
  ) {
    details.push({ field: "role", issue: "invalid_value" });
  }
  if (details.length > 0) return { ok: false, details };
  return { ok: true, data: { role: role as ProjectRole } };
}

export interface SearchQuery {
  q: string;
  exclude_project_id: string | null;
  limit: number;
}

export function validateUserSearchQuery(
  params: URLSearchParams,
): Validation<SearchQuery> {
  const allowed = ["q", "exclude_project_id", "limit"];
  const details: ApiErrorDetail[] = unknownFields(
    new Set(params.keys()),
    allowed,
  );
  for (const key of allowed) {
    if (params.getAll(key).length > 1) {
      details.push({ field: key, issue: "invalid_value" });
    }
  }
  const rawQ = params.get("q");
  let q = "";
  if (rawQ === null) {
    details.push({ field: "q", issue: "required" });
  } else if (CONTROL_CHARS.test(rawQ)) {
    details.push({ field: "q", issue: "invalid_format" });
  } else {
    q = rawQ.trim().replace(/\s+/g, " ");
    if (q.length < SEARCH_Q_MIN) {
      details.push({ field: "q", issue: "required" });
    } else if (q.length > SEARCH_Q_MAX) {
      details.push({ field: "q", issue: "too_long" });
    }
  }
  const rawProject = params.get("exclude_project_id");
  let excludeProjectId: string | null = null;
  if (rawProject !== null) {
    if (isUuid(rawProject)) excludeProjectId = rawProject.toLowerCase();
    else details.push({ field: "exclude_project_id", issue: "invalid_format" });
  }
  const rawLimit = params.get("limit");
  let limit = SEARCH_LIMIT_MAX;
  if (rawLimit !== null) {
    const n = /^\d{1,3}$/.test(rawLimit) ? Number(rawLimit) : NaN;
    if (Number.isInteger(n) && n >= 1 && n <= SEARCH_LIMIT_MAX) limit = n;
    else details.push({ field: "limit", issue: "invalid_value" });
  }
  if (details.length > 0) return { ok: false, details };
  return {
    ok: true,
    data: { q, exclude_project_id: excludeProjectId, limit },
  };
}

/** GET danh sách thành viên: không nhận tham số nào (trả đủ, dự án nội bộ ít người). */
export function validateMemberListQuery(
  params: URLSearchParams,
): Validation<null> {
  const details = unknownFields(new Set(params.keys()), []);
  return details.length > 0 ? { ok: false, details } : { ok: true, data: null };
}
