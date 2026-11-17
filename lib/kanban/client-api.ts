import { call, type ApiResult } from "@/lib/admin/users/client-api";
import type { BlockedWarning } from "@/lib/tasks/blocked";
import type { Task, TaskListResponse } from "@/lib/tasks/model";
import { LIST_LIMIT_MAX } from "@/lib/tasks/validate";

/**
 * Gọi API task từ trình duyệt cho bảng Kanban (Story E3-1). Không thêm API mới: dùng
 * GET /api/v1/projects/{id}/tasks (con trỏ) và PATCH /api/v1/tasks/{id}.
 */

/** Giới hạn an toàn số trang một lần tải (500 task/trang → 20.000 task). */
const MAX_PAGES = 40;

/**
 * Tải HẾT task khớp tham số, lần theo next_cursor (mỗi trang
 * LIST_LIMIT_MAX = 500 từ E3-4: 2.000 task là 4 lượt thay vì 20). Bảng cần đủ task của một cột để
 * sắp theo position (API chỉ sắp theo created_at) và để đếm việc con.
 */
export async function fetchAllTasks(
  projectId: string,
  params: { status_id?: string; q?: string },
  signal?: AbortSignal,
  onPage?: (loaded: number) => void,
): Promise<ApiResult<Task[]>> {
  const out: Task[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const search = new URLSearchParams({ limit: String(LIST_LIMIT_MAX) });
    if (params.status_id) search.set("status_id", params.status_id);
    if (params.q) search.set("q", params.q);
    if (cursor) search.set("cursor", cursor);
    const result: ApiResult<TaskListResponse> = await call<TaskListResponse>(
      `/api/v1/projects/${encodeURIComponent(projectId)}/tasks?${search}`,
      { signal },
    );
    if (!result.ok) return result;
    out.push(...result.data.data);
    onPage?.(out.length);
    cursor = result.data.next_cursor;
    if (!cursor) break;
  }
  return { ok: true, data: out };
}

/** Đổi cột và/hoặc thứ tự: PATCH status_id, position (chỉ trường có mặt mới đổi). */
export function moveTask(
  id: string,
  body: { status_id?: string; position: number },
) {
  return call<{ data: Task; warnings?: BlockedWarning[] }>(
    `/api/v1/tasks/${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}
