/**
 * Dạng dữ liệu nhật ký trả về qua GET /api/v1/projects/{id}/activity và /api/v1/tasks/{id}/activity
 * (Story E6-2, FR-16), cùng phần lược `changes` thô của public.activity_logs.
 *
 * Nguyên tắc (security.md, database.md mục activity_logs):
 *   - Chỉ trả các trường trong danh sách cho phép theo từng loại đối tượng (ACTIVITY_FIELDS). Cột
 *     mới thêm vào bảng nguồn sau này KHÔNG tự lộ ra API; muốn hiện phải thêm vào đây.
 *   - Mô tả (task, dự án) có thể dài và chứa nội dung nội bộ: chỉ báo "đã sửa", không trả nội dung.
 *   - Giá trị là id (trạng thái, loại, người, task cha) được đổi thành tham chiếu {id, name}; tên
 *     lấy từ dữ liệu HIỆN CÓ người gọi đọc được (RLS). Đối tượng đã bị xóa thì name = null (giao
 *     diện ghi "đã xóa"), không đoán. Riêng tên task đã xóa lấy lại từ `changes` của bản ghi xóa
 *     (giá trị đã lưu trong nhật ký, không phải dữ liệu đã mất).
 *   - Email chỉ có khi người gọi được thấy: Admin, hoặc người đó đang là thành viên của dự án
 *     (người gọi là PM của dự án nên cùng dự án). Ngoài ra email = null.
 */

export const ACTIVITY_ENTITY_TYPES = [
  "task",
  "project",
  "project_member",
] as const;
export type ActivityEntityType = (typeof ACTIVITY_ENTITY_TYPES)[number];

export const ACTIVITY_ACTIONS = ["create", "update", "delete"] as const;
export type ActivityAction = (typeof ACTIVITY_ACTIONS)[number];

/** Cách hiểu giá trị của một trường. */
export type ActivityFieldKind =
  | "text"
  | "date"
  | "priority"
  | "project_status"
  | "role"
  | "status"
  | "type"
  | "person"
  | "task"
  | "redacted";

/** Trường được phép hiện, theo loại đối tượng, theo thứ tự hiển thị. */
export const ACTIVITY_FIELDS = {
  task: {
    title: "text",
    status_id: "status",
    assignee_id: "person",
    priority: "priority",
    type_id: "type",
    start_date: "date",
    due_date: "date",
    parent_id: "task",
    description: "redacted",
  },
  project: {
    name: "text",
    status: "project_status",
    start_date: "date",
    end_date: "date",
    description: "redacted",
  },
  project_member: {
    role: "role",
  },
} as const satisfies Record<
  ActivityEntityType,
  Record<string, ActivityFieldKind>
>;

export type ActivityField =
  | keyof (typeof ACTIVITY_FIELDS)["task"]
  | keyof (typeof ACTIVITY_FIELDS)["project"]
  | keyof (typeof ACTIVITY_FIELDS)["project_member"];

export function fieldKind(
  entityType: ActivityEntityType,
  field: string,
): ActivityFieldKind | null {
  const fields = ACTIVITY_FIELDS[entityType] as Record<
    string,
    ActivityFieldKind
  >;
  return Object.prototype.hasOwnProperty.call(fields, field)
    ? fields[field]
    : null;
}

const PRIORITIES = ["low", "medium", "high", "urgent"] as const;
const PROJECT_STATUSES = ["active", "archived"] as const;
const ROLES = ["pm", "member", "viewer"] as const;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Độ dài tối đa của giá trị chữ trả về (tên task tối đa 500 ký tự theo CHECK). */
export const ACTIVITY_TEXT_MAX = 500;

/** Người (người làm, người được giao, thành viên). full_name null: hồ sơ không còn hoặc không đọc được. */
export interface ActivityPerson {
  id: string;
  full_name: string | null;
  email: string | null;
}

/** Tham chiếu trạng thái, loại, task. name null: đối tượng đã bị xóa. */
export interface ActivityRef {
  id: string;
  name: string | null;
}

export type ActivityValue = string | ActivityRef | ActivityPerson | null;

