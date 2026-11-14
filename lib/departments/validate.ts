import type { ApiErrorDetail } from "@/lib/api/errors";
import {
  CONTROL_CHARS,
  isPlainObject,
  unknownFields,
  type Validation,
} from "@/lib/admin/users/validate";

/**
 * Schema phía máy chủ cho /api/v1/departments (viết tay như lib/admin/users/validate.ts).
 * Từ chối trường lạ, không tin kiểu dữ liệu từ trình duyệt.
 */

/** Tên phòng ban tối đa (ký tự, sau khi cắt khoảng trắng). CSDL cho tới 200; API chặt hơn. */
export const DEPARTMENT_NAME_MAX_LENGTH = 100;
/** Thứ tự hiển thị hợp lệ: số nguyên 0..POSITION_MAX. */
export const POSITION_MAX = 100_000;

// ---------------------------------------------------------------------------
// GET /api/v1/departments?include_archived=true|false
// ---------------------------------------------------------------------------
export interface ListDepartmentsQuery {
  include_archived: boolean;
}

const LIST_PARAMS = ["include_archived"] as const;

export function validateDepartmentListQuery(
  params: URLSearchParams,
): Validation<ListDepartmentsQuery> {
  const details = unknownFields(new Set(params.keys()), LIST_PARAMS);
  let includeArchived = false;
  const raw = params.getAll("include_archived");
  if (raw.length > 1) {
    details.push({ field: "include_archived", issue: "invalid_value" });
  } else if (raw.length === 1) {
    if (raw[0] === "true") includeArchived = true;
    else if (raw[0] !== "false") {
      details.push({ field: "include_archived", issue: "invalid_value" });
    }
  }
  return details.length > 0
    ? { ok: false, details }
    : { ok: true, data: { include_archived: includeArchived } };
}

// ---------------------------------------------------------------------------
// Trường dùng chung cho POST/PATCH
// ---------------------------------------------------------------------------

/** Chuẩn hóa tên: cắt hai đầu, gộp khoảng trắng liên tiếp thành một dấu cách. */
export function normalizeDepartmentName(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function readName(
  value: unknown,
  details: ApiErrorDetail[],
): string | undefined {
  if (value === undefined || value === null) {
    details.push({ field: "name", issue: "required" });
    return undefined;
  }
  if (typeof value !== "string") {
    details.push({ field: "name", issue: "invalid_value" });
    return undefined;
  }
  // Tab/xuống dòng được gộp thành dấu cách; ký tự điều khiển khác thì từ chối.
  if (CONTROL_CHARS.test(value.replace(/[\t\n\r]/g, " "))) {
    details.push({ field: "name", issue: "invalid_format" });
    return undefined;
  }
  const name = normalizeDepartmentName(value);
  if (name === "") {
    details.push({ field: "name", issue: "required" });
    return undefined;
  }
  if (name.length > DEPARTMENT_NAME_MAX_LENGTH) {
    details.push({ field: "name", issue: "too_long" });
    return undefined;
  }
  return name;
}

function readPosition(
  value: unknown,
  details: ApiErrorDetail[],
): number | undefined {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > POSITION_MAX
  ) {
    details.push({ field: "position", issue: "invalid_value" });
    return undefined;
  }
  return value;
}

// ---------------------------------------------------------------------------
// POST /api/v1/departments { name, position? }
// ---------------------------------------------------------------------------
export interface DepartmentCreate {
  name: string;
  /** Không gửi: xếp cuối danh mục. */
  position?: number;
}

const CREATE_FIELDS = ["name", "position"] as const;

export function validateDepartmentCreate(
  body: unknown,
): Validation<DepartmentCreate> {
  if (!isPlainObject(body)) {
    return { ok: false, details: [{ field: "body", issue: "invalid_format" }] };
  }
  const details = unknownFields(Object.keys(body), CREATE_FIELDS);
  const name = readName(body.name, details);
  const data: DepartmentCreate = { name: name ?? "" };
  if (body.position !== undefined) {
    const position = readPosition(body.position, details);
    if (position !== undefined) data.position = position;
  }
  return details.length > 0 ? { ok: false, details } : { ok: true, data };
}

// ---------------------------------------------------------------------------
// PATCH /api/v1/departments/{id} { name?, position?, archived? }
// ---------------------------------------------------------------------------
export interface DepartmentPatch {
  name?: string;
  position?: number;
  /** true = lưu trữ, false = dùng lại. */
  archived?: boolean;
}

const PATCH_FIELDS = ["name", "position", "archived"] as const;

export function validateDepartmentPatch(
  body: unknown,
): Validation<DepartmentPatch> {
  if (!isPlainObject(body)) {
    return { ok: false, details: [{ field: "body", issue: "invalid_format" }] };
  }
  const details = unknownFields(Object.keys(body), PATCH_FIELDS);
  const patch: DepartmentPatch = {};

  if ("name" in body) {
    const name = readName(body.name, details);
    if (name !== undefined) patch.name = name;
  }
  if ("position" in body) {
    const position = readPosition(body.position, details);
    if (position !== undefined) patch.position = position;
  }
  if ("archived" in body) {
    if (typeof body.archived === "boolean") {
      patch.archived = body.archived;
    } else {
      details.push({ field: "archived", issue: "invalid_value" });
    }
  }

  if (details.length === 0 && Object.keys(patch).length === 0) {
    details.push({ field: "body", issue: "required" });
  }
  return details.length > 0
    ? { ok: false, details }
    : { ok: true, data: patch };
}
