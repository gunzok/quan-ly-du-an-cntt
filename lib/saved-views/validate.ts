import type { ApiErrorDetail } from "@/lib/api/errors";
import {
  isPlainObject,
  isUuid,
  unknownFields,
  type Validation,
} from "@/lib/api/request";
import { validateTaskListQuery } from "@/lib/tasks/validate";
import { viewFiltersToSearchParams } from "./apply";
import {
  DEFAULT_VIEW_COLUMNS,
  SAVED_VIEW_NAME_MAX_LENGTH,
  SAVED_VIEW_QUERY_VERSION,
  SAVED_VIEW_VISIBILITIES,
  VIEW_COLUMNS,
  VIEW_DISPLAYS,
  VIEW_FILTER_KEYS,
  VIEW_GROUP_BY,
  VIEW_SORT_FIELDS,
  VIEW_SORT_MAX,
  type SavedViewFilters,
  type SavedViewQuery,
  type SavedViewSort,
  type SavedViewVisibility,
  type ViewColumn,
  type ViewDisplay,
  type ViewGroupBy,
} from "./model";

/**
 * Schema phía máy chủ cho /api/v1/projects/{id}/views và /api/v1/views/{id} (viết tay, không thêm
 * thư viện). Từ chối trường lạ ở mọi cấp (`unknown_field`); trường lỗi trong `query` báo theo
 * đường dẫn (`query.filters.status_id`, `query.sort`...).
 *
 * Bộ lọc kiểm bằng CHÍNH validateTaskListQuery (cùng quy tắc API danh sách task). id trạng thái,
 * nhãn, người chỉ kiểm định dạng uuid; thuộc dự án hay không thì lúc dùng mới có ý nghĩa.
 * Kết quả chuẩn hóa luôn đủ 6 khóa, khớp CHECK private.saved_view_query_is_valid.
 */

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
const QUERY_KEYS = [
  "version",
  "filters",
  "sort",
  "group_by",
  "columns",
  "display",
] as const;

function prefixed(prefix: string, details: ApiErrorDetail[]): ApiErrorDetail[] {
  return details.map((d) => ({ ...d, field: `${prefix}.${d.field}` }));
}

/** Cắt hai đầu, gộp khoảng trắng liên tiếp (giống tên trạng thái, nhãn). */
export function normalizeViewName(value: string): string {
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
  const name = normalizeViewName(value);
  if (name === "") {
    details.push({ field: "name", issue: "required" });
    return undefined;
  }
  if (name.length > SAVED_VIEW_NAME_MAX_LENGTH) {
    details.push({ field: "name", issue: "too_long" });
    return undefined;
  }
  return name;
}

function readVisibility(
  value: unknown,
  details: ApiErrorDetail[],
): SavedViewVisibility | undefined {
  if (
    typeof value === "string" &&
    (SAVED_VIEW_VISIBILITIES as readonly string[]).includes(value)
  ) {
    return value as SavedViewVisibility;
  }
  details.push({ field: "visibility", issue: "invalid_value" });
  return undefined;
}

function oneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
): value is T {
  return (
    typeof value === "string" && (allowed as readonly string[]).includes(value)
  );
}

function readFilters(
  value: unknown,
  details: ApiErrorDetail[],
): SavedViewFilters | undefined {
  const field = "query.filters";
  if (value === undefined) return {};
  if (!isPlainObject(value)) {
    details.push({ field, issue: "invalid_value" });
    return undefined;
  }
  const own = prefixed(
    field,
    unknownFields(Object.keys(value), VIEW_FILTER_KEYS),
  );
  // Kiểu: status_id là mảng uuid (không ghép chuỗi có dấu phẩy), còn lại là chuỗi.
  const raw: Record<string, string | string[]> = {};
  for (const key of VIEW_FILTER_KEYS) {
    const v = value[key];
    if (v === undefined) continue;
    if (key === "status_id") {
      if (!Array.isArray(v) || v.length === 0 || !v.every(isUuid)) {
        own.push({ field: `${field}.${key}`, issue: "invalid_value" });
      } else {
        raw[key] = v;
      }
    } else if (typeof v !== "string") {
      own.push({ field: `${field}.${key}`, issue: "invalid_value" });
    } else {
      raw[key] = v;
    }
  }
  if (own.length > 0) {
    details.push(...own);
    return undefined;
  }
  const parsed = validateTaskListQuery(viewFiltersToSearchParams(raw));
  if (!parsed.ok) {
    details.push(...prefixed(field, parsed.details));
    return undefined;
  }
  const p = parsed.data;
  const out: SavedViewFilters = {};
  if (p.q !== null) out.q = p.q;
  if (p.status_ids !== null) out.status_id = p.status_ids;
  if (p.assignee_id !== null) out.assignee_id = p.assignee_id;
  if (p.priority !== null) out.priority = p.priority;
  if (p.label_id !== null) out.label_id = p.label_id;
  if (p.due_after !== null) out.due_after = p.due_after;
  if (p.due_before !== null) out.due_before = p.due_before;
  return out;
}

function readSort(
  value: unknown,
  details: ApiErrorDetail[],
): SavedViewSort[] | undefined {
  if (value === undefined) return [];
  const field = "query.sort";
  if (!Array.isArray(value)) {
    details.push({ field, issue: "invalid_value" });
    return undefined;
  }
  if (value.length > VIEW_SORT_MAX) {
    details.push({ field, issue: "too_long" });
    return undefined;
  }
  const out: SavedViewSort[] = [];
  for (const item of value) {
    if (
      !isPlainObject(item) ||
      Object.keys(item).length !== 2 ||
      !oneOf(item.field, VIEW_SORT_FIELDS) ||
      !oneOf(item.direction, ["asc", "desc"] as const)
    ) {
      details.push({ field, issue: "invalid_value" });
      return undefined;
    }
    out.push({ field: item.field, direction: item.direction });
  }
  if (new Set(out.map((s) => s.field)).size !== out.length) {
    details.push({ field, issue: "invalid_value" });
    return undefined;
  }
  return out;
}

