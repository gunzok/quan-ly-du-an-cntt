import type { ApiError } from "@/lib/api/errors";
import { apiError } from "@/lib/api/respond";
import { strings } from "@/lib/strings";
import type { ProjectRole } from "./model";

/**
 * Quyền và ánh xạ lỗi thuần (không I/O) cho API thành viên dự án (Story E1-6). Lớp kiểm thứ nhất
 * (403 rõ ràng); RLS project_members, hàm public.set_project_member() và trigger guard_last_pm
 * (migration 20261115200000_project_members_manage.sql) là lớp thứ hai.
 */
export interface MemberActor {
  userId: string;
  isAdmin: boolean;
  role: ProjectRole | null;
}

/** Thêm, đổi vai trò, gỡ thành viên: PM của dự án và Admin (api-contract.md: A P). */
export function canManageMembers(actor: MemberActor): boolean {
  return actor.isAdmin || actor.role === "pm";
}

/** Tìm người để thêm: Admin hoặc PM của ít nhất một dự án (sếp chốt 2026-11-13). */
export function canSearchUsers(actor: {
  isAdmin: boolean;
  isPmSomewhere: boolean;
}): boolean {
  return actor.isAdmin || actor.isPmSomewhere;
}

const t = strings.projectMembers.errors;

/**
 * Lỗi Postgres khi ghi thành viên → lỗi API; null nếu là lỗi hệ thống (nơi gọi trả 500).
 *   - P0001 last_project_pm (trigger): 409, hạ/gỡ PM đang hoạt động cuối cùng.
 *   - P0001 member_user_inactive: 422, người dùng đích không tồn tại hoặc bị khóa.
 *   - 42501 (member_forbidden, RLS): 403 (quyền vừa đổi giữa lúc kiểm và lúc ghi).
 *   - 23503 (khóa ngoại, người hoặc dự án vừa bị xóa): 422.
 */
export function mapMemberWriteError(error: {
  code?: string;
  message?: string;
}): ApiError | null {
  switch (error.code) {
    case "P0001":
      switch (error.message) {
        case "last_project_pm":
          return apiError("conflict", t.lastPm, [
            { field: "role", issue: "invalid_value" },
          ]);
        case "member_user_inactive":
          return userInactive();
        default:
          return null;
      }
    case "42501":
      return apiError("forbidden", t.forbidden);
    case "23503":
      return userInactive();
    default:
      return null;
  }
}

function userInactive(): ApiError {
  return apiError("business_rule_violated", t.userInactive, [
    { field: "user_id", issue: "invalid_value" },
  ]);
}
