import type { ApiError, ApiErrorCode } from "@/lib/api/errors";
import { lookupMessage, messageKeyOf } from "./message-key";
import type { Messages } from "./messages/vi";
import { vi } from "./messages/vi";

/** Thông điệp chung theo mã lỗi khi không dịch được thông điệp cụ thể. */
function genericMessage(t: Messages, code: ApiErrorCode): string {
  switch (code) {
    case "validation_failed":
      return t.api.validationFailed;
    case "unauthenticated":
      return t.api.unauthenticated;
    case "forbidden":
      return t.api.forbidden;
    case "not_found":
      return t.api.notFound;
    case "rate_limited":
      return t.security.rateLimited;
    default:
      return t.api.internal;
  }
}

/**
 * Văn bản hiển thị cho một lỗi API trong ngôn ngữ của giao diện:
 * 1. `message_key` trỏ tới chuỗi trong từ điển hiện tại: dùng chuỗi đó;
 * 2. không có khóa nhưng `message` là chuỗi tiếng Việt có trong từ điển (lỗi do Server Action, proxy
 *    hay client tự tạo): dịch theo khóa tìm ngược;
 * 3. giao diện tiếng Việt: giữ nguyên `message` (có thể là chuỗi động như tên phòng ban);
 * 4. còn lại: thông điệp chung theo `code`.
 */
export function apiErrorText(t: Messages, error: ApiError): string {
  const key = error.message_key ?? messageKeyOf(error.message);
  const translated = lookupMessage(t, key);
  if (translated) return translated;
  if (t === vi && error.message) return error.message;
  return genericMessage(t, error.code);
}
