import type { SendResult } from "./types";

/**
 * Phân loại phản hồi HTTP của nhà cung cấp: 2xx thành công; 408, 409 (đang xử lý cùng khóa
 * idempotency), 429, 5xx thử lại; 4xx khác (sai khóa, địa chỉ không hợp lệ...) là lỗi cố định.
 * Mã lỗi chỉ gồm tên nhà cung cấp và mã HTTP: không đọc hay lưu thân phản hồi (có thể chứa địa chỉ).
 */
export function resultFromStatus(provider: string, status: number): SendResult {
  if (status >= 200 && status < 300) return { ok: true };
  const retryable =
    status === 408 || status === 409 || status === 429 || status >= 500;
  return { ok: false, retryable, code: `${provider}_http_${status}` };
}

/** Lỗi trước khi có phản hồi (mạng, hết thời gian): luôn thử lại. Không đưa thông điệp gốc vào mã. */
export function resultFromThrown(provider: string, error: unknown): SendResult {
  const name = (error as { name?: unknown })?.name;
  const timeout = name === "TimeoutError" || name === "AbortError";
  return {
    ok: false,
    retryable: true,
    code: `${provider}_${timeout ? "timeout" : "network_error"}`,
  };
}