function readColumns(
  value: unknown,
  details: ApiErrorDetail[],
): ViewColumn[] | undefined {
  if (value === undefined) return [...DEFAULT_VIEW_COLUMNS];
  const field = "query.columns";
  if (
    !Array.isArray(value) ||
    !value.every((c) => oneOf(c, VIEW_COLUMNS)) ||
    new Set(value).size !== value.length
  ) {
    details.push({ field, issue: "invalid_value" });
    return undefined;
  }
  return value as ViewColumn[];
}

/** `query` của chế độ xem; khóa thiếu lấy mặc định, khóa lạ bị từ chối. */
export function readViewQuery(
  value: unknown,
  details: ApiErrorDetail[],
): SavedViewQuery | undefined {
  if (value === undefined || value === null) {
    details.push({ field: "query", issue: "required" });
    return undefined;
  }
  if (!isPlainObject(value)) {
    details.push({ field: "query", issue: "invalid_value" });
    return undefined;
  }
  const local = prefixed(
    "query",
    unknownFields(Object.keys(value), QUERY_KEYS),
  );

  if (
    value.version !== undefined &&
    value.version !== SAVED_VIEW_QUERY_VERSION
  ) {
    local.push({ field: "query.version", issue: "invalid_value" });
  }
  const filters = readFilters(value.filters, local);
  const sort = readSort(value.sort, local);
  let groupBy: ViewGroupBy | null = null;
  if (value.group_by !== undefined && value.group_by !== null) {
    if (oneOf(value.group_by, VIEW_GROUP_BY)) {
      groupBy = value.group_by;
    } else {
      local.push({ field: "query.group_by", issue: "invalid_value" });
    }
  }
  const columns = readColumns(value.columns, local);
  let display: ViewDisplay = "list";
  if (value.display !== undefined) {
    if (oneOf(value.display, VIEW_DISPLAYS)) {
      display = value.display;
    } else {
      local.push({ field: "query.display", issue: "invalid_value" });
    }
  }

  if (local.length > 0 || !filters || !sort || !columns) {
    details.push(...local);
    return undefined;
  }
  return {
    version: SAVED_VIEW_QUERY_VERSION,
    filters,
    sort,
    group_by: groupBy,
    columns,
    display,
  };
}

export interface SavedViewCreate {
  name: string;
  query: SavedViewQuery;
  visibility: SavedViewVisibility;
}

const CREATE_FIELDS = ["name", "query", "visibility"] as const;
const PATCH_FIELDS = ["name", "query", "visibility", "is_favorite"] as const;

/** POST /api/v1/projects/{id}/views. visibility mặc định `private`. */
export function validateViewCreate(body: unknown): Validation<SavedViewCreate> {
  if (!isPlainObject(body)) {
    return { ok: false, details: [{ field: "body", issue: "invalid_format" }] };
  }
  const details = unknownFields(Object.keys(body), CREATE_FIELDS);
  const name = readName(body.name, details);
  const query = readViewQuery(body.query, details);
  const visibility =
    body.visibility === undefined
      ? "private"
      : readVisibility(body.visibility, details);
  if (details.length > 0 || !name || !query || !visibility) {
    return { ok: false, details };
  }
  return { ok: true, data: { name, query, visibility } };
}

export interface SavedViewPatch {
  name?: string;
  query?: SavedViewQuery;
  visibility?: SavedViewVisibility;
  /** Dấu yêu thích của riêng người gọi; không cần quyền sửa chế độ xem. */
  is_favorite?: boolean;
}

/** PATCH /api/v1/views/{id}: chỉ trường có mặt mới đổi; phải có ít nhất một trường. */
export function validateViewPatch(body: unknown): Validation<SavedViewPatch> {
  if (!isPlainObject(body)) {
    return { ok: false, details: [{ field: "body", issue: "invalid_format" }] };
  }
  const details = unknownFields(Object.keys(body), PATCH_FIELDS);
  const out: SavedViewPatch = {};
  if ("name" in body) {
    const name = readName(body.name, details);
    if (name !== undefined) out.name = name;
  }
  if ("query" in body) {
    const query = readViewQuery(body.query, details);
    if (query !== undefined) out.query = query;
  }
  if ("visibility" in body) {
    const visibility = readVisibility(body.visibility, details);
    if (visibility !== undefined) out.visibility = visibility;
  }
  if ("is_favorite" in body) {
    if (typeof body.is_favorite === "boolean") {
      out.is_favorite = body.is_favorite;
    } else {
      details.push({ field: "is_favorite", issue: "invalid_value" });
    }
  }
  if (details.length === 0 && Object.keys(out).length === 0) {
    details.push({ field: "body", issue: "required" });
  }
  return details.length > 0 ? { ok: false, details } : { ok: true, data: out };
}

/** GET danh sách, GET một, DELETE: không nhận tham số nào. */
export function validateNoParams(params: URLSearchParams): Validation<null> {
  const details = unknownFields(new Set(params.keys()), []);
  return details.length > 0 ? { ok: false, details } : { ok: true, data: null };
}
