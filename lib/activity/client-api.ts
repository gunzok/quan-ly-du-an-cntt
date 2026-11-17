import { call } from "@/lib/admin/users/client-api";
import type { ActivityListResponse } from "./model";

/** Bộ lọc nhật ký dự án gửi lên API (bỏ trống = không lọc). */
export interface ActivityFilters {
  actor_id?: string;
  from?: string;
  to?: string;
  entity_type?: string;
  action?: string;
}

function qs(params: Record<string, string | number | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

/** GET /api/v1/projects/{id}/activity (cookie phiên cùng origin). */
export function fetchProjectActivity(
  projectId: string,
  opts: { filters?: ActivityFilters; cursor?: string | null; limit?: number },
  signal?: AbortSignal,
) {
  return call<ActivityListResponse>(
    `/api/v1/projects/${encodeURIComponent(projectId)}/activity${qs({
      ...opts.filters,
      limit: opts.limit,
      cursor: opts.cursor ?? undefined,
    })}`,
    { signal },
  );
}

/** GET /api/v1/tasks/{id}/activity */
export function fetchTaskActivity(
  taskId: string,
  opts: { cursor?: string | null; limit?: number },
  signal?: AbortSignal,
) {
  return call<ActivityListResponse>(
    `/api/v1/tasks/${encodeURIComponent(taskId)}/activity${qs({
      limit: opts.limit,
      cursor: opts.cursor ?? undefined,
    })}`,
    { signal },
  );
}
