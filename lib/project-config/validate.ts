import type { ApiErrorDetail } from "@/lib/api/errors";
import {
  isPlainObject,
  isUuid,
  unknownFields,
  type Validation,
} from "@/lib/api/request";
import {
  STATUS_CATEGORIES,
  type ConfigKind,
  type StatusCategory,
} from "./model";

/**
 * Schema phía máy chủ cho /api/v1/projects/{id}/{statuses|task-types|labels},
 * /api/v1/{statuses|task-types|labels}/{id} và GET /api/v1/task-types?project_id= (viết tay,
 * không thêm thư viện). Từ chối trường lạ (`unknown_field`), không tin kiểu từ trình duyệt.
 * Giới hạn khớp ràng buộc CHECK trong migration 20261115130000_task_statuses_types_labels.sql.
 */

export const CONFIG_NAME_MAX_LENGTH = 100;
/** |position| tối đa: đủ cho nhiều lần chèn giữa, chặn giá trị vô lý. */
export const CONFIG_POSITION_MAX_ABS = 1e9;
export const CONFIG_BODY_MAX_BYTES = 2048;

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
const COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

/** Cắt hai đầu, gộp khoảng trắng liên tiếp. */
export function normalizeConfigName(value: string): string {
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
  if (CONTROL_CHARS.test(value.replace(/[\t\n\r]/g, " "))) {
    details.push({ field: "name", issue: "invalid_format" });
    return undefined;
  }
  const name = normalizeConfigName(value);
  if (name === "") {
    details.push({ field: "name", issue: "required" });
    return undefined;
  }
  if (name.length > CONFIG_NAME_MAX_LENGTH) {
    details.push({ field: "name", issue: "too_long" });
    return undefined;
  }
  return name;
}

function readColor(
  value: unknown,
  details: ApiErrorDetail[],
): string | undefined {
  if (typeof value === "string" && COLOR_PATTERN.test(value)) {
    return value.toUpperCase();
  }
  details.push({ field: "color", issue: "invalid_format" });
  return undefined;
}

function readCategory(
  value: unknown,
  details: ApiErrorDetail[],
): StatusCategory | undefined {
  if (
    typeof value === "string" &&
    (STATUS_CATEGORIES as readonly string[]).includes(value)
  ) {
    return value as StatusCategory;
  }
  details.push({
    field: "category",
    issue: value === undefined || value === null ? "required" : "invalid_value",
  });
  return undefined;
}

function readPosition(
  value: unknown,
  details: ApiErrorDetail[],
): number | undefined {
  if (
    typeof value === "number" &&
    Number.isFinite(value) &&
    Math.abs(value) <= CONFIG_POSITION_MAX_ABS
  ) {
    return value;
  }
  details.push({ field: "position", issue: "invalid_value" });
  return undefined;
}

function readBoolean(
  field: string,
  value: unknown,
  details: ApiErrorDetail[],
): boolean | undefined {
  if (typeof value === "boolean") return value;
  details.push({ field, issue: "invalid_value" });
  return undefined;
}

/** Dữ liệu ghi vào bảng (tên cột). position thiếu khi tạo: nơi gọi xếp cuối danh sách. */
export interface ConfigWrite {
  name?: string;
  color?: string;
  category?: StatusCategory;
  is_milestone?: boolean;
  position?: number;
}

const FIELDS: Record<ConfigKind, readonly string[]> = {
  statuses: ["name", "category", "color", "position"],
  "task-types": ["name", "is_milestone", "color", "position"],
  labels: ["name", "color"],
};

