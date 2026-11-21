import { call } from "@/lib/admin/users/client-api";
import type { ProjectTemplate } from "./model";

/** Gọi API template dự án từ trình duyệt (cookie phiên cùng origin, Origin tự gửi). */
export function fetchProjectTemplates(
  options: { includeArchived?: boolean } = {},
  signal?: AbortSignal,
) {
  const qs = options.includeArchived ? "?include_archived=true" : "";
  return call<{ data: ProjectTemplate[] }>(`/api/v1/project-templates${qs}`, {
    signal,
  });
}

/** Lưu dự án thành template (PM của dự án, Admin). */
export function saveProjectAsTemplate(projectId: string, name: string) {
  return call<{ data: ProjectTemplate }>(
    `/api/v1/projects/${encodeURIComponent(projectId)}/templates`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    },
  );
}

export function patchProjectTemplate(
  id: string,
  body: { name?: string; archived?: boolean },
) {
  return call<{ data: ProjectTemplate }>(
    `/api/v1/project-templates/${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

export function deleteProjectTemplate(id: string) {
  return call<null>(`/api/v1/project-templates/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

/** Trang quản lý template dự án (S17) cho PM; Admin còn có tab ở /admin/report-templates. */
export const PROJECT_TEMPLATES_PATH = "/project-templates";
