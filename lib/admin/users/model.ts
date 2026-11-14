/**
 * Kiểu dữ liệu người dùng trả về từ /api/v1/users (dùng chung máy chủ và giao diện).
 */
export type UserStatus = "active" | "locked" | "invited";

export interface AdminUser {
  id: string;
  full_name: string;
  email: string | null;
  department: { id: string; name: string } | null;
  is_admin: boolean;
  is_active: boolean;
  status: UserStatus;
  project_count: number;
  pm_project_count: number;
  last_sign_in_at: string | null;
  invited_at: string | null;
  created_at: string;
}

export interface UserListResponse {
  data: AdminUser[];
  next_cursor: string | null;
}

/** Một dòng của public.admin_list_users. */
export interface AdminUserRow {
  id: string;
  full_name: string;
  email: string | null;
  department_id: string | null;
  department_name: string | null;
  is_admin: boolean;
  is_active: boolean;
  project_count: number;
  pm_project_count: number;
  last_sign_in_at: string | null;
  invited_at: string | null;
  email_confirmed_at: string | null;
  created_at: string;
  sort_key: string;
}

/**
 * Trạng thái hiển thị: bị khóa > chờ nhận lời mời (được mời, chưa đăng nhập lần nào) > hoạt động.
 */
export function userStatus(
  row: Pick<AdminUserRow, "is_active" | "invited_at" | "last_sign_in_at">,
): UserStatus {
  if (!row.is_active) {
    return "locked";
  }
  if (row.invited_at && !row.last_sign_in_at) {
    return "invited";
  }
  return "active";
}

export function toAdminUser(row: AdminUserRow): AdminUser {
  return {
    id: row.id,
    full_name: row.full_name,
    email: row.email,
    department:
      row.department_id && row.department_name
        ? { id: row.department_id, name: row.department_name }
        : null,
    is_admin: row.is_admin,
    is_active: row.is_active,
    status: userStatus(row),
    project_count: row.project_count,
    pm_project_count: row.pm_project_count,
    last_sign_in_at: row.last_sign_in_at,
    invited_at: row.invited_at,
    created_at: row.created_at,
  };
}
