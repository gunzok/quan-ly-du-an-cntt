import type { ApiError } from "@/lib/api/errors";
import { apiError } from "@/lib/api/respond";
import { strings } from "@/lib/strings";

/**
 * Logic quyền và ánh xạ lỗi thuần (không I/O) cho /api/v1/departments, tách ra để test đơn vị.
 */

export type ActiveUserGate =
  { ok: true; userId: string } | { ok: false; error: ApiError };

/**
 * Đọc danh mục: mọi người dùng đăng nhập ĐANG HOẠT ĐỘNG.
 * - Không có người dùng: 401.
 * - Hồ sơ không đọc được qua RLS (bị khóa thì RLS ẩn cả hồ sơ của chính mình) hoặc bị khóa: 403.
 */
export function decideActiveUserGate(
  user: { id: string } | null,
  profile: { is_active: boolean } | null,
): ActiveUserGate {
  if (!user) {
    return { ok: false, error: apiError("unauthenticated") };
  }
  if (!profile || !profile.is_active) {
    return { ok: false, error: apiError("forbidden") };
  }
  return { ok: true, userId: user.id };
}

/**
 * Ánh xạ lỗi PostgREST/Postgres khi ghi departments sang lỗi API; lỗi khác trả null (lỗi hệ thống).
 * - 23505: trùng tên (ràng buộc departments_name_key hoặc chỉ mục departments_name_ci_key).
 * - 42501: RLS từ chối (ví dụ quyền Admin vừa bị thu giữa lúc kiểm và lúc ghi).
 * - 23514: vi phạm CHECK (tên rỗng/quá dài) nếu lọt qua schema.
 */
export function mapDepartmentWriteError(error: {
  code?: string;
}): ApiError | null {
  switch (error.code) {
    case "23505":
      return apiError("conflict", strings.departments.errors.nameExists, [
        { field: "name", issue: "invalid_value" },
      ]);
    case "42501":
      return apiError("forbidden");
    case "23514":
      return apiError("validation_failed", undefined, [
        { field: "name", issue: "invalid_value" },
      ]);
    default:
      return null;
  }
}
