import type { ApiError, ApiErrorDetail } from "./errors";
import { apiError } from "./respond";

/**
 * Tiện ích đọc và kiểm request dùng chung cho Route Handler /api/v1 (không phụ thuộc tài nguyên).
 * Schema viết tay như lib/auth/validate.ts, không thêm thư viện.
 */

export type Validation<T> =
  { ok: true; data: T } | { ok: false; details: ApiErrorDetail[] };

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

export function isPlainObject(
  value: unknown,
): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

/** Trường không có trong danh sách cho phép: `unknown_field` (tên cắt 64 ký tự). */
export function unknownFields(
  keys: Iterable<string>,
  allowed: readonly string[],
): ApiErrorDetail[] {
  const details: ApiErrorDetail[] = [];
  for (const key of keys) {
    if (!allowed.includes(key)) {
      details.push({ field: key.slice(0, 64), issue: "unknown_field" });
    }
  }
  return details;
}

/**
 * Chống CSRF: một bản duy nhất ở lib/api/csrf.ts (Story E0-5); proxy.ts áp cho mọi /api/* ghi
 * dữ liệu. Giữ tên xuất ở đây để handler và test hiện có không đổi.
 */
export { isSameOrigin } from "./csrf";

/** Đọc thân JSON có giới hạn kích thước; sai kiểu nội dung hoặc JSON hỏng: 400. */
export async function readJsonBody(
  request: Request,
  maxBytes: number,
): Promise<{ ok: true; body: unknown } | { ok: false; error: ApiError }> {
  const invalid = apiError("validation_failed", undefined, [
    { field: "body", issue: "invalid_format" },
  ]);
  const type = request.headers.get("content-type") ?? "";
  if (!/^application\/json(\s*;|$)/i.test(type)) {
    return { ok: false, error: invalid };
  }
  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > maxBytes) {
    return {
      ok: false,
      error: apiError("validation_failed", undefined, [
        { field: "body", issue: "too_long" },
      ]),
    };
  }
  try {
    return { ok: true, body: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, error: invalid };
  }
}