export interface ActivityChange {
  field: ActivityField;
  kind: ActivityFieldKind;
  before: ActivityValue;
  after: ActivityValue;
}

export interface ActivityEntry {
  id: number;
  created_at: string;
  action: ActivityAction;
  entity_type: ActivityEntityType;
  entity_id: string;
  /** Tên đối tượng: tên task, tên dự án, họ tên thành viên. null nếu không còn biết. */
  entity_name: string | null;
  /** Người làm; null: hệ thống (service_role, migration, tác vụ nền). */
  actor: ActivityPerson | null;
  /**
   * Thay đổi đã lược. Sửa: các trường đã đổi. Tạo: các trường có giá trị lúc tạo (trừ tên).
   * Xóa: rỗng.
   */
  changes: ActivityChange[];
}

export interface ActivityListResponse {
  data: ActivityEntry[];
  next_cursor: string | null;
}

/** Dòng đọc từ public.activity_logs. */
export interface ActivityRow {
  id: number;
  created_at: string;
  actor_id: string | null;
  entity_type: string;
  entity_id: string;
  action: string;
  changes: unknown;
}

export const ACTIVITY_SELECT =
  "id, created_at, actor_id, entity_type, entity_id, action, changes";

/** Giá trị thô một trường đã lọc kiểu (chưa đổi id sang tên). */
type RawValue = string | null;

interface RawChange {
  field: ActivityField;
  kind: ActivityFieldKind;
  before: RawValue;
  after: RawValue;
}

export interface SanitizedRow {
  id: number;
  created_at: string;
  action: ActivityAction;
  entity_type: ActivityEntityType;
  entity_id: string;
  actor_id: string | null;
  /** Tên đối tượng lưu trong chính bản ghi (title/name ở after, rồi before). */
  stored_name: string | null;
  changes: RawChange[];
}

function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Lọc một giá trị thô theo kiểu trường; sai kiểu thì null (không trả dữ liệu lạ). */
export function rawValue(kind: ActivityFieldKind, value: unknown): RawValue {
  if (typeof value !== "string") return null;
  switch (kind) {
    case "text":
      return value.slice(0, ACTIVITY_TEXT_MAX);
    case "date":
      return DATE_PATTERN.test(value) ? value : null;
    case "priority":
      return (PRIORITIES as readonly string[]).includes(value) ? value : null;
    case "project_status":
      return (PROJECT_STATUSES as readonly string[]).includes(value)
        ? value
        : null;
    case "role":
      return (ROLES as readonly string[]).includes(value) ? value : null;
    case "status":
    case "type":
    case "person":
    case "task":
      return UUID_PATTERN.test(value) ? value.toLowerCase() : null;
    case "redacted":
      return null;
  }
}

function storedName(
  entityType: ActivityEntityType,
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
): string | null {
  const key =
    entityType === "task" ? "title" : entityType === "project" ? "name" : null;
  if (!key) return null;
  for (const side of [after, before]) {
    const v = side?.[key];
    if (typeof v === "string" && v.trim() !== "") {
      return v.slice(0, ACTIVITY_TEXT_MAX);
    }
  }
  return null;
}

/**
 * Bản ghi thô → các trường được phép. Bản ghi sai dạng (loại/hành động lạ) trả null để bỏ qua
 * thay vì làm hỏng cả trang.
 */
export function sanitizeRow(row: ActivityRow): SanitizedRow | null {
  const entityType = row.entity_type as ActivityEntityType;
  const action = row.action as ActivityAction;
  if (!ACTIVITY_ENTITY_TYPES.includes(entityType)) return null;
  if (!ACTIVITY_ACTIONS.includes(action)) return null;
  const changes = asObject(row.changes);
  const before = asObject(changes?.before);
  const after = asObject(changes?.after);

  const out: RawChange[] = [];
  if (action !== "delete") {
    const fields = ACTIVITY_FIELDS[entityType] as Record<
      string,
      ActivityFieldKind
    >;
    for (const [field, kind] of Object.entries(fields)) {
      const inAfter = after !== null && field in after;
      if (!inAfter) continue;
      // Tạo mới: tên đã nằm ở entity_name, mô tả không cần nhắc; bỏ trường trống.
      if (action === "create") {
        if (field === "title" || field === "name" || kind === "redacted") {
          continue;
        }
        if (after[field] === null || after[field] === undefined) continue;
      }
      out.push({
        field: field as ActivityField,
        kind,
        before: action === "create" ? null : rawValue(kind, before?.[field]),
        after: rawValue(kind, after[field]),
      });
    }
  }

  return {
    id: Number(row.id),
    created_at: row.created_at,
    action,
    entity_type: entityType,
    entity_id: String(row.entity_id).toLowerCase(),
    actor_id: row.actor_id ? String(row.actor_id).toLowerCase() : null,
    stored_name: storedName(entityType, before, after),
    changes: out,
  };
}

