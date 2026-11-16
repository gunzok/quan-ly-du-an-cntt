import { call } from "@/lib/admin/users/client-api";
import type { Dashboard } from "./model";

/** Gọi API dashboard từ trình duyệt (cookie phiên cùng origin). */
export function fetchDashboard(projectId: string, signal?: AbortSignal) {
  return call<{ data: Dashboard }>(
    `/api/v1/projects/${encodeURIComponent(projectId)}/dashboard`,
    { signal },
  );
}
