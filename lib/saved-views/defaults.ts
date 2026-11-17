import type { SavedViewQuery } from "./model";

/**
 * Bảy chế độ xem mặc định theo OpenProject (Story E13-2, QLDA-54; FR-19, S12). Seed bằng migration
 * 20261115290000_default_saved_views.sql thành dòng DÙNG CHUNG mọi dự án (is_default, owner_id và
 * project_id null, công khai); mọi giá trị ở đây phải trùng migration (test tích hợp so từng dòng).
 *
 * id cố định để giao diện dịch tên theo ngôn ngữ (tên trong CSDL là tiếng Việt) và để link
 * `?view={id}` giống nhau ở mọi môi trường. Thứ tự mảng là thứ tự hiển thị (như OpenProject).
 */
export const DEFAULT_VIEW_KEYS = [
  "allOpen",
  "latestActivity",
  "recentlyCreated",
  "overdue",
  "summary",
  "createdByMe",
  "assignedToMe",
] as const;
export type DefaultViewKey = (typeof DEFAULT_VIEW_KEYS)[number];

export interface DefaultViewDefinition {
  key: DefaultViewKey;
  id: string;
  /** Tên lưu trong CSDL (tiếng Việt). */
  name: string;
  query: SavedViewQuery;
}

const base = { version: 1, display: "list" } as const;

export const DEFAULT_VIEWS: readonly DefaultViewDefinition[] = [
  {
    key: "allOpen",
    id: "7e0d0000-0000-4000-8000-000000000001",
    name: "Tất cả đang mở",
    query: {
      ...base,
      filters: { open: true },
      sort: [],
      group_by: null,
      columns: ["title", "type_id", "status_id", "assignee_id", "due_date"],
    },
  },
  {
    key: "latestActivity",
    id: "7e0d0000-0000-4000-8000-000000000002",
    name: "Hoạt động gần nhất",
    query: {
      ...base,
      filters: { open: true },
      sort: [{ field: "updated_at", direction: "desc" }],
      group_by: null,
      columns: ["title", "type_id", "status_id", "assignee_id", "updated_at"],
    },
  },
  {
    key: "recentlyCreated",
    id: "7e0d0000-0000-4000-8000-000000000003",
    name: "Mới tạo",
    query: {
      ...base,
      filters: { open: true },
      sort: [{ field: "created_at", direction: "desc" }],
      group_by: null,
      columns: ["title", "type_id", "status_id", "assignee_id", "created_at"],
    },
  },
  {
    key: "overdue",
    id: "7e0d0000-0000-4000-8000-000000000004",
    name: "Quá hạn",
    query: {
      ...base,
      filters: { overdue: true },
      sort: [{ field: "due_date", direction: "asc" }],
      group_by: null,
      columns: ["title", "type_id", "status_id", "assignee_id", "due_date"],
    },
  },
  {
    key: "summary",
    id: "7e0d0000-0000-4000-8000-000000000005",
    name: "Tóm tắt",
    query: {
      ...base,
      filters: {},
      sort: [],
      group_by: "status_id",
      columns: [
        "title",
        "type_id",
        "status_id",
        "assignee_id",
        "priority",
        "due_date",
      ],
    },
  },
  {
    key: "createdByMe",
    id: "7e0d0000-0000-4000-8000-000000000006",
    name: "Tạo bởi tôi",
    query: {
      ...base,
      filters: { open: true, created_by: "me" },
      sort: [{ field: "created_at", direction: "desc" }],
      group_by: null,
      columns: [
        "title",
        "type_id",
        "status_id",
        "assignee_id",
        "due_date",
        "created_at",
      ],
    },
  },
  {
    key: "assignedToMe",
    id: "7e0d0000-0000-4000-8000-000000000007",
    name: "Giao cho tôi",
    query: {
      ...base,
      filters: { open: true, assignee_id: "me" },
      sort: [{ field: "due_date", direction: "asc" }],
      group_by: null,
      columns: ["title", "type_id", "status_id", "priority", "due_date"],
    },
  },
];

const BY_ID = new Map(DEFAULT_VIEWS.map((v) => [v.id, v]));

/** Khóa của chế độ xem mặc định dùng chung theo id; null nếu không phải. */
export function defaultViewKey(id: string): DefaultViewKey | null {
  return BY_ID.get(id)?.key ?? null;
}

/** Thứ tự hiển thị của chế độ xem mặc định (không phải mặc định dùng chung: sau cùng). */
export function defaultViewRank(id: string): number {
  const def = BY_ID.get(id);
  return def ? DEFAULT_VIEW_KEYS.indexOf(def.key) : DEFAULT_VIEW_KEYS.length;
}
