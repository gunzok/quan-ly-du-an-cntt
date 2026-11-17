import {
  DEFAULT_VIEW_COLUMNS,
  SAVED_VIEW_QUERY_VERSION,
  VIEW_COLUMNS,
  type SavedViewFilters,
  type SavedViewQuery,
  type SavedViewSort,
  type ViewColumn,
  type ViewGroupBy,
  type ViewSortField,
} from "@/lib/saved-views/model";
import { readViewQuery } from "@/lib/saved-views/validate";

/**
 * Trạng thái bảng phân cấp (Story E3-2, S04, S12). Cố ý dùng ĐÚNG lược đồ query v1 của chế độ xem
 * đã lưu (lib/saved-views/model.ts): bộ lọc, sắp xếp, nhóm, cột. E13-2/E13-3 lưu thẳng được bằng
 * toSavedViewQuery(), và mở một chế độ xem là fromSavedViewQuery(). Không có trường riêng nào ngoài
 * lược đồ, nên không có gì phải "dịch" khi lưu.
 *
 * Thu gọn/mở rộng KHÔNG thuộc trạng thái này (là trạng thái phiên làm việc, giữ nguyên khi lọc).
 */
export interface TaskListState {
  filters: SavedViewFilters;
  sort: SavedViewSort[];
  group_by: ViewGroupBy | null;
  columns: ViewColumn[];
}

/** Cột luôn hiện (đứng đầu, không tắt được). */
export const FIXED_COLUMN: ViewColumn = "title";

/** Cột chọn được, theo thứ tự hiển thị trong bảng. */
export const OPTIONAL_COLUMNS: readonly ViewColumn[] = VIEW_COLUMNS.filter(
  (c) => c !== FIXED_COLUMN,
);

/** Cột nào sắp xếp được (khớp VIEW_SORT_FIELDS của lược đồ v1). */
export const SORTABLE_COLUMNS: Partial<Record<ViewColumn, ViewSortField>> = {
  title: "title",
  status_id: "status_id",
  type_id: "type_id",
  priority: "priority",
  assignee_id: "assignee_id",
  start_date: "start_date",
  due_date: "due_date",
  created_at: "created_at",
  updated_at: "updated_at",
};

export const DEFAULT_TASK_LIST_STATE: TaskListState = {
  filters: {},
  sort: [],
  group_by: null,
  columns: [...DEFAULT_VIEW_COLUMNS],
};

/** Chuẩn hóa cột: luôn có title đứng đầu, còn lại theo thứ tự OPTIONAL_COLUMNS, bỏ trùng. */
export function normalizeColumns(columns: readonly ViewColumn[]): ViewColumn[] {
  const set = new Set(columns);
  return [FIXED_COLUMN, ...OPTIONAL_COLUMNS.filter((c) => set.has(c))];
}

export function toSavedViewQuery(state: TaskListState): SavedViewQuery {
  return {
    version: SAVED_VIEW_QUERY_VERSION,
    filters: state.filters,
    sort: state.sort,
    group_by: state.group_by,
    columns: normalizeColumns(state.columns),
    display: "list",
  };
}

export function fromSavedViewQuery(query: SavedViewQuery): TaskListState {
  return {
    filters: query.filters,
    sort: query.sort,
    group_by: query.group_by,
    columns: normalizeColumns(query.columns),
  };
}

/**
 * Bấm tiêu đề cột: chưa sắp → tăng dần → giảm dần → bỏ sắp. Một tiêu chí một lúc (lược đồ cho tới
 * 3; giao diện bảng chỉ dùng 1, tiêu chí phụ luôn là created_at rồi id cho ổn định).
 */
export function nextSort(
  current: readonly SavedViewSort[],
  field: ViewSortField,
): SavedViewSort[] {
  const now = current[0];
  if (!now || now.field !== field) return [{ field, direction: "asc" }];
  if (now.direction === "asc") return [{ field, direction: "desc" }];
  return [];
}

export function hasActiveListFilters(filters: SavedViewFilters): boolean {
  return Object.values(filters).some((v) => v !== undefined);
}

// ---------------------------------------------------------------------------
// Lưu cách xem (cột, sắp xếp, nhóm) ở trình duyệt cho tới khi có chế độ xem đã lưu (E13-2/E13-3).
// Bộ lọc không lưu: mở lại trang luôn thấy đủ task, tránh "mất task" khó hiểu.
// ---------------------------------------------------------------------------
const STORAGE_PREFIX = "qlda:task-list:v1:";

export function storageKey(projectId: string): string {
  return `${STORAGE_PREFIX}${projectId}`;
}

export function serializeListPrefs(state: TaskListState): string {
  return JSON.stringify(
    toSavedViewQuery({ ...state, filters: {} }) satisfies SavedViewQuery,
  );
}

/** Đọc lại; hỏng, cũ hay bị sửa tay thì về mặc định (kiểm bằng CHÍNH schema của chế độ xem). */
export function parseListPrefs(raw: string | null): TaskListState {
  if (!raw) return DEFAULT_TASK_LIST_STATE;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return DEFAULT_TASK_LIST_STATE;
  }
  const query = readViewQuery(value, []);
  if (!query) return DEFAULT_TASK_LIST_STATE;
  return { ...fromSavedViewQuery(query), filters: {} };
}

export function loadListPrefs(projectId: string): TaskListState {
  try {
    return parseListPrefs(window.localStorage.getItem(storageKey(projectId)));
  } catch {
    return DEFAULT_TASK_LIST_STATE;
  }
}

export function saveListPrefs(projectId: string, state: TaskListState): void {
  try {
    window.localStorage.setItem(
      storageKey(projectId),
      serializeListPrefs(state),
    );
  } catch {
    // Chế độ riêng tư hoặc bộ nhớ đầy: chỉ mất phần ghi nhớ, bảng vẫn chạy.
  }
}
