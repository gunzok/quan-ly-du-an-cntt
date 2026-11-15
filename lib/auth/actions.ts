"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { ApiError } from "@/lib/api/errors";
import { clientIp } from "@/lib/api/rate-limit";
import { createClient } from "@/lib/supabase/server";
import { limitLoginAttempt } from "./login-rate-limit";
import { loginErrorPath, startGoogleSignIn } from "./oauth";
import { HOME_PATH, LOGIN_PATH } from "./routes";
import { signInWithPassword } from "./sign-in";
import { readLoginForm } from "./validate";

export interface SignInState {
  error?: ApiError;
  /** Email đã nhập, trả lại để giữ trong ô nhập khi lỗi. Không bao giờ trả mật khẩu. */
  email?: string;
}

/**
 * Server Action đăng nhập. Next.js tự kiểm tra Origin của Server Action (chống CSRF).
 * Giới hạn số lần thử theo IP và email (lib/auth/login-rate-limit.ts) trước khi hỏi Supabase Auth.
 * Thành công: thư viện ghi cookie phiên httpOnly rồi chuyển về trang chủ.
 */
export async function signIn(
  _prev: SignInState,
  formData: FormData,
): Promise<SignInState> {
  const form = readLoginForm(formData);
  const gate = await limitLoginAttempt({
    ip: clientIp(await headers()),
    email: form.email,
  });
  if (!gate.ok) {
    return {
      error: gate.error,
      email: typeof form.email === "string" ? form.email.trim() : "",
    };
  }
  const supabase = await createClient();
  const result = await signInWithPassword(supabase, form);
  if (!result.ok) {
    return { error: result.error, email: result.email };
  }
  redirect(HOME_PATH);
}

/**
 * Server Action bắt đầu đăng nhập Google (Story E1-2). Chạy ở máy chủ để code verifier PKCE nằm
 * trong cookie httpOnly như cookie phiên (client trình duyệt không đọc/ghi được cookie này).
 * Next.js đã đối chiếu header Origin với Host cho Server Action nên dùng Origin làm gốc URL callback.
 */
export async function signInWithGoogle(): Promise<void> {
  const requestHeaders = await headers();
  const gate = await limitLoginAttempt({ ip: clientIp(requestHeaders) });
  if (!gate.ok) {
    redirect(
      loginErrorPath(
        gate.error.code === "rate_limited" ? "rate_limited" : "oauth_failed",
      ),
    );
  }
  const supabase = await createClient();
  const origin = requestHeaders.get("origin");
  const result = await startGoogleSignIn(supabase, origin);
  redirect(result.ok ? result.url : loginErrorPath(result.error));
}

/** Đăng xuất phiên hiện tại: thu hồi refresh token ở Supabase Auth và xóa cookie. */
export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut({ scope: "local" });
  redirect(LOGIN_PATH);
}
