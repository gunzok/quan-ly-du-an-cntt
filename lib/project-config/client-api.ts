import { call } from "@/lib/admin/users/client-api";
import type { StatusCategory, ConfigItemByKind, ConfigKind } from "./model";

/** Gọi API cấu hình dự án từ trình duyệt (cookie phiên cùng origin, Origin tự gửi). */
export function fetchConfig<K extends ConfigKind>(
  kind: K,
  projectId: string,
  signal?: AbortSignal,
) {
  return call<{ data: ConfigItemByKind[K][] }>(
    `/api/v1/projects/${encodeURIComponent(projectId)}/${kind}`,
    { signal },
  );
}

export interface ConfigInput {
  name?: string;
  color?: string;
  category?: StatusCategory;
  is_milestone?: boolean;
  position?: number;
}

export function createConfig<K extends ConfigKind>(
  kind: K,
  projectId: string,
  body: ConfigInput,
) {
  return call<{ data: ConfigItemByKind[K] }>(
    `/api/v1/projects/${encodeURIComponent(projectId)}/${kind}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

export function patchConfig<K extends ConfigKind>(
  kind: K,
  id: string,
  body: ConfigInput,
) {
  return call<{ data: ConfigItemByKind[K] }>(
    `/api/v1/${kind}/${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

export function deleteConfig(
  kind: ConfigKind,
  id: string,
  replaceWith?: string | null,
) {
  const qs = replaceWith
    ? `?replace_with=${encodeURIComponent(replaceWith)}`
    : "";
  return call<null>(`/api/v1/${kind}/${encodeURIComponent(id)}${qs}`, {
    method: "DELETE",
  });
}
