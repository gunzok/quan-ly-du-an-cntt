import type { ApiErrorDetail } from "@/lib/api/errors";
import { EMAIL_MAX_LENGTH } from "@/lib/auth/validate";

/**
 * Schema phía máy chủ cho /api/v1/users (viết tay như lib/auth/validate.ts, không thêm thư viện).
 * Mọi hàm: từ chối trường lạ (`unknown_field`), không tin kiểu dữ liệu từ trình duyệt.
 */

export const LIST_LIMIT_DEFAULT = 50;
export const LIST_LIMIT_MAX = 100;
export const SEARCH_MAX_LENGTH = 100;
export const FULL_NAME_MAX_LENGTH = 200;
const CURSOR_MAX_LENGTH = 1024;
/** Giới hạn thân request JSON (byte). */
export const BODY_MAX_BYTES = 4096;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Ký tự điều khiển (kể cả xuống dòng) không hợp lệ trong họ tên và từ khóa.
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

export type Validation<T> =
  { ok: true; data: T } | { ok: false; details: ApiErrorDetail[] };

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function unknownFields(
  keys: Iterable<string>,
  allowed: readonly string[],
): ApiErrorDetail[] {
  const details: ApiErrorDetail[] = [];
  for (const key of keys) {
    if (!allowed.includes(key)) {
      details.push({ field: key.slice(0, 64), issue: "unknown_field" });
    }
  }
  return details;
}

// ---------------------------------------------------------------------------
// Con trỏ phân trang: base64url của JSON [sort_key, id]. Không mã hóa bí mật gì, chỉ là vị trí.
// ---------------------------------------------------------------------------
export interface ListCursor {
  key: string;
  id: string;
}

export function encodeCursor(cursor: ListCursor): string {
  return Buffer.from(JSON.stringify([cursor.key, cursor.id])).toString(
    "base64url",
  );
}

export function decodeCursor(raw: string): ListCursor | null {
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
      value[0].length <= 500 &&
      isUuid(value[1])
    ) {
      return { key: value[0], id: value[1].toLowerCase() };
    }
  } catch {
    // rơi xuống null
  }
  return null;
}

// ---------------------------------------------------------------------------
// GET /api/v1/users?q=&limit=&cursor=
// ---------------------------------------------------------------------------
export interface ListUsersQuery {
  q: string | null;
  limit: number;
  cursor: ListCursor | null;
}

const LIST_PARAMS = ["q", "limit", "cursor"] as const;

export function validateListQuery(
  params: URLSearchParams,
): Validation<ListUsersQuery> {
  const details = unknownFields(new Set(params.keys()), LIST_PARAMS);
  for (const name of LIST_PARAMS) {
    if (params.getAll(name).length > 1) {
      details.push({ field: name, issue: "invalid_value" });
    }
  }

  const rawQ = params.get("q");
  let q: string | null = null;
  if (rawQ !== null) {
    const trimmed = rawQ.trim();
    if (trimmed.length > SEARCH_MAX_LENGTH) {
      details.push({ field: "q", issue: "too_long" });
    } else if (CONTROL_CHARS.test(trimmed)) {
      details.push({ field: "q", issue: "invalid_format" });
    } else {
      q = trimmed === "" ? null : trimmed;
    }
  }

  let limit = LIST_LIMIT_DEFAULT;
  const rawLimit = params.get("limit");
  if (rawLimit !== null) {
    const n = /^\d{1,3}$/.test(rawLimit) ? Number(rawLimit) : NaN;
    if (!Number.isInteger(n) || n < 1 || n > LIST_LIMIT_MAX) {
      details.push({ field: "limit", issue: "invalid_value" });
    } else {
      limit = n;
    }
  }

  let cursor: ListCursor | null = null;
  const rawCursor = params.get("cursor");
  if (rawCursor !== null) {
    cursor = decodeCursor(rawCursor);
    if (!cursor) {
      details.push({ field: "cursor", issue: "invalid_format" });
    }
  }

  return details.length > 0
    ? { ok: false, details }
    : { ok: true, data: { q, limit, cursor } };
}

