/**
 * Dạng dữ liệu dự án trả qua /api/v1/projects (api-contract.md mục 3). Trường gốc trùng tên cột
 * bảng public.projects; trường thống kê lấy từ hàm public.project_stats() (migration
 * 20261115090000_project_list.sql).
 */
export type ProjectStatus = "active" | "archived";
export type ProjectRole = "pm" | "member" | "viewer";

export const PROJECT_STATUSES: readonly ProjectStatus[] = [
  "active",
  "archived",
];

/** Cột chọn khi đọc dự án: liệt kê tường minh, không dùng `*`. */
export const PROJECT_COLUMNS =
  "id, name, description, start_date, end_date, status, created_by, created_at, updated_at";

export interface ProjectRow {
  id: string;
  name: string;
  description: string | null;
  start_date: string | null;
  end_date: string | null;
  status: ProjectStatus;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface MemberPreview {
  id: string;
  full_name: string;
}

/** Một dòng của public.project_stats(). */
export interface ProjectStatsRow {
  project_id: string;
  my_role: ProjectRole | null;
  member_count: number;
  task_count: number;
  done_task_count: number;
  overdue_task_count: number;
  members_preview: MemberPreview[] | null;
}

export interface Project extends ProjectRow {
  /** Vai trò của người gọi trong dự án; null nếu là Admin không thuộc dự án. */
  my_role: ProjectRole | null;
  member_count: number;
  task_count: number;
  done_task_count: number;
  /** Task có due_date < hôm nay (giờ Việt Nam) và chưa hoàn thành (completed_at is null). */
  overdue_task_count: number;
  /** Phần trăm task đã hoàn thành, 0-100; dự án chưa có task là 0. */
  progress: number;
  /** Tối đa 3 thành viên (PM trước) để hiện ảnh đại diện. */
  members_preview: MemberPreview[];
}

export interface ProjectCounts {
  active: number;
  archived: number;
}

export interface ProjectListResponse {
  data: Project[];
  next_cursor: string | null;
  /** Số dự án theo trạng thái (đã áp bộ lọc q), cho nhãn tab. */
  counts: ProjectCounts;
}
