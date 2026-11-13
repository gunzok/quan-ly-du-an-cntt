import { createServerClient } from "@supabase/ssr";
import {
  isAuthApiError,
  isAuthSessionMissingError,
  type AuthError,
} from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { API_ERROR_STATUS, apiErrorBody } from "@/lib/api/errors";
import { decideAuthGate } from "@/lib/auth/routes";
import { strings } from "@/lib/strings";
import { sessionCookieOptions } from "./cookie-options";
import { getSupabasePublicEnv } from "./env";

/**
 * Làm mới phiên (nếu access token hết hạn) và chặn trang cần đăng nhập.
 * Theo mẫu của @supabase/ssr: cookie mới được ghi cả vào request (cho trang phía sau)
 * lẫn response (cho trình duyệt); khi chuyển hướng phải chép cookie sang response mới.
 */
export async function updateSession(request: NextRequest) {
  const { url, anonKey } = getSupabasePublicEnv();
  let response = NextResponse.next({ request });
  const pendingHeaders: Record<string, string> = {};

  const supabase = createServerClient(url, anonKey, {
    cookieOptions: sessionCookieOptions(),
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
        Object.assign(pendingHeaders, headers);
      },
    },
  });

  // getUser hỏi Supabase Auth (và làm mới phiên khi cần). Không dùng getClaims ở đây: JWT có thể
  // còn đúng chữ ký trong khi phiên đã bị thu hồi hoặc người dùng đã bị xóa; khi đó proxy cho qua
  // còn trang (getUser) đẩy về /login, gây vòng chuyển hướng. getUser lỗi thì thư viện xóa cookie.
  // Đánh đổi: thêm một lượt gọi Auth cho mỗi request đi qua proxy.
  const { data, error } = await supabase.auth.getUser();
  const isAuthenticated = Boolean(data.user);
  if (error && isRejectedSession(error)) {
    // Phiên bị Auth từ chối dứt khoát (người dùng bị xóa, phiên thu hồi, JWT sai): xóa cookie.
    await supabase.auth.signOut({ scope: "local" });
  }
  const decision = decideAuthGate(request.nextUrl.pathname, isAuthenticated);

  let result: NextResponse = response;
  if (decision.action === "redirect") {
    const target = request.nextUrl.clone();
    target.pathname = decision.to;
    target.search = "";
    result = withCookiesFrom(response, NextResponse.redirect(target));
  } else if (decision.action === "unauthorized") {
    result = withCookiesFrom(
      response,
      NextResponse.json(
        apiErrorBody({
          code: "unauthenticated",
          message: strings.errors.unauthenticated,
        }),
        { status: API_ERROR_STATUS.unauthenticated },
      ),
    );
  }

  // Response có ghi cookie phiên không được để CDN/proxy cache (header do thư viện cung cấp).
  for (const [key, value] of Object.entries(pendingHeaders)) {
    result.headers.set(key, value);
  }
  return result;
}

function withCookiesFrom(source: NextResponse, target: NextResponse) {
  for (const cookie of source.cookies.getAll()) {
    target.cookies.set(cookie);
  }
  return target;
}

/** Lỗi 4xx từ Auth (không phải lỗi mạng/5xx, không phải đơn giản là chưa có phiên). */
function isRejectedSession(error: AuthError): boolean {
  if (isAuthSessionMissingError(error) || !isAuthApiError(error)) {
    return false;
  }
  return error.status >= 400 && error.status < 500 && error.status !== 429;
}
