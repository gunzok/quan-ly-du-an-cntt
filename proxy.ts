import type { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { rejectCrossOrigin } from "@/lib/api/csrf";
import {
  isRateLimitedApiPath,
  limitUser,
  logRateLimitUnavailable,
  rateLimitedResponse,
} from "@/lib/api/rate-limit";
import { isApiPath } from "@/lib/auth/routes";
import {
  buildContentSecurityPolicy,
  createNonce,
  CSP_HEADER,
  NONCE_HEADER,
  staticSecurityHeaders,
} from "@/lib/security/headers";
import { updateSession } from "@/lib/supabase/proxy";

/**
 * Giới hạn tần suất API theo người dùng. FAIL-OPEN: bộ đếm lỗi thì cho qua và ghi log, vì chặn
 * toàn bộ API khi CSDL chập chờn gây hại hơn; RLS và kiểm quyền vẫn áp dụng như thường.
 */
async function limitApi(userId: string): Promise<NextResponse | null> {
  const outcome = await limitUser(userId, "api");
  if (outcome.ok) {
    return null;
  }
  const requestId = randomUUID();
  if (outcome.reason === "limited") {
    return rateLimitedResponse(outcome.retryAfterSeconds, requestId);
  }
  logRateLimitUnavailable("api", outcome.detail, requestId);
  return null;
}

function applySecurityHeaders(response: Response, csp: string) {
  response.headers.set(CSP_HEADER, csp);
  for (const [key, value] of staticSecurityHeaders({
    isProduction: process.env.NODE_ENV === "production",
  })) {
    response.headers.set(key, value);
  }
}

// Next.js 16: "Middleware" đổi tên thành "Proxy" (file proxy.ts ở gốc dự án).
// Thứ tự: CSP + header an toàn cho mọi phản hồi; /api/* ghi dữ liệu phải cùng origin (CSRF);
// làm mới phiên và cổng đăng nhập; /api/v1/* giới hạn tần suất theo người dùng.
export async function proxy(request: NextRequest) {
  const nonce = createNonce();
  const csp = buildContentSecurityPolicy({
    nonce,
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    isDev: process.env.NODE_ENV === "development",
  });
  // Next.js đọc nonce từ header CSP của request khi render và gắn vào script của nó. Ghi đè mọi
  // giá trị client tự gửi.
  request.headers.set(CSP_HEADER, csp);
  request.headers.set(NONCE_HEADER, nonce);

  const pathname = request.nextUrl.pathname;
  const crossOrigin = isApiPath(pathname) ? rejectCrossOrigin(request) : null;
  const response =
    crossOrigin ??
    (await updateSession(request, {
      guard: isRateLimitedApiPath(pathname)
        ? ({ userId }) => limitApi(userId)
        : undefined,
    }));
  applySecurityHeaders(response, csp);
  return response;
}

export const config = {
  // Bỏ qua tài nguyên tĩnh và ảnh; mọi đường dẫn khác đi qua kiểm tra phiên.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
