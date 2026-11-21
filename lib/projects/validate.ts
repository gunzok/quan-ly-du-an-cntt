import type { ApiErrorDetail } from "@/lib/api/errors";
import {
  isPlainObject,
  isUuid,
  unknownFields,
  type Validation,
} from "@/lib/api/request";
import {
  decodeTaskCursor,
  encodeTaskCursor,
  isDateOrderValid,
  isIsoDate,
  type TaskCursor,
} from "@/lib/tasks/validate";
import { DESCRIPTION_MAX_LENGTH, NAME_MAX_LENGTH } from "./constants";
import { PROJECT_STATUSES, type ProjectStatus } from "./model";

/**
 * Schema phía máy chủ cho /api/v1/projects và /api/v1/projects/{id} (viết tay như lib/tasks).
 * Từ chối trường lạ (`unknown_field`). Giới hạn độ dài khớp ràng buộc CHECK của bảng projects
 * (projects_name_not_blank, projects_description_length).
 *
 * Tạo có thể kèm `template_id` (uuid hoặc null, Story E7-1): nhân bản cấu trúc template trong cùng
 * giao dịch (public.create_project_from_template). Chỉ nhận khi TẠO; PATCH gửi lên là `unknown_field`.
 * Tạo mới luôn ở trạng thái `active`; lưu trữ, khôi phục bằng PATCH `status`.
 */

export { DESCRIPTION_MAX_LENGTH, NAME_MAX_LENGTH };
export const Q_MAX_LENGTH = 200;
export const PROJECT_BODY_MAX_BYTES = 32 * 1024;
export const LIST_LIMIT_DEFAULT = 24;
export const LIST_LIMIT_MAX = 100;

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
const DESCRIPTION_FORBIDDEN = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

export { isDateOrderValid };

export type ProjectCursor = TaskCursor;
export const encodeProjectCursor = encodeTaskCursor;
export const decodeProjectCursor = decodeTaskCursor;

type Reader<T> = (value: unknown, details: ApiErrorDetail[]) => T | undefined;

const readName: Reader<string> = (value, details) => {
  if (value === undefined || value === null) {
    details.push({ field: "name", issue: "required" });
    return undefined;
  }
  if (typeof value !== "string") {
    details.push({ field: "name", issue: "invalid_value" });
    return undefined;
  }
  const name = value.trim();
  if (name === "") {
    details.push({ field: "name", issue: "required" });
  } else if (name.length > NAME_MAX_LENGTH) {
    details.push({ field: "name", issue: "too_long" });
  } else if (CONTROL_CHARS.test(name)) {
    details.push({ field: "name", issue: "invalid_format" });
  } else {
    return name;
  }
  return undefined;
};

const readDescription: Reader<string | null> = (value, details) => {
  if (value === null) return null;
  if (typeof value !== "string") {
    details.push({ field: "description", issue: "invalid_value" });
    return undefined;
  }
  if (value.trim() === "") return null;
  if (value.length > DESCRIPTION_MAX_LENGTH) {
    details.push({ field: "description", issue: "too_long" });
    return undefined;
  }
  if (DESCRIPTION_FORBIDDEN.test(value)) {
    details.push({ field: "description", issue: "invalid_format" });
    return undefined;
  }
  return value;
};

function readDate(field: string): Reader<string | null> {
  return (value, details) => {
    if (value === null) return null;
    if (isIsoDate(value)) return value;
    details.push({ field, issue: "invalid_format" });
    return undefined;
  };
}

function isProjectStatus(value: unknown): value is ProjectStatus {
  return (
    typeof value === "string" &&
    (PROJECT_STATUSES as readonly string[]).includes(value)
  );
}

const readStatus: Reader<ProjectStatus> = (value, details) => {
  if (isProjectStatus(value)) return value;
  details.push({ field: "status", issue: "invalid_value" });
  return undefined;
};

// ---------------------------------------------------------------------------
// POST /api/v1/projects
// ---------------------------------------------------------------------------
export interface ProjectCreateInput {
  name: string;
  description: string | null;
  start_date: string | null;
  end_date: string | null;
  /** Template dự án để nhân bản (E7-1); null: dự án trống. */
  template_id: string | null;
}

const EDIT_FIELDS = ["name", "description", "start_date", "end_date"] as const;
const CREATE_FIELDS = [...EDIT_FIELDS, "template_id"] as const;

