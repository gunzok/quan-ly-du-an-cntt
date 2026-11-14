import type { ApiErrorDetail } from "@/lib/api/errors";
import {
  isPlainObject,
  isUuid,
  unknownFields,
  type Validation,
} from "@/lib/api/request";
import { TASK_PRIORITIES, type TaskPriority } from "./model";

/**
 * Schema phía máy chủ cho /api/v1/projects/{id}/tasks và /api/v1/tasks/{id} (viết tay, không
 * thêm thư viện). Từ chối trường lạ (`unknown_field`), không tin kiểu dữ liệu từ trình duyệt.
 * Giới hạn độ dài khớp ràng buộc CHECK trong migration 20261114090000_tasks.sql.
 *
 * Chưa nhận: parent_id (E2-4), status_id, type_id (E2-3), label_ids (E2-3): gửi lên là
 * `unknown_field`.
 */

export const TITLE_MAX_LENGTH = 500;
export const DESCRIPTION_MAX_LENGTH = 10_000;
/** |position| tối đa: đủ cho kéo thả chèn giữa nhiều lần, chặn giá trị vô lý. */
export const POSITION_MAX_ABS = 1e12;
/** Giới hạn thân request JSON (byte): mô tả 10.000 ký tự, mỗi ký tự tối đa 4 byte, cộng phần khác. */
export const TASK_BODY_MAX_BYTES = 48 * 1024;
export const LIST_LIMIT_DEFAULT = 50;
export const LIST_LIMIT_MAX = 100;
const CURSOR_MAX_LENGTH = 256;

// Ký tự điều khiển: không hợp lệ trong tên; trong mô tả chỉ cho tab và xuống dòng.
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
const DESCRIPTION_FORBIDDEN = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
// Dấu thời gian created_at do PostgREST trả về (ISO 8601 có múi giờ). Kiểm chặt vì giá trị này
// được đưa vào bộ lọc PostgREST khi phân trang.
const TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/;

/** Ngày dạng YYYY-MM-DD và là ngày có thật (không nhận 2026-02-30). */
export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const m = DATE_PATTERN.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < 1900 || y > 9999 || mo < 1 || mo > 12 || d < 1) return false;
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

/** BR-13: ngày kết thúc không sớm hơn ngày bắt đầu (thiếu một trong hai thì hợp lệ). */
export function isDateOrderValid(
  start: string | null | undefined,
  due: string | null | undefined,
): boolean {
  if (!start || !due) return true;
  return start <= due; // YYYY-MM-DD so sánh chuỗi đúng thứ tự thời gian
}

// ---------------------------------------------------------------------------
// Đọc từng trường
// ---------------------------------------------------------------------------
type Reader<T> = (value: unknown, details: ApiErrorDetail[]) => T | undefined;

