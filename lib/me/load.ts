import type { SupabaseClient } from "@supabase/supabase-js";
import type { Locale } from "@/lib/i18n/config";
import { isLocale, DEFAULT_LOCALE } from "@/lib/i18n/config";

/** Vai trò của tôi trong một dự án (chỉ đọc). */
export type MyProjectRole = "pm" | "member" | "viewer";

export interface MyProject {
  project_id: string;
  name: string;
  status: "active" | "archived";
  role: MyProjectRole;
}

/** Hồ sơ người đang đăng nhập (GET /api/v1/me, Story E1-7). */
export interface MeProfile {
  id: string;
  email: string;
  full_name: string;
  /** Số điện thoại (profile_contacts), null khi chưa có. */
  phone: string | null;
  locale: Locale;
  is_admin: boolean;
  department: { id: string; name: string } | null;
  /** Vai trò theo từng dự án, sắp theo tên dự án. */
  projects: MyProject[];
}

type Row<T> = { data: T | null; error: { code?: string } | null };

const ROLES: readonly MyProjectRole[] = ["pm", "member", "viewer"];

function one<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

/**
 * Đọc hồ sơ của chính mình bằng client phiên: profiles (RLS cho đọc hồ sơ của mình), phòng ban,
 * số điện thoại (profile_contacts_select: chính chủ đọc được), và các dòng project_members của
 * mình kèm tên dự án (projects_select: thành viên đọc được). Không dùng service_role.
 * Trả null khi RLS ẩn hồ sơ (ví dụ vừa bị khóa).
 */
export async function loadMe(
  session: SupabaseClient,
  userId: string,
): Promise<MeProfile | null> {
  const [profileRes, contactRes, membersRes] = (await Promise.all([
    session
      .from("profiles")
      .select(
        "id, email, full_name, locale, is_admin, department:departments(id, name)",
      )
      .eq("id", userId)
      .maybeSingle(),
    session
      .from("profile_contacts")
      .select("phone")
      .eq("user_id", userId)
      .maybeSingle(),
    session
      .from("project_members")
      .select("role, project:projects(id, name, status)")
      .eq("user_id", userId),
  ])) as [
    Row<{
      id: string;
      email: string | null;
      full_name: string | null;
      locale: string;
      is_admin: boolean;
      department: unknown;
    }>,
    Row<{ phone: string }>,
    Row<{ role: string; project: unknown }[]>,
  ];
  if (profileRes.error) throw profileRes.error;
  if (contactRes.error) throw contactRes.error;
  if (membersRes.error) throw membersRes.error;
  const profile = profileRes.data;
  if (!profile) return null;

  const department = one(
    profile.department as { id: string; name: string } | null,
  );
  const projects: MyProject[] = [];
  for (const row of membersRes.data ?? []) {
    const project = one(
      row.project as { id: string; name: string; status: string } | null,
    );
    if (!project || !ROLES.includes(row.role as MyProjectRole)) continue;
    projects.push({
      project_id: project.id,
      name: project.name,
      status: project.status === "archived" ? "archived" : "active",
      role: row.role as MyProjectRole,
    });
  }
  projects.sort(
    (a, b) =>
      a.name.localeCompare(b.name, "vi", { sensitivity: "base" }) ||
      a.project_id.localeCompare(b.project_id),
  );

  return {
    id: profile.id,
    email: profile.email ?? "",
    full_name: (profile.full_name ?? "").trim(),
    phone: contactRes.data?.phone ?? null,
    locale: isLocale(profile.locale) ? profile.locale : DEFAULT_LOCALE,
    is_admin: profile.is_admin === true,
    department: department
      ? { id: department.id, name: department.name }
      : null,
    projects,
  };
}
