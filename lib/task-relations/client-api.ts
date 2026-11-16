import { call } from "@/lib/admin/users/client-api";
import type { TaskRelationListResponse } from "./model";

/** Đọc quan hệ của một task từ trình duyệt (Story E2-5 chỉ hiển thị; thêm/xóa là E8-2). */
export function fetchRelations(taskId: string, signal?: AbortSignal) {
  return call<TaskRelationListResponse>(
    `/api/v1/tasks/${encodeURIComponent(taskId)}/relations`,
    { signal },
  );
}
