import { messageKeyOf } from "@/lib/i18n/message-key";

/**
 * Cấu trúc lỗi thống nhất theo docs/03-design/api-contract.md mục 2.
 */
export type ApiErrorCode =
  | "validation_failed"
  | "unauthenticated"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "business_rule_violated"
  /** Tệp tải lên vượt giới hạn kích thước (Story E5-2). */
  | "payload_too_large"
  | "rate_limited"
  | "internal_error"
  /** Xuất báo cáo: không có template đang dùng cho định dạng đó (Story E5-3). */
  | "report_template_missing"
  /** Xuất báo cáo quá thời gian chờ (Story E5-3, R-006). */
  | "report_timeout";

export type FieldIssue =
  | "required"
  | "invalid_format"
  | "too_long"
  | "invalid_value"
  | "unknown_field";

export interface ApiErrorDetail {
  field: string;
  issue: FieldIssue;
}

export interface ApiError {
  code: ApiErrorCode;
  /** Thông điệp tiếng Việt (giữ cho khách API). */
  message: string;
  /**
   * Khóa ổn định của thông điệp trong từ điển giao diện (Story E10-2), ví dụ
   * "adminUsers.errors.emailExists". Giao diện dịch theo khóa này; vắng khi thông điệp không lấy
   * từ từ điển.
   */
  message_key?: string;
  details?: ApiErrorDetail[];
  /** Id task liên quan (ví dụ việc con chưa xong khi đóng task cha, BR-04). */
  task_ids?: string[];
  request_id?: string;
}

export interface ApiErrorBody {
  error: ApiError;
}

export const API_ERROR_STATUS: Record<ApiErrorCode, number> = {
  validation_failed: 400,
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  business_rule_violated: 422,
  payload_too_large: 413,
  rate_limited: 429,
  internal_error: 500,
  report_template_missing: 422,
  report_timeout: 504,
};

/** Thân phản hồi lỗi; tự gắn `message_key` khi thông điệp lấy từ từ điển tiếng Việt. */
export function apiErrorBody(error: ApiError): ApiErrorBody {
  const key = error.message_key ?? messageKeyOf(error.message);
  const { code, message, ...rest } = error;
  return {
    error: { code, message, ...(key ? { message_key: key } : {}), ...rest },
  };
}
