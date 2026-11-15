import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { strings } from "@/lib/strings";
import { API_ERROR_STATUS, apiErrorBody } from "./errors";

/**
 * Chống CSRF cho Route Handler ghi dữ liệu (security.md STRIDE F1 "Tampering", Story E0-5).
 *
 * proxy.ts gọi `rejectCrossOrigin` cho MỌI request /api/* trước khi tới Route Handler, nên handler
 * mới không cần tự nhớ kiểm tra. Handler vẫn có thể gọi `isSameOrigin` để phòng thủ chiều sâu
 * (ví dụ handler quản trị người dùng, test tích hợp gọi thẳng handler không qua proxy).
 *
 * Server Action không đi qua đây: Next.js tự đối chiếu Origin với Host cho Server Action.
 * Cookie phiên đã là SameSite=Lax; kiểm Origin là lớp thứ hai.
 */

/** Phương thức thay đổi dữ liệu; GET, HEAD, OPTIONS không bị kiểm (không được ghi dữ liệu). */
export const UNSAFE_METHODS: ReadonlySet<string> = new Set([
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
]);

export function isUnsafeMethod(method: string): boolean {
  return UNSAFE_METHODS.has(method.toUpperCase());
}

/**
 * Header Origin phải trùng đúng origin của chính ứng dụng (giao thức, host, cổng).
 * Trình duyệt luôn gửi Origin với POST/PUT/PATCH/DELETE; thiếu Origin (hoặc "null") thì từ chối.
 */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) {
    return false;
  }
  return origin === new URL(request.url).origin;
}

/** 403 `forbidden` theo api-contract.md mục 2. */
export function crossOriginResponse(
  requestId: string = randomUUID(),
): NextResponse {
  return NextResponse.json(
    apiErrorBody({
      code: "forbidden",
      message: strings.security.crossOrigin,
      request_id: requestId,
    }),
    {
      status: API_ERROR_STATUS.forbidden,
      headers: { "cache-control": "no-store" },
    },
  );
}

/** Trả phản hồi 403 nếu request ghi dữ liệu đến từ origin khác; ngược lại null (cho qua). */
export function rejectCrossOrigin(request: Request): NextResponse | null {
  if (!isUnsafeMethod(request.method) || isSameOrigin(request)) {
    return null;
  }
  return crossOriginResponse();
}
