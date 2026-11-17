import { call } from "@/lib/admin/users/client-api";
import type { Task } from "@/lib/tasks/model";

/**
 * Tạo task nhanh từ bảng phân cấp (Story E3-2): POST /api/v1/projects/{id}/tasks có sẵn (E2-1).
 * Không gửi trạng thái, loại: CSDL đặt trạng thái todo đầu tiên và loại đầu tiên của dự án.
 * Danh sách task dùng lib/kanban/client-api.ts#fetchAllTasks (con trỏ, 500/trang từ E3-4).
 */
export function createTask(projectId: string, title: string) {
  return call<{ data: Task }>(
    `/api/v1/projects/${encodeURIComponent(projectId)}/tasks`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title }),
    },
  );
}