/** Các id cần tra tên, gom theo bảng. */
export interface RefIds {
  people: Set<string>;
  statuses: Set<string>;
  types: Set<string>;
  tasks: Set<string>;
}

export function collectRefIds(rows: readonly SanitizedRow[]): RefIds {
  const ids: RefIds = {
    people: new Set(),
    statuses: new Set(),
    types: new Set(),
    tasks: new Set(),
  };
  for (const row of rows) {
    if (row.actor_id) ids.people.add(row.actor_id);
    if (row.entity_type === "project_member") ids.people.add(row.entity_id);
    if (row.entity_type === "task") ids.tasks.add(row.entity_id);
    for (const c of row.changes) {
      const set =
        c.kind === "person"
          ? ids.people
          : c.kind === "status"
            ? ids.statuses
            : c.kind === "type"
              ? ids.types
              : c.kind === "task"
                ? ids.tasks
                : null;
      if (!set) continue;
      if (c.before) set.add(c.before);
      if (c.after) set.add(c.after);
    }
  }
  return ids;
}

/** Tên đã tra được (chỉ những gì người gọi đọc được). Thiếu khóa = không còn/không thấy. */
export interface RefNames {
  people: Map<string, { full_name: string | null; email: string | null }>;
  statuses: Map<string, string>;
  types: Map<string, string>;
  tasks: Map<string, string>;
  /** Tên dự án hiện tại (cho bản ghi loại project không lưu tên). */
  projectName: string | null;
}

function person(id: string, names: RefNames): ActivityPerson {
  const p = names.people.get(id);
  return {
    id,
    full_name: p?.full_name?.trim() || null,
    email: p?.email ?? null,
  };
}

function resolve(
  kind: ActivityFieldKind,
  value: RawValue,
  names: RefNames,
): ActivityValue {
  if (value === null) return null;
  switch (kind) {
    case "person":
      return person(value, names);
    case "status":
      return { id: value, name: names.statuses.get(value) ?? null };
    case "type":
      return { id: value, name: names.types.get(value) ?? null };
    case "task":
      return { id: value, name: names.tasks.get(value) ?? null };
    default:
      return value;
  }
}

/** Ghép bản ghi đã lược với tên tra được thành phần tử trả về. */
export function toEntry(row: SanitizedRow, names: RefNames): ActivityEntry {
  let entityName: string | null;
  if (row.entity_type === "task") {
    // Tên lưu trong bản ghi (lúc tạo, lúc đổi tên, lúc xóa) đúng với thời điểm đó; không có thì
    // dùng tên hiện tại, rồi tên trong bản ghi xóa (names.tasks đã gộp sẵn).
    entityName = row.stored_name ?? names.tasks.get(row.entity_id) ?? null;
  } else if (row.entity_type === "project") {
    entityName = row.stored_name ?? names.projectName;
  } else {
    entityName = person(row.entity_id, names).full_name;
  }
  return {
    id: row.id,
    created_at: row.created_at,
    action: row.action,
    entity_type: row.entity_type,
    entity_id: row.entity_id,
    entity_name: entityName,
    actor: row.actor_id ? person(row.actor_id, names) : null,
    changes: row.changes.map((c) => ({
      field: c.field,
      kind: c.kind,
      before: resolve(c.kind, c.before, names),
      after: resolve(c.kind, c.after, names),
    })),
  };
}
