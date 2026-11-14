/**
 * Kiểu dữ liệu phòng ban trả về từ /api/v1/departments (dùng chung máy chủ và giao diện).
 */
export interface Department {
  id: string;
  name: string;
  position: number;
  /** true khi đã lưu trữ: không gán mới được, người đang thuộc vẫn giữ. */
  archived: boolean;
  archived_at: string | null;
}

export interface DepartmentRow {
  id: string;
  name: string;
  position: number;
  archived_at: string | null;
}

/** Cột đọc từ public.departments. */
export const DEPARTMENT_COLUMNS = "id, name, position, archived_at";

export function toDepartment(row: DepartmentRow): Department {
  return {
    id: row.id,
    name: row.name,
    position: row.position,
    archived: row.archived_at !== null,
    archived_at: row.archived_at,
  };
}

/** Thứ tự hiển thị: đang dùng trước, rồi theo position, rồi theo tên (tiếng Việt). */
export function compareDepartments(a: Department, b: Department): number {
  if (a.archived !== b.archived) return a.archived ? 1 : -1;
  if (a.position !== b.position) return a.position - b.position;
  return a.name.localeCompare(b.name, "vi");
}