export function validateProjectCreate(
  body: unknown,
): Validation<ProjectCreateInput> {
  if (!isPlainObject(body)) {
    return { ok: false, details: [{ field: "body", issue: "invalid_format" }] };
  }
  const details = unknownFields(Object.keys(body), CREATE_FIELDS);
  const name = readName(body.name, details);
  const input: ProjectCreateInput = {
    name: name ?? "",
    description: null,
    start_date: null,
    end_date: null,
    template_id: null,
  };
  if (body.template_id !== undefined && body.template_id !== null) {
    if (isUuid(body.template_id))
      input.template_id = body.template_id.toLowerCase();
    else details.push({ field: "template_id", issue: "invalid_format" });
  }
  if (body.description !== undefined) {
    input.description = readDescription(body.description, details) ?? null;
  }
  if (body.start_date !== undefined) {
    input.start_date = readDate("start_date")(body.start_date, details) ?? null;
  }
  if (body.end_date !== undefined) {
    input.end_date = readDate("end_date")(body.end_date, details) ?? null;
  }
  return details.length > 0
    ? { ok: false, details }
    : { ok: true, data: input };
}

// ---------------------------------------------------------------------------
// PATCH /api/v1/projects/{id}: chỉ trường có mặt mới đổi; null xóa giá trị (trừ name, status).
// ---------------------------------------------------------------------------
export interface ProjectPatch {
  name?: string;
  description?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  status?: ProjectStatus;
}

const PATCH_FIELDS = [...EDIT_FIELDS, "status"] as const;

export function validateProjectPatch(body: unknown): Validation<ProjectPatch> {
  if (!isPlainObject(body)) {
    return { ok: false, details: [{ field: "body", issue: "invalid_format" }] };
  }
  const details = unknownFields(Object.keys(body), PATCH_FIELDS);
  const patch: ProjectPatch = {};
  const set = <K extends keyof ProjectPatch>(
    key: K,
    value: ProjectPatch[K] | undefined,
  ) => {
    if (value !== undefined) patch[key] = value;
  };

  if ("name" in body) set("name", readName(body.name, details));
  if ("description" in body)
    set("description", readDescription(body.description, details));
  if ("start_date" in body)
    set("start_date", readDate("start_date")(body.start_date, details));
  if ("end_date" in body)
    set("end_date", readDate("end_date")(body.end_date, details));
  if ("status" in body) set("status", readStatus(body.status, details));

  if (details.length === 0 && Object.keys(patch).length === 0) {
    details.push({ field: "body", issue: "required" });
  }
  return details.length > 0
    ? { ok: false, details }
    : { ok: true, data: patch };
}

// ---------------------------------------------------------------------------
// GET /api/v1/projects?status=&q=&limit=&cursor=
// Sắp xếp: mới tạo trước (created_at giảm dần, id giảm dần). status mặc định `active`.
// ---------------------------------------------------------------------------
export interface ProjectListQuery {
  status: ProjectStatus;
  q: string | null;
  limit: number;
  cursor: ProjectCursor | null;
}

const LIST_PARAMS = ["status", "q", "limit", "cursor"] as const;

export function validateProjectListQuery(
  params: URLSearchParams,
): Validation<ProjectListQuery> {
  const details = unknownFields(new Set(params.keys()), LIST_PARAMS);
  for (const name of LIST_PARAMS) {
    if (params.getAll(name).length > 1) {
      details.push({ field: name, issue: "invalid_value" });
    }
  }
  const query: ProjectListQuery = {
    status: "active",
    q: null,
    limit: LIST_LIMIT_DEFAULT,
    cursor: null,
  };

  const rawStatus = params.get("status");
  if (rawStatus !== null) {
    query.status = readStatus(rawStatus, details) ?? "active";
  }

  const rawQ = params.get("q");
  if (rawQ !== null) {
    const trimmed = rawQ.trim();
    if (trimmed.length > Q_MAX_LENGTH) {
      details.push({ field: "q", issue: "too_long" });
    } else if (CONTROL_CHARS.test(trimmed)) {
      details.push({ field: "q", issue: "invalid_format" });
    } else {
      query.q = trimmed === "" ? null : trimmed;
    }
  }

  const rawLimit = params.get("limit");
  if (rawLimit !== null) {
    const n = /^\d{1,3}$/.test(rawLimit) ? Number(rawLimit) : NaN;
    if (!Number.isInteger(n) || n < 1 || n > LIST_LIMIT_MAX) {
      details.push({ field: "limit", issue: "invalid_value" });
    } else {
      query.limit = n;
    }
  }

  const rawCursor = params.get("cursor");
  if (rawCursor !== null) {
    query.cursor = decodeProjectCursor(rawCursor);
    if (!query.cursor)
      details.push({ field: "cursor", issue: "invalid_format" });
  }

  return details.length > 0
    ? { ok: false, details }
    : { ok: true, data: query };
}

/**
 * Mẫu ILIKE "chứa chuỗi" cho bộ lọc tên: thoát dấu gạch ngược, `%`, `_` để từ khóa không thành ký tự đại
 * diện. PostgREST luôn đổi `*` thành `%` trong like/ilike và không có cách thoát, nên `*` bị bỏ
 * khỏi từ khóa (tên dự án hiếm khi có dấu sao).
 */
export function namePattern(q: string): string {
  const escaped = q.replace(/\*/g, "").replace(/[\\%_]/g, (c) => `\\${c}`);
  return `*${escaped}*`;
}
