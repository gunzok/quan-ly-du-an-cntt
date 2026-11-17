/**
 * Kiểu và hằng số dùng chung (máy chủ và trình duyệt) cho template báo cáo (Story E5-2, BR-08).
 */

export const REPORT_TEMPLATE_KINDS = ["xlsx", "docx"] as const;
export type ReportTemplateKind = (typeof REPORT_TEMPLATE_KINDS)[number];

/**
 * Kích thước tối đa của một tệp template: 4 MiB. Mockup S17 ghi 5 MB nhưng Vercel giới hạn thân
 * request của hàm serverless ở 4,5 MB (cả phần bao multipart), nên chốt 4 MiB để lỗi luôn do ứng
 * dụng trả (413 rõ nghĩa), không phải lỗi của nền tảng. CHECK size_bytes và bucket cũng dùng số này.
 */
export const REPORT_TEMPLATE_MAX_BYTES = 4 * 1024 * 1024;

/** Thân multipart tối đa: tệp + phần bao (ranh giới, header, trường name). */
export const REPORT_TEMPLATE_MAX_REQUEST_BYTES =
  REPORT_TEMPLATE_MAX_BYTES + 64 * 1024;

/** Giới hạn khi giải nén để chặn ZIP bomb (kiểm đồng bộ lúc tải lên). */
export const REPORT_TEMPLATE_MAX_ENTRIES = 2000;
export const REPORT_TEMPLATE_MAX_UNCOMPRESSED_BYTES = 64 * 1024 * 1024;

export const REPORT_TEMPLATE_NAME_MAX = 200;
/** Tên tệp gốc (chỉ để kiểm và gợi ý tên hiển thị, không dùng làm đường dẫn). */
export const REPORT_TEMPLATE_FILENAME_MAX = 255;

export const REPORT_TEMPLATE_MIME: Record<ReportTemplateKind, string> = {
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

export const REPORT_TEMPLATE_BUCKET = "report-templates";

export const REPORT_TEMPLATE_COLUMNS =
  "id, kind, name, storage_path, size_bytes, is_active, uploaded_by, created_at, updated_at, uploader:profiles!report_templates_uploaded_by_fkey(id, full_name, email)";

export interface ReportTemplateRow {
  id: string;
  kind: ReportTemplateKind;
  name: string;
  storage_path: string;
  size_bytes: number;
  is_active: boolean;
  uploaded_by: string | null;
  created_at: string;
  updated_at: string;
  uploader: {
    id: string;
    full_name: string | null;
    email: string | null;
  } | null;
}

/** Hình dạng trả về qua API: không lộ storage_path (chi tiết nội bộ). */
export interface ReportTemplate {
  id: string;
  kind: ReportTemplateKind;
  name: string;
  size_bytes: number;
  is_active: boolean;
  uploaded_by: { id: string; name: string } | null;
  created_at: string;
  updated_at: string;
}

export function toReportTemplate(row: ReportTemplateRow): ReportTemplate {
  const uploader = row.uploader;
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    size_bytes: row.size_bytes,
    is_active: row.is_active,
    uploaded_by: uploader
      ? {
          id: uploader.id,
          name: uploader.full_name?.trim() || uploader.email || "",
        }
      : null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/** Đường dẫn trong bucket do máy chủ sinh: `<kind>/<uuid>.<kind>`. */
export function storagePathFor(id: string, kind: ReportTemplateKind): string {
  return `${kind}/${id}.${kind}`;
}
