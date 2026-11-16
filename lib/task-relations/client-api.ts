import { call } from "@/lib/admin/users/client-api";
import type { TaskListResponse } from "@/lib/tasks/model";
import type { TaskRelationListResponse, TaskRelationView } from "./model";
import type { RelationCreateRequest } from "./relation-ui";

/** Gọi API quan hệ task từ trình duyệt (E2-5 đọc; E8-2 thêm, bỏ, tìm task đích). */
const relationsUrl = (taskId: string) =>
  `/api/v1/tasks/${encodeURIComponent(taskId)}/relations`;

export function fetchRelations(taskId: string, signal?: AbortSignal) {
  return call<TaskRelationListResponse>(relationsUrl(taskId), { signal });
}

/** POST /tasks/{sourceTaskId}/relations; dựng yêu cầu bằng toCreateRequest(). */
export function createRelation(request: RelationCreateRequest) {
  return call<{ data: TaskRelationView }>(relationsUrl(request.sourceTaskId), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request.body),
  });
}

/** DELETE /tasks/{taskId}/relations/{relationId} (gọi từ task đang xem, đầu nào cũng được). */
export function deleteRelation(taskId: string, relationId: string) {
  return call<null>(
    `${relationsUrl(taskId)}/${encodeURIComponent(relationId)}`,
    { method: "DELETE" },
  );
}

/** Số task gợi ý tối đa trong ô tìm task đích. */
export const RELATION_SEARCH_LIMIT = 20;

/**
 * Tìm task đích trong cùng dự án qua GET /projects/{id}/tasks?q= (bỏ dấu, không phân biệt hoa
 * thường, Story E3-3). Không có từ khóa: trang đầu (task mới nhất).
 */
export function searchRelationTargets(
  projectId: string,
  q: string,
  signal?: AbortSignal,
) {
  const search = new URLSearchParams({ limit: String(RELATION_SEARCH_LIMIT) });
  const keyword = q.trim();
  if (keyword) search.set("q", keyword);
  return call<TaskListResponse>(
    `/api/v1/projects/${encodeURIComponent(projectId)}/tasks?${search}`,
    { signal },
  );
}
