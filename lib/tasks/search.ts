import type { ApiErrorDetail } from "@/lib/api/errors";
import { isUuid } from "@/lib/api/request";

/**
 * Tham số tìm kiếm và bộ lọc mở rộng của GET /api/v1/projects/{id}/tasks (Story E3-3, QLDA-48).
 *
 * - `q`: từ khóa. Bỏ dấu, không phân biệt hoa thường, mỗi từ (tách theo khoảng trắng) phải xuất
 *   hiện trong tiêu đề hoặc mô tả. Bỏ dấu và thoát ký tự LIKE làm trong CSDL
 *   (public.search_tasks, migration 20261115180000_task_search.sql); ở đây chỉ kiểm độ dài và ký
 *   tự điều khiển. Rỗng hoặc chỉ khoảng trắng: coi như không tìm.
 * - `status_id`: một hoặc nhiều uuid ngăn bằng dấu phẩy (khớp MỘT trong các trạng thái).
 * - `due_after`, `due_before`: khoảng hạn chót, YYYY-MM-DD, tính cả hai đầu; task không có hạn
 *   bị loại khi có một trong hai tham số.
 */

/** Khớp chốt chặn `char_length(p_q) <= 200` trong private.search_patterns. */
export const SEARCH_Q_MAX_LENGTH = 200;
/** Số trạng thái tối đa trong một bộ lọc (một dự án thường dưới 10 trạng thái). */
export const STATUS_FILTER_MAX = 20;

// Ký tự điều khiển: tab, xuống dòng... không có trong ô tìm kiếm; \0 còn làm Postgres báo lỗi.
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

/** Từ khóa đã cắt khoảng trắng hai đầu; null nếu không tìm. */
export function readSearchQuery(
  raw: string | null,
  details: ApiErrorDetail[],
): string | null {
  if (raw === null) return null;
  const q = raw.trim();
  if (q === "") return null;
  if (q.length > SEARCH_Q_MAX_LENGTH) {
    details.push({ field: "q", issue: "too_long" });
    return null;
  }
  if (CONTROL_CHARS.test(q)) {
    details.push({ field: "q", issue: "invalid_format" });
    return null;
  }
  return q;
}

/** Danh sách uuid trạng thái đã chuẩn hóa chữ thường, bỏ trùng, sắp xếp; null nếu không lọc. */
export function readStatusIds(
  raw: string | null,
  details: ApiErrorDetail[],
): string[] | null {
  if (raw === null) return null;
  const parts = raw.split(",");
  if (!parts.every(isUuid)) {
    details.push({ field: "status_id", issue: "invalid_format" });
    return null;
  }
  const ids = [...new Set(parts.map((p) => p.toLowerCase()))].sort();
  if (ids.length > STATUS_FILTER_MAX) {
    details.push({ field: "status_id", issue: "too_long" });
    return null;
  }
  return ids;
}
