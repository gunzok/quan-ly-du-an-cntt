import { call } from "@/lib/admin/users/client-api";
import type { Department } from "./model";

/** Gọi /api/v1/departments từ trình duyệt (cookie phiên cùng origin, Origin tự gửi). */
export function createDepartment(body: { name: string; position?: number }) {
  return call<{ data: Department }>("/api/v1/departments", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function patchDepartment(
  id: string,
  body: { name?: string; position?: number; archived?: boolean },
) {
  return call<{ data: Department }>(
    `/api/v1/departments/${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}
