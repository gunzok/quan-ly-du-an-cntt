import { NextResponse, type NextRequest } from "next/server";
import { resolveOAuthCallback } from "@/lib/auth/oauth";
import { createClient } from "@/lib/supabase/server";

/**
 * Supabase Auth chuyển về đây sau khi Google xác thực (Story E1-2).
 * Đổi mã PKCE lấy phiên; client máy chủ ghi cookie phiên với sessionCookieOptions (httpOnly,
 * SameSite=Lax). Luôn chuyển tới đường dẫn cố định (`/` hoặc `/login?error=...`), không nhận `next`.
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const target = await resolveOAuthCallback(
    request.nextUrl.searchParams,
    (code) => supabase.auth.exchangeCodeForSession(code),
  );
  const response = NextResponse.redirect(
    new URL(target, request.nextUrl.origin),
  );
  // Response có ghi cookie phiên: không cho CDN/proxy cache.
  response.headers.set(
    "Cache-Control",
    "private, no-cache, no-store, must-revalidate, max-age=0",
  );
  return response;
}