const readTitle: Reader<string> = (value, details) => {
  if (value === undefined || value === null) {
    details.push({ field: "title", issue: "required" });
    return undefined;
  }
  if (typeof value !== "string") {
    details.push({ field: "title", issue: "invalid_value" });
    return undefined;
  }
  const title = value.trim();
  if (title === "") {
    details.push({ field: "title", issue: "required" });
  } else if (title.length > TITLE_MAX_LENGTH) {
    details.push({ field: "title", issue: "too_long" });
  } else if (CONTROL_CHARS.test(title)) {
    details.push({ field: "title", issue: "invalid_format" });
  } else {
    return title;
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

function readNullableUuid(field: string): Reader<string | null> {
  return (value, details) => {
    if (value === null) return null;
    if (isUuid(value)) return value.toLowerCase();
    details.push({ field, issue: "invalid_format" });
    return undefined;
  };
}

const readPriority: Reader<TaskPriority> = (value, details) => {
  if (
    typeof value === "string" &&
    (TASK_PRIORITIES as readonly string[]).includes(value)
  ) {
    return value as TaskPriority;
  }
  details.push({ field: "priority", issue: "invalid_value" });
  return undefined;
};

function readDate(field: string): Reader<string | null> {
  return (value, details) => {
    if (value === null) return null;
    if (isIsoDate(value)) return value;
    details.push({ field, issue: "invalid_format" });
    return undefined;
  };
}

const readPosition: Reader<number> = (value, details) => {
  if (
    typeof value === "number" &&
    Number.isFinite(value) &&
    Math.abs(value) <= POSITION_MAX_ABS
  ) {
    return value;
  }
  details.push({ field: "position", issue: "invalid_value" });
  return undefined;
};

// ---------------------------------------------------------------------------
// POST /api/v1/projects/{id}/tasks
// ---------------------------------------------------------------------------
export interface TaskCreateInput {
  title: string;
  description: string | null;
  assignee_id: string | null;
  priority?: TaskPriority;
  start_date: string | null;
  due_date: string | null;
  position?: number;
}

const CREATE_FIELDS = [
  "title",
  "description",
  "assignee_id",
  "priority",
  "start_date",
  "due_date",
  "position",
] as const;

export function validateTaskCreate(body: unknown): Validation<TaskCreateInput> {
  if (!isPlainObject(body)) {
    return { ok: false, details: [{ field: "body", issue: "invalid_format" }] };
  }
  const details = unknownFields(Object.keys(body), CREATE_FIELDS);
  const title = readTitle(body.title, details);
  const input: TaskCreateInput = {
    title: title ?? "",
    description: null,
    assignee_id: null,
    start_date: null,
    due_date: null,
  };
  if (body.description !== undefined) {
    input.description = readDescription(body.description, details) ?? null;
  }
  if (body.assignee_id !== undefined) {
    input.assignee_id =
      readNullableUuid("assignee_id")(body.assignee_id, details) ?? null;
  }
  if (body.priority !== undefined) {
    input.priority = readPriority(body.priority, details);
  }
  if (body.start_date !== undefined) {
    input.start_date = readDate("start_date")(body.start_date, details) ?? null;
  }
  if (body.due_date !== undefined) {
    input.due_date = readDate("due_date")(body.due_date, details) ?? null;
  }
  if (body.position !== undefined) {
    input.position = readPosition(body.position, details);
  }
  return details.length > 0
    ? { ok: false, details }
    : { ok: true, data: input };
}

// ---------------------------------------------------------------------------
// PATCH /api/v1/tasks/{id}: chỉ trường có mặt mới đổi; null xóa giá trị (trừ title, priority,
// position là bắt buộc có giá trị).
// ---------------------------------------------------------------------------
export interface TaskPatch {
  title?: string;
  description?: string | null;
  assignee_id?: string | null;
  priority?: TaskPriority;
  start_date?: string | null;
  due_date?: string | null;
  position?: number;
}

const PATCH_FIELDS = CREATE_FIELDS;

export function validateTaskPatch(body: unknown): Validation<TaskPatch> {
  if (!isPlainObject(body)) {
    return { ok: false, details: [{ field: "body", issue: "invalid_format" }] };
  }
  const details = unknownFields(Object.keys(body), PATCH_FIELDS);
  const patch: TaskPatch = {};
  const set = <K extends keyof TaskPatch>(
    key: K,
    value: TaskPatch[K] | undefined,
  ) => {
    if (value !== undefined) patch[key] = value;
  };

  if ("title" in body) set("title", readTitle(body.title, details));
  if ("description" in body)
    set("description", readDescription(body.description, details));
  if ("assignee_id" in body)
    set(
      "assignee_id",
      readNullableUuid("assignee_id")(body.assignee_id, details),
    );
  if ("priority" in body) set("priority", readPriority(body.priority, details));
  if ("start_date" in body)
    set("start_date", readDate("start_date")(body.start_date, details));
  if ("due_date" in body)
    set("due_date", readDate("due_date")(body.due_date, details));
  if ("position" in body) set("position", readPosition(body.position, details));

  if (details.length === 0 && Object.keys(patch).length === 0) {
    details.push({ field: "body", issue: "required" });
  }
  return details.length > 0
    ? { ok: false, details }
    : { ok: true, data: patch };
}

// ---------------------------------------------------------------------------
// GET /api/v1/projects/{id}/tasks?limit=&cursor=&assignee_id=&status_id=&priority=
// Sắp xếp mặc định: mới tạo trước (created_at giảm dần, id giảm dần). Tìm kiếm văn bản và bộ lọc
// đầy đủ (label_id, due_before, q, sort) là Story E3-3.
// ---------------------------------------------------------------------------
export interface TaskCursor {
  created_at: string;
  id: string;
}

export function encodeTaskCursor(cursor: TaskCursor): string {
  return Buffer.from(JSON.stringify([cursor.created_at, cursor.id])).toString(
    "base64url",
  );
}

export function decodeTaskCursor(raw: string): TaskCursor | null {
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
      isUuid(value[1])
    ) {
      return { created_at: value[0], id: value[1].toLowerCase() };
    }
  } catch {
    // rơi xuống null
  }
  return null;
}

export interface TaskListQuery {
  limit: number;
  cursor: TaskCursor | null;
  assignee_id: string | null;
  status_id: string | null;
  priority: TaskPriority | null;
}

const LIST_PARAMS = [
  "limit",
  "cursor",
  "assignee_id",
  "status_id",
  "priority",
] as const;

export function validateTaskListQuery(
  params: URLSearchParams,
): Validation<TaskListQuery> {
  const details = unknownFields(new Set(params.keys()), LIST_PARAMS);
  for (const name of LIST_PARAMS) {
    if (params.getAll(name).length > 1) {
      details.push({ field: name, issue: "invalid_value" });
    }
  }
  const query: TaskListQuery = {
    limit: LIST_LIMIT_DEFAULT,
    cursor: null,
    assignee_id: null,
    status_id: null,
    priority: null,
  };

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
    query.cursor = decodeTaskCursor(rawCursor);
    if (!query.cursor)
      details.push({ field: "cursor", issue: "invalid_format" });
  }

  for (const field of ["assignee_id", "status_id"] as const) {
    const raw = params.get(field);
    if (raw === null) continue;
    if (isUuid(raw)) {
      query[field] = raw.toLowerCase();
    } else {
      details.push({ field, issue: "invalid_format" });
    }
  }

  const rawPriority = params.get("priority");
  if (rawPriority !== null) {
    query.priority = readPriority(rawPriority, details) ?? null;
  }

  return details.length > 0
    ? { ok: false, details }
    : { ok: true, data: query };
}
