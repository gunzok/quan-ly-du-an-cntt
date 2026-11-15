import type { ProjectRole } from "@/lib/projects/model";

/**
 * Dạng dữ liệu thành viên dự án qua /api/v1/projects/{id}/members và người tìm được qua
 * /api/v1/users/search (Story E1-6). Trường gốc trùng tên cột public.project_members, public.profiles.
 */
export type { ProjectRole };

/** Thứ tự hiển thị và thứ tự lựa chọn vai trò: PM, Thành viên, Người xem. */
export const PROJECT_ROLES: readonly ProjectRole[] = ["pm", "member", "viewer"];

/** Độ dài chuỗi tìm người (sau khi cắt hai đầu): tối thiểu 2 để không liệt kê cả danh bạ bằng 1 ký tự. */
export const SEARCH_Q_MIN = 2;
export const SEARCH_Q_MAX = 100;

export interface DepartmentRef {
  id: string;
  name: string;
}

export interface MemberUser {
  id: string;
  full_name: string;
  email: string | null;
  /** false: tài khoản bị khóa (vẫn hiện trong danh sách để PM gỡ hoặc giữ lịch sử). */
  is_active: boolean;
  department: DepartmentRef | null;
}

export interface ProjectMember {
  user_id: string;
  role: ProjectRole;
  joined_at: string;
  user: MemberUser;
}

export interface UserCandidate {
  id: string;
  full_name: string;
  email: string | null;
  department: DepartmentRef | null;
}

/** Cột đọc qua PostgREST (nhúng hồ sơ và phòng ban theo khóa ngoại). */
export const MEMBER_SELECT =
  "user_id, role, joined_at, profile:profiles!project_members_user_id_fkey(id, full_name, email, is_active, department:departments(id, name))";

interface MemberRow {
  user_id: string;
  role: ProjectRole;
  joined_at: string;
  profile: {
    id: string;
    full_name: string | null;
    email: string | null;
    is_active: boolean;
    department: DepartmentRef | null;
  } | null;
}

export function toProjectMember(raw: unknown): ProjectMember {
  const row = raw as MemberRow;
  const p = row.profile;
  return {
    user_id: row.user_id,
    role: row.role,
    joined_at: row.joined_at,
    user: {
      id: row.user_id,
      full_name: p?.full_name ?? "",
      email: p?.email ?? null,
      is_active: p?.is_active ?? false,
      department: p?.department ?? null,
    },
  };
}

interface CandidateRow {
  id: string;
  full_name: string | null;
  email: string | null;
  department_id: string | null;
  department_name: string | null;
}

export function toUserCandidate(raw: unknown): UserCandidate {
  const row = raw as CandidateRow;
  return {
    id: row.id,
    full_name: row.full_name ?? "",
    email: row.email,
    department:
      row.department_id && row.department_name
        ? { id: row.department_id, name: row.department_name }
        : null,
  };
}

/** Tên hiển thị: họ tên, trống thì email. */
export function displayName(user: {
  full_name: string;
  email: string | null;
}): string {
  return user.full_name.trim() || user.email || "";
}

/** PM trước, rồi Thành viên, Người xem; cùng vai trò thì theo tên (tiếng Việt), rồi id. */
export function compareMembers(a: ProjectMember, b: ProjectMember): number {
  const byRole = PROJECT_ROLES.indexOf(a.role) - PROJECT_ROLES.indexOf(b.role);
  if (byRole !== 0) return byRole;
  const byName = displayName(a.user).localeCompare(displayName(b.user), "vi", {
    sensitivity: "base",
  });
  if (byName !== 0) return byName;
  return a.user_id < b.user_id ? -1 : a.user_id > b.user_id ? 1 : 0;
}

/** Số PM đang hoạt động (giao diện cảnh báo trước khi hạ/gỡ PM cuối; CSDL vẫn chặn). */
export function activePmCount(members: readonly ProjectMember[]): number {
  return members.filter((m) => m.role === "pm" && m.user.is_active).length;
}