// ---------------------------------------------------------------------------
// POST /api/v1/users/invitations { email, full_name?, department_id? }
// ---------------------------------------------------------------------------
export interface InvitationInput {
  email: string;
  full_name: string;
  department_id: string | null;
}

const INVITATION_FIELDS = ["email", "full_name", "department_id"] as const;

function readFullName(
  value: unknown,
  details: ApiErrorDetail[],
): string | undefined {
  if (typeof value !== "string") {
    details.push({ field: "full_name", issue: "invalid_value" });
    return undefined;
  }
  const name = value.trim().replace(/\s+/g, " ");
  if (name.length > FULL_NAME_MAX_LENGTH) {
    details.push({ field: "full_name", issue: "too_long" });
    return undefined;
  }
  if (CONTROL_CHARS.test(value.replace(/[\t\n\r]/g, " "))) {
    details.push({ field: "full_name", issue: "invalid_format" });
    return undefined;
  }
  return name;
}

export function validateInvitation(body: unknown): Validation<InvitationInput> {
  if (!isPlainObject(body)) {
    return { ok: false, details: [{ field: "body", issue: "invalid_format" }] };
  }
  const details = unknownFields(Object.keys(body), INVITATION_FIELDS);

  let email = "";
  if (body.email === undefined || body.email === null || body.email === "") {
    details.push({ field: "email", issue: "required" });
  } else if (typeof body.email !== "string") {
    details.push({ field: "email", issue: "invalid_value" });
  } else {
    email = body.email.trim().toLowerCase();
    if (email === "") {
      details.push({ field: "email", issue: "required" });
    } else if (email.length > EMAIL_MAX_LENGTH) {
      details.push({ field: "email", issue: "too_long" });
    } else if (!EMAIL_PATTERN.test(email)) {
      details.push({ field: "email", issue: "invalid_format" });
    }
  }

  let fullName = "";
  if (body.full_name !== undefined && body.full_name !== null) {
    fullName = readFullName(body.full_name, details) ?? "";
  }

  let departmentId: string | null = null;
  if (body.department_id !== undefined && body.department_id !== null) {
    if (isUuid(body.department_id)) {
      departmentId = body.department_id.toLowerCase();
    } else {
      details.push({ field: "department_id", issue: "invalid_format" });
    }
  }

  return details.length > 0
    ? { ok: false, details }
    : {
        ok: true,
        data: { email, full_name: fullName, department_id: departmentId },
      };
}

// ---------------------------------------------------------------------------
// PATCH /api/v1/users/{id} { is_active?, is_admin?, department_id? }
// ---------------------------------------------------------------------------
export interface UserPatch {
  is_active?: boolean;
  is_admin?: boolean;
  /** undefined = không đổi; null = bỏ phòng ban. */
  department_id?: string | null;
}

const PATCH_FIELDS = ["is_active", "is_admin", "department_id"] as const;

export function validateUserPatch(body: unknown): Validation<UserPatch> {
  if (!isPlainObject(body)) {
    return { ok: false, details: [{ field: "body", issue: "invalid_format" }] };
  }
  const details = unknownFields(Object.keys(body), PATCH_FIELDS);
  const patch: UserPatch = {};

  for (const field of ["is_active", "is_admin"] as const) {
    if (field in body) {
      if (typeof body[field] === "boolean") {
        patch[field] = body[field];
      } else {
        details.push({ field, issue: "invalid_value" });
      }
    }
  }

  if ("department_id" in body) {
    if (body.department_id === null) {
      patch.department_id = null;
    } else if (isUuid(body.department_id)) {
      patch.department_id = body.department_id.toLowerCase();
    } else {
      details.push({ field: "department_id", issue: "invalid_format" });
    }
  }

  if (details.length === 0 && Object.keys(patch).length === 0) {
    details.push({ field: "body", issue: "required" });
  }

  return details.length > 0
    ? { ok: false, details }
    : { ok: true, data: patch };
}
