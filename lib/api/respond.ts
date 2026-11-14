import { strings } from "@/lib/strings";
import {
  API_ERROR_STATUS,
  apiErrorBody,
  type ApiError,
  type ApiErrorCode,
  type ApiErrorDetail,
} from "./errors";

/** Thông điệp mặc định cho từng mã lỗi khi nơi gọi không truyền thông điệp riêng. */
const DEFAULT_MESSAGE: Partial<Record<ApiErrorCode, string>> = {
  validation_failed: strings.api.validationFailed,
  unauthenticated: strings.api.unauthenticated,
  forbidden: strings.api.forbidden,
  not_found: strings.api.notFound,
  internal_error: strings.api.internal,
};

export function apiError(
  code: ApiErrorCode,
  message?: string,
  details?: ApiErrorDetail[],
): ApiError {
  return {
    code,
    message: message ?? DEFAULT_MESSAGE[code] ?? strings.api.internal,
    ...(details && details.length > 0 ? { details } : {}),
  };
}

/** Phản hồi lỗi theo api-contract.md mục 2; luôn kèm request_id để đối chiếu log. */
export function errorResponse(error: ApiError, requestId: string): Response {
  return Response.json(apiErrorBody({ ...error, request_id: requestId }), {
    status: API_ERROR_STATUS[error.code],
    headers: { "cache-control": "no-store" },
  });
}

export function jsonResponse(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store", ...headers },
  });
}
