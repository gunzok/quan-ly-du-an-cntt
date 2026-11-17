import { call } from "@/lib/admin/users/client-api";
import type { TaskDetail } from "./detail";
import type { BlockedWarning } from "./blocked";
import type { Task } from "./model";
import type { TaskPatch } from "./validate";

/** Gọi API task từ trình duyệt (cookie phiên cùng origin, Origin tự gửi). Story E2-5. */
const taskUrl = (id: string) => `/api/v1/tasks/${encodeURIComponent(id)}`;

export function fetchTaskDetail(id: string, signal?: AbortSignal) {
  return call<{ data: TaskDetail }>(taskUrl(id), { signal });
}

export function patchTask(id: string, body: TaskPatch) {
  // warnings: BR-06 (E8-3), hoàn thành task còn bị chặn vẫn thành công, kèm cảnh báo.
  return call<{ data: Task; warnings?: BlockedWarning[] }>(taskUrl(id), {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function deleteTask(id: string) {
  return call<null>(taskUrl(id), { method: "DELETE" });
}

export function createSubtask(
  projectId: string,
  parentId: string,
  title: string,
) {
  return call<{ data: Task }>(
    `/api/v1/projects/${encodeURIComponent(projectId)}/tasks`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title, parent_id: parentId }),
    },
  );
}
