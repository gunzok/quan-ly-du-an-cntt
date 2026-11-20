/**
 * Kiểu và hằng số dùng chung (máy chủ và trình duyệt) cho xuất báo cáo (Story E5-3 xlsx, FR-14;
 * Story E5-4 docx, FR-15; S07).
 * Không import thư viện máy chủ ở đây: hộp thoại S07 dùng lại hằng số.
 */

export const REPORT_FORMATS = ["xlsx", "docx"] as const;
export type ReportFormat = (typeof REPORT_FORMATS)[number];

/** Kỳ dài nhất (ngày, tính cả hai đầu): 366 = một năm nhuận. CHECK trong report_exports khớp số này. */
export const REPORT_MAX_PERIOD_DAYS = 366;

/**
 * Số task tối đa trong một báo cáo. NFR-03 đặt mục tiêu 2.000 task; trần 10.000 chừa gấp 5 lần mà
 * vẫn nằm trong bộ nhớ hàm serverless (đo ở PR E5-3). Vượt trần: 422, thu hẹp kỳ báo cáo.
 */
export const REPORT_MAX_TASKS = 10_000;

/** Số task đọc mỗi lượt từ CSDL (PostgREST max_rows = 1000). */
export const REPORT_TASK_PAGE_SIZE = 1000;

/**
 * Trần thời gian xử lý một lần xuất (ms). Vercel Hobby cắt hàm ở 60 giây, NFR-03 là 30 giây; dừng ở
 * 25 giây để trả 504 report_timeout rõ nghĩa thay vì lỗi của nền tảng.
 */
export const REPORT_TIMEOUT_MS = 25_000;

export const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export const REPORT_MIME: Record<ReportFormat, string> = {
  xlsx: XLSX_MIME,
  docx: DOCX_MIME,
};

export interface ExportReportInput {
  format: ReportFormat;
  /** YYYY-MM-DD, ngày lịch giờ Việt Nam, tính cả ngày này. */
  period_start: string;
  /** YYYY-MM-DD, tính cả ngày này. */
  period_end: string;
}

/**
 * Tên tệp tải về: `bao-cao-<tên dự án không dấu>-<từ>-<đến>.<xlsx|docx>` (ASCII, an toàn mọi hệ điều
 * hành); giữ tối đa 60 ký tự cho phần tên dự án.
 */
export function reportFileName(
  projectName: string,
  input: Pick<ExportReportInput, "format" | "period_start" | "period_end">,
): string {
  const slug =
    projectName
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[đĐ]/g, (c) => (c === "đ" ? "d" : "D"))
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60)
      .replace(/-+$/g, "") || "du-an";
  return `bao-cao-${slug}-${input.period_start}-${input.period_end}.${input.format}`;
}
