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
  | "rate_limited"
  | "internal_error";

export type FieldIssue = "required" | "invalid_format" | "too_long";

export interface ApiErrorDetail {
  field: string;
  issue: FieldIssue;
}

export interface ApiError {
  code: ApiErrorCode;
  message: string;
  details?: ApiErrorDetail[];
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
  rate_limited: 429,
  internal_error: 500,
};

export function apiErrorBody(error: ApiError): ApiErrorBody {
  return { error };
}
