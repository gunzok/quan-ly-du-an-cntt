/**
 * Kiểu và hằng số dùng chung (máy chủ và trình duyệt) cho template dự án (Story E7-1, FR-04).
 * Migration: supabase/migrations/20261115420000_project_templates.sql.
 */

export const PROJECT_TEMPLATE_NAME_MAX = 200;
/** Khớp giới hạn trong private.project_template_structure_error (quyết định 5 của migration). */
export const PROJECT_TEMPLATE_MAX_TASKS = 2000;

/**
 * Cột trình duyệt đọc được (không có `structure`: không cấp quyền cột SELECT). Người lưu nhúng qua
 * khóa ngoại created_by (RLS profiles: PM và Admin đọc mọi hồ sơ).
 */
export const PROJECT_TEMPLATE_COLUMNS =
  "id, name, status_count, task_type_count, label_count, task_count, created_by, created_at, updated_at, archived_at, creator:profiles!project_templates_created_by_fkey(id, full_name, email)";

export interface ProjectTemplateRow {
  id: string;
  name: string;
  status_count: number;
  task_type_count: number;
  label_count: number;
  task_count: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  creator: {
    id: string;
    full_name: string | null;
    email: string | null;
  } | null;
}

export interface ProjectTemplateSummary {
  statuses: number;
  task_types: number;
  labels: number;
  tasks: number;
}

/** Hình dạng trả về qua API. */
export interface ProjectTemplate {
  id: string;
  name: string;
  summary: ProjectTemplateSummary;
  created_by: { id: string; name: string } | null;
  created_at: string;
  updated_at: string;
  archived: boolean;
  archived_at: string | null;
  /** Người gọi được đổi tên, lưu trữ, xóa (người lưu hoặc Admin). */
  can_manage: boolean;
}

export function toProjectTemplate(
  row: ProjectTemplateRow,
  actor: { userId: string; isAdmin: boolean },
): ProjectTemplate {
  const creator = row.creator;
  return {
    id: row.id,
    name: row.name,
    summary: {
      statuses: row.status_count,
      task_types: row.task_type_count,
      labels: row.label_count,
      tasks: row.task_count,
    },
    created_by: creator
      ? {
          id: creator.id,
          name: creator.full_name?.trim() || creator.email || "",
        }
      : null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    archived: row.archived_at !== null,
    archived_at: row.archived_at,
    can_manage:
      actor.isAdmin ||
      (row.created_by !== null && row.created_by === actor.userId),
  };
}
