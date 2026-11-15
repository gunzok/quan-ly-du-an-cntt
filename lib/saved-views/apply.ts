import type { SavedViewFilters } from "./model";

/**
 * Dùng một chế độ xem: bộ lọc → tham số của GET /api/v1/projects/{id}/tasks. Danh sách task chạy
 * bằng phiên của người mở nên chỉ ra task họ đủ quyền (BR-12); id trạng thái, nhãn, người không
 * thuộc dự án chỉ cho kết quả rỗng vì API luôn lọc trong đúng dự án.
 *
 * Cũng là cách lib/saved-views/validate.ts kiểm bộ lọc: chạy đúng validateTaskListQuery trên kết
 * quả này, nên quy tắc lưu và quy tắc dùng không thể lệch nhau.
 */
export function viewFiltersToSearchParams(
  filters: Record<string, string | readonly string[] | undefined>,
): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined) continue;
    params.set(key, typeof value === "string" ? value : value.join(","));
  }
  return params;
}

/** Tham số danh sách task cho bộ lọc của một chế độ xem (đã chuẩn hóa). */
export function viewTaskListParams(filters: SavedViewFilters): URLSearchParams {
  return viewFiltersToSearchParams(
    filters as Record<string, string | readonly string[] | undefined>,
  );
}
