import { call } from "@/lib/admin/users/client-api";
import type { ReportTemplate } from "./model";

/** Gọi /api/v1/report-templates từ trình duyệt (cookie phiên cùng origin, Origin tự gửi). */
export function fetchReportTemplates(signal?: AbortSignal) {
  return call<{ data: ReportTemplate[] }>("/api/v1/report-templates", {
    signal,
  });
}

/** Tải lên (multipart). Không tự đặt content-type: trình duyệt thêm boundary. */
export function uploadReportTemplate(file: File) {
  const form = new FormData();
  form.set("file", file);
  return call<{ data: ReportTemplate }>("/api/v1/report-templates", {
    method: "POST",
    body: form,
  });
}

export function patchReportTemplate(
  id: string,
  body: { name?: string; is_active?: boolean },
) {
  return call<{ data: ReportTemplate }>(
    `/api/v1/report-templates/${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

export function deleteReportTemplate(id: string) {
  return call<null>(`/api/v1/report-templates/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

/** Đường dẫn tải tệp (Admin, PM). */
export function reportTemplateFileUrl(id: string) {
  return `/api/v1/report-templates/${encodeURIComponent(id)}/file`;
}