function readFields(
  kind: ConfigKind,
  body: Record<string, unknown>,
  details: ApiErrorDetail[],
  mode: "create" | "patch",
): ConfigWrite {
  const out: ConfigWrite = {};
  const has = (key: string) =>
    mode === "create" ? body[key] !== undefined : key in body;

  if (mode === "create" || "name" in body) {
    const name = readName(body.name, details);
    if (name !== undefined) out.name = name;
  }
  if (kind === "statuses" && (mode === "create" || "category" in body)) {
    const category = readCategory(body.category, details);
    if (category !== undefined) out.category = category;
  }
  if (has("color")) {
    const color = readColor(body.color, details);
    if (color !== undefined) out.color = color;
  }
  if (kind === "task-types" && has("is_milestone")) {
    const value = readBoolean("is_milestone", body.is_milestone, details);
    if (value !== undefined) out.is_milestone = value;
  }
  if (kind !== "labels" && has("position")) {
    const position = readPosition(body.position, details);
    if (position !== undefined) out.position = position;
  }
  return out;
}

/** POST /api/v1/projects/{id}/{kind}. */
export function validateConfigCreate(
  kind: ConfigKind,
  body: unknown,
): Validation<ConfigWrite & { name: string }> {
  if (!isPlainObject(body)) {
    return { ok: false, details: [{ field: "body", issue: "invalid_format" }] };
  }
  const details = unknownFields(Object.keys(body), FIELDS[kind]);
  const data = readFields(kind, body, details, "create");
  return details.length > 0
    ? { ok: false, details }
    : { ok: true, data: { ...data, name: data.name ?? "" } };
}

/** PATCH /api/v1/{kind}/{id}: chỉ trường có mặt mới đổi; phải có ít nhất một trường. */
export function validateConfigPatch(
  kind: ConfigKind,
  body: unknown,
): Validation<ConfigWrite> {
  if (!isPlainObject(body)) {
    return { ok: false, details: [{ field: "body", issue: "invalid_format" }] };
  }
  const details = unknownFields(Object.keys(body), FIELDS[kind]);
  const data = readFields(kind, body, details, "patch");
  if (details.length === 0 && Object.keys(data).length === 0) {
    details.push({ field: "body", issue: "required" });
  }
  return details.length > 0 ? { ok: false, details } : { ok: true, data };
}

function singleParams(
  params: URLSearchParams,
  allowed: readonly string[],
): ApiErrorDetail[] {
  const details = unknownFields(new Set(params.keys()), allowed);
  for (const name of allowed) {
    if (params.getAll(name).length > 1) {
      details.push({ field: name, issue: "invalid_value" });
    }
  }
  return details;
}

/** GET danh sách theo dự án: không nhận tham số nào. */
export function validateConfigListQuery(
  params: URLSearchParams,
): Validation<null> {
  const details = singleParams(params, []);
  return details.length > 0 ? { ok: false, details } : { ok: true, data: null };
}

/** GET /api/v1/task-types?project_id=<uuid> (api-contract.md): project_id bắt buộc. */
export function validateTaskTypesQuery(
  params: URLSearchParams,
): Validation<{ project_id: string }> {
  const details = singleParams(params, ["project_id"]);
  const raw = params.get("project_id");
  if (raw === null) {
    details.push({ field: "project_id", issue: "required" });
  } else if (!isUuid(raw)) {
    details.push({ field: "project_id", issue: "invalid_format" });
  }
  return details.length > 0
    ? { ok: false, details }
    : { ok: true, data: { project_id: (raw as string).toLowerCase() } };
}

/**
 * DELETE /api/v1/{kind}/{id}?replace_with=<uuid>. Chỉ trạng thái và loại task nhận replace_with
 * (chuyển task đang dùng sang mục khác, AC2); nhãn không nhận tham số nào.
 */
export function validateConfigDeleteQuery(
  kind: ConfigKind,
  params: URLSearchParams,
): Validation<{ replace_with: string | null }> {
  const allowed = kind === "labels" ? [] : ["replace_with"];
  const details = singleParams(params, allowed);
  const raw = kind === "labels" ? null : params.get("replace_with");
  if (raw !== null && !isUuid(raw)) {
    details.push({ field: "replace_with", issue: "invalid_format" });
  }
  return details.length > 0
    ? { ok: false, details }
    : { ok: true, data: { replace_with: raw ? raw.toLowerCase() : null } };
}
