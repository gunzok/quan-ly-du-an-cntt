import { call } from "@/lib/admin/users/client-api";
import type { ProjectMember, ProjectRole, UserCandidate } from "./model";

/** Gọi API thành viên dự án từ trình duyệt (cookie phiên cùng origin, Origin tự gửi). */
const base = (projectId: string) =>
  `/api/v1/projects/${encodeURIComponent(projectId)}/members`;

export function fetchMembers(projectId: string, signal?: AbortSignal) {
  return call<{ data: ProjectMember[] }>(base(projectId), { signal });
}

export function putMember(
  projectId: string,
  userId: string,
  role: ProjectRole,
) {
  return call<{ data: ProjectMember }>(
    `${base(projectId)}/${encodeURIComponent(userId)}`,
    {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role }),
    },
  );
}

export function deleteMember(projectId: string, userId: string) {
  return call<null>(`${base(projectId)}/${encodeURIComponent(userId)}`, {
    method: "DELETE",
  });
}

export function searchUsers(
  q: string,
  excludeProjectId: string,
  signal?: AbortSignal,
) {
  const qs = new URLSearchParams({ q, exclude_project_id: excludeProjectId });
  return call<{ data: UserCandidate[] }>(`/api/v1/users/search?${qs}`, {
    signal,
  });
}
