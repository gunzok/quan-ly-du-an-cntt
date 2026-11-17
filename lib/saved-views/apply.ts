import type { SavedViewFilters, SavedViewSort } from "./model";

/**
 * Dùng một chế độ xem: bộ lọc → tham số của GET /api/v1/projects/{id}/tasks. Danh sách task chạy
 * bằng phiên của người mở nên chỉ ra task họ đủ quyền (BR-12); id trạng thái, nhãn, người không
 * thuộc dự án chỉ cho kết quả rỗng vì API luôn lọc trong đúng dự án.
 *
 * Cũng là cách lib/saved-views/validate.ts kiểm bộ lọc: chạy đúng validateTaskListQuery trên kết
 * quả này, nên quy tắc lưu và quy tắc dùng không thể lệch nhau.
 */
export function viewFiltersToSearchParams(
  filters: Record<string, string | boolean | readonly string[] | undefined>,
): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined) continue;
    params.set(
      key,
      typeof value === "string"
        ? value
        : typeof value === "boolean"
          ? String(value)
          : value.join(","),
    );
  }
  return params;
}

/**
 * Tham số danh sách task cho bộ lọc của một chế độ xem (đã chuẩn hóa). Có `sort` thì thêm tham số
 * sắp xếp của API khi tiêu chí ĐẦU là created_at/updated_at (API chỉ sắp theo hai trường này; tiêu
 * chí khác do giao diện sắp ở trình duyệt).
 */
export function viewTaskListParams(
  filters: SavedViewFilters,
  sort: readonly SavedViewSort[] = [],
): URLSearchParams {
  const params = viewFiltersToSearchParams(
    filters as Record<string, string | boolean | readonly string[] | undefined>,
  );
  const first = sort[0];
  if (first && (first.field === "created_at" || first.field === "updated_at")) {
    params.set(
      "sort",
      `${first.direction === "desc" ? "-" : ""}${first.field}`,
    );
  }
  return params;
}
