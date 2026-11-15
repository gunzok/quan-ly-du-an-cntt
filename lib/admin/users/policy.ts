import type { ApiError } from "@/lib/api/errors";
import { apiError } from "@/lib/api/respond";
import { strings } from "@/lib/strings";

/**
 * Logic quyền thuần (không I/O) cho API quản trị người dùng, tách ra để test đơn vị.
 */

export type AdminGate =
  { ok: true; userId: string } | { ok: false; error: ApiError };

/**
 * Quyết định người gọi có được dùng API quản trị không.
 * - Không có người dùng (chưa đăng nhập, phiên hết hạn hoặc bị thu hồi): 401.
 * - Có người dùng nhưng hồ sơ không đọc được qua RLS (bị khóa thì RLS ẩn), không phải Admin,
 *   hoặc Admin đã bị khóa: 403.
 */
export function decideAdminGate(
  user: { id: string } | null,
  profile: { is_admin: boolean; is_active: boolean } | null,
): AdminGate {
  if (!user) {
    return { ok: false, error: apiError("unauthenticated") };
  }
  if (!profile || !profile.is_admin || !profile.is_active) {
    return { ok: false, error: apiError("forbidden") };
  }
  return { ok: true, userId: user.id };
}

/**
 * Chặn sớm (trước khi chạm CSDL) thao tác Admin tự khóa hoặc tự thu quyền Admin của mình.
 * Hàm public.admin_update_user kiểm lại lần nữa trong giao dịch có khóa hàng.
 */
export function checkSelfAction(
  actorId: string,
  targetId: string,
  patch: { is_active?: boolean; is_admin?: boolean },
): ApiError | null {
  if (actorId !== targetId) {
    return null;
  }
  if (patch.is_active === false) {
    return apiError("conflict", strings.adminUsers.errors.selfLock);
  }
  if (patch.is_admin === false) {
    return apiError("conflict", strings.adminUsers.errors.selfRevokeAdmin);
  }
  return null;
}

/**
 * Ánh xạ lỗi nghiệp vụ do public.admin_update_user RAISE (mã P0001, thông điệp là mã máy đọc)
 * sang lỗi API. Lỗi khác trả null để nơi gọi coi là lỗi hệ thống.
 */
export function mapAdminUpdateError(error: {
  code?: string;
  message?: string;
}): ApiError | null {
  if (error.code !== "P0001") {
    return null;
  }
  switch (error.message) {
    case "actor_not_admin":
      return apiError("forbidden", strings.adminUsers.errors.notAdminAnymore);
    case "user_not_found":
      return apiError("not_found");
    case "self_lock":
      return apiError("conflict", strings.adminUsers.errors.selfLock);
    case "self_revoke_admin":
      return apiError("conflict", strings.adminUsers.errors.selfRevokeAdmin);
    case "last_admin":
      return apiError("conflict", strings.adminUsers.errors.lastAdmin);
    case "department_not_found":
      return apiError(
        "validation_failed",
        strings.adminUsers.errors.departmentNotFound,
        [{ field: "department_id", issue: "invalid_value" }],
      );
    default:
      return null;
  }
}

/**
 * Chống CSRF: đã gom về lib/api/csrf.ts (Story E0-5) và proxy.ts áp cho mọi /api/* ghi dữ liệu.
 * Giữ tên xuất ở đây để handler và test cũ không đổi hành vi.
 */
export { isSameOrigin } from "@/lib/api/csrf";

/** Độ dài lệnh cấm đăng nhập ở Supabase Auth khi khóa tài khoản (~100 năm; "none" để gỡ). */
export const BAN_DURATION_LOCKED = "876000h";
export const BAN_DURATION_NONE = "none";

export function banDurationFor(isActive: boolean): string {
  return isActive ? BAN_DURATION_NONE : BAN_DURATION_LOCKED;
}
