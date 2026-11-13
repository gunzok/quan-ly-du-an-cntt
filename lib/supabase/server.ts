import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { sessionCookieOptions } from "./cookie-options";
import { getSupabasePublicEnv } from "./env";

/**
 * Client Supabase cho Server Component, Server Action, Route Handler.
 * Tạo mới cho mỗi request; không dùng chung giữa các request.
 */
export async function createClient() {
  // cookies() trước: với Cache Components, đây là điểm báo trang động (không prerender lúc build).
  const cookieStore = await cookies();
  const { url, anonKey } = getSupabasePublicEnv();

  return createServerClient(url, anonKey, {
    cookieOptions: sessionCookieOptions(),
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Component không được ghi cookie; proxy.ts đã làm mới phiên trước đó.
        }
      },
    },
  });
}
