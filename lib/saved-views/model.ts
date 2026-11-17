import type { TaskPriority } from "@/lib/tasks/model";

/**
 * Chế độ xem đã lưu (Story E13-1, QLDA-53; FR-19, BR-12). Trường trùng tên cột bảng
 * public.saved_views (migration 20261115210000_saved_views.sql); `is_favorite` lấy từ
 * public.saved_view_favorites (của riêng người gọi), `can_edit` tính theo quyền người gọi.
 *
 * Chế độ xem chỉ lưu CÁCH XEM (bộ lọc, sắp xếp, nhóm, cột, kiểu hiển thị), không lưu danh sách
 * task: khi dùng, gọi GET /api/v1/projects/{id}/tasks bằng phiên của người mở (xem ./apply.ts),
 * nên RLS của tasks quyết định họ thấy gì (BR-12).
 *
 * Mọi danh sách giá trị dưới đây phải trùng private.saved_view_query_is_valid trong migration.
 */

/** Tên tối đa (ký tự, sau khi chuẩn hóa); khớp CHECK saved_views_name_length. */
export const SAVED_VIEW_NAME_MAX_LENGTH = 100;
export const SAVED_VIEW_QUERY_VERSION = 1;
export const SAVED_VIEW_BODY_MAX_BYTES = 8 * 1024;

export type SavedViewVisibility = "private" | "public";
export const SAVED_VIEW_VISIBILITIES: readonly SavedViewVisibility[] = [
  "private",
  "public",
];

/** Bộ lọc: đúng các tham số lọc của API danh sách task (lib/tasks/validate.ts). */
export const VIEW_FILTER_KEYS = [
  "q",
  "status_id",
  "assignee_id",
  "priority",
  "label_id",
  "due_after",
  "due_before",
  // E13-2 (migration 20261115290000): chế độ xem mặc định.
  "created_by",
  "open",
  "overdue",
] as const;
/** Bộ lọc dạng cờ: chỉ nhận `true` (JSON boolean trong query, `true` trên URL). */
export const VIEW_FLAG_FILTERS = ["open", "overdue"] as const;
/** Giá trị người dùng đặc biệt: người đang mở chế độ xem. */
export const VIEW_ME = "me";
export type ViewFilterKey = (typeof VIEW_FILTER_KEYS)[number];

export const VIEW_SORT_FIELDS = [
  "created_at",
  "updated_at",
  "title",
  "priority",
  "status_id",
  "type_id",
  "assignee_id",
  "start_date",
  "due_date",
  "position",
] as const;
export type ViewSortField = (typeof VIEW_SORT_FIELDS)[number];
export const VIEW_SORT_MAX = 3;

/** `label_ids` (E3-2, migration 20261115260000): task nhiều nhãn hiện ở mỗi nhóm nhãn của nó. */
export const VIEW_GROUP_BY = [
  "status_id",
  "type_id",
  "assignee_id",
  "priority",
  "label_ids",
] as const;
export type ViewGroupBy = (typeof VIEW_GROUP_BY)[number];

export const VIEW_COLUMNS = [
  "title",
  "status_id",
  "type_id",
  "priority",
  "assignee_id",
  "created_by",
  "start_date",
  "due_date",
  "label_ids",
  "parent_id",
  "created_at",
  "updated_at",
  "completed_at",
] as const;
export type ViewColumn = (typeof VIEW_COLUMNS)[number];

/** Cột khi người gọi không gửi `columns`. */
export const DEFAULT_VIEW_COLUMNS: readonly ViewColumn[] = [
  "title",
  "status_id",
  "assignee_id",
  "priority",
  "due_date",
];

export const VIEW_DISPLAYS = ["list", "board", "gantt"] as const;
export type ViewDisplay = (typeof VIEW_DISPLAYS)[number];

export interface SavedViewFilters {
  q?: string;
  /** Khớp một trong các trạng thái; uuid chữ thường, bỏ trùng, sắp xếp. */
  status_id?: string[];
  /** uuid chữ thường hoặc `me` (E13-2). */
  assignee_id?: string;
  priority?: TaskPriority;
  label_id?: string;
  due_after?: string;
  due_before?: string;
  /** uuid chữ thường hoặc `me` (E13-2). */
  created_by?: string;
  /** Chỉ task chưa hoàn thành (E13-2). */
  open?: true;
  /** Chỉ task quá hạn: chưa hoàn thành, hạn trước hôm nay giờ Việt Nam (E13-2). */
  overdue?: true;
}

export interface SavedViewSort {
  field: ViewSortField;
  direction: "asc" | "desc";
}

/** Dạng đã chuẩn hóa, luôn đủ 6 khóa (CHECK trong CSDL đòi đủ). */
export interface SavedViewQuery {
  version: typeof SAVED_VIEW_QUERY_VERSION;
  filters: SavedViewFilters;
  sort: SavedViewSort[];
  group_by: ViewGroupBy | null;
  columns: ViewColumn[];
  display: ViewDisplay;
}

export interface SavedView {
  id: string;
  /** null chỉ với chế độ xem mặc định dùng chung mọi dự án. */
  project_id: string | null;
  /** null với chế độ xem mặc định (hệ thống tạo). */
  owner_id: string | null;
  name: string;
  query: SavedViewQuery;
  visibility: SavedViewVisibility;
  is_default: boolean;
  /** Người gọi đã đánh dấu yêu thích (của riêng từng người). */
  is_favorite: boolean;
  /** Người gọi được sửa, xóa (tên, query, công khai/riêng tư). */
  can_edit: boolean;
  created_at: string;
  updated_at: string;
}

/** Cột đọc: liệt kê tường minh, không dùng `*`. */
export const SAVED_VIEW_COLUMNS =
  "id, project_id, owner_id, name, query, visibility, is_default, created_at, updated_at";

export type SavedViewRow = Omit<SavedView, "is_favorite" | "can_edit">;

/** Thứ tự trong danh sách: mặc định trước, rồi theo tên tiếng Việt, rồi id. */
export function compareSavedViews(
  a: Pick<SavedView, "is_default" | "name" | "id">,
  b: Pick<SavedView, "is_default" | "name" | "id">,
): number {
  if (a.is_default !== b.is_default) return a.is_default ? -1 : 1;
  const byName = a.name.localeCompare(b.name, "vi");
  return byName !== 0 ? byName : a.id.localeCompare(b.id);
}
