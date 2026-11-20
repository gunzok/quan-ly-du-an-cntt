import type { ApiError, ApiErrorBody } from "@/lib/api/errors";
import type { ExportReportInput, ReportFormat } from "./model";

/**
 * Gọi POST /api/v1/projects/{id}/reports từ trình duyệt (Story E5-3). Thành công: thân là tệp, lấy
 * tên tệp từ Content-Disposition (filename* UTF-8 ưu tiên). Lỗi mạng: `network` để hộp thoại báo
 * đúng câu; mã lỗi API giữ nguyên để hộp thoại dịch (report_timeout, report_template_missing...).
 */
export type ExportResult =
  | { ok: true; blob: Blob; fileName: string }
  | { ok: false; error: ApiError | null; network?: true };

export function fileNameFromDisposition(
  header: string | null,
  fallback: string,
): string {
  if (!header) return fallback;
  const star = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (star) {
    try {
      return decodeURIComponent(star[1].trim());
    } catch {
      // Rơi xuống filename thường.
    }
  }
  const plain = /filename="([^"]+)"/i.exec(header);
  return plain ? plain[1] : fallback;
}

export async function exportReport(
  projectId: string,
  input: ExportReportInput,
  signal?: AbortSignal,
): Promise<ExportResult> {
  let response: Response;
  try {
    response = await fetch(
      `/api/v1/projects/${encodeURIComponent(projectId)}/reports`,
      {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
        signal,
      },
    );
  } catch (error) {
    if ((error as { name?: string }).name === "AbortError") throw error;
    return { ok: false, error: null, network: true };
  }
  if (!response.ok) {
    const body = (await response
      .json()
      .catch(() => null)) as ApiErrorBody | null;
    const error = body?.error;
    return {
      ok: false,
      error: error && typeof error.code === "string" ? error : null,
    };
  }
  const blob = await response.blob();
  return {
    ok: true,
    blob,
    fileName: fileNameFromDisposition(
      response.headers.get("content-disposition"),
      `bao-cao.${input.format}`,
    ),
  };
}

/** Đường dẫn tải template mẫu (Admin, PM). */
export function sampleTemplateUrl(format: ReportFormat = "xlsx") {
  return `/api/v1/report-templates/sample?format=${format}`;
}

/** Lưu Blob thành tệp tải xuống (liên kết tạm, thu hồi URL ngay sau khi bấm). */
export function saveBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
