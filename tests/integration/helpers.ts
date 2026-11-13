/**
 * Tiện ích dùng chung cho test tích hợp với Supabase cục bộ (E1-1, E1-2).
 * Khóa service_role chỉ dùng để tạo/xóa tài khoản tạm; chỉ chấp nhận URL localhost.
 */
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextRequest } from "next/server";
import { sessionCookieOptions } from "@/lib/supabase/cookie-options";
import { proxy } from "@/proxy";

export const SUPABASE_URL = process.env.SUPABASE_URL ?? "";
export const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? "";
export const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
export const APP_ORIGIN = "http://localhost:3000";

const LOCAL_HOSTS = ["127.0.0.1", "localhost", "::1", "[::1]"];

/** Từ chối chạy với Supabase không phải cục bộ; đặt biến công khai cho mã ứng dụng. */
export function assertLocalSupabase(url: string = SUPABASE_URL) {
  const host = new URL(url).hostname;
  if (!LOCAL_HOSTS.includes(host)) {
    throw new Error(
      `Test tích hợp chỉ chạy với dịch vụ cục bộ, từ chối ${host}`,
    );
  }
  process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE_URL;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = ANON_KEY;
}

export interface StoredCookie {
  name: string;
  value: string;
  options?: CookieOptions;
}

/** Hũ cookie trong bộ nhớ, đóng vai trình duyệt + next/headers. */
export class CookieJar {
  readonly cookies = new Map<string, StoredCookie>();

  getAll() {
    return [...this.cookies.values()].map(({ name, value }) => ({
      name,
      value,
    }));
  }

  set(cookie: StoredCookie) {
    if (cookie.value === "" || cookie.options?.maxAge === 0) {
      this.cookies.delete(cookie.name);
    } else {
      this.cookies.set(cookie.name, cookie);
    }
  }

  /** Cookie phiên (không gồm code verifier PKCE). */
  authCookies() {
    return [...this.cookies.values()].filter((c) =>
      /^sb-.+-auth-token(\.\d+)?$/.test(c.name),
    );
  }

  /**
   * Cookie code verifier PKCE do signInWithOAuth/signInWithOtp ghi (supabase-js ghi cả bản chung
   * `...-auth-token-code-verifier` lẫn bản theo luồng `...-flow-<id>-code-verifier`, `...-flows-...`).
   */
  codeVerifierCookies() {
    return [...this.cookies.values()].filter((c) =>
      /^sb-.+-auth-token-.*code-verifier(\.\d+)?$/.test(c.name),
    );
  }

  header() {
    return this.getAll()
      .map((c) => `${c.name}=${c.value}`)
      .join("; ");
  }

  clone() {
    const copy = new CookieJar();
    for (const c of this.cookies.values()) copy.cookies.set(c.name, { ...c });
    return copy;
  }
}

/** Client máy chủ giống lib/supabase/server.ts nhưng đọc/ghi vào CookieJar. */
export function serverClient(jar: CookieJar) {
  return createServerClient(SUPABASE_URL, ANON_KEY, {
    cookieOptions: sessionCookieOptions(),
    cookies: {
      getAll: () => jar.getAll(),
      setAll: (list) => list.forEach((c) => jar.set(c)),
    },
  });
}

export function callProxy(path: string, jar?: CookieJar) {
  const headers = new Headers();
  if (jar && jar.cookies.size > 0) headers.set("cookie", jar.header());
  return proxy(new NextRequest(new URL(path, APP_ORIGIN), { headers }));
}
