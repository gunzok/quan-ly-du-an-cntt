"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { ApiError } from "@/lib/api/errors";
import { createClient } from "@/lib/supabase/server";
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
 * Thành công: thư viện ghi cookie phiên httpOnly rồi chuyển về trang chủ.
 */
export async function signIn(
  _prev: SignInState,
  formData: FormData,
): Promise<SignInState> {
  const supabase = await createClient();
  const result = await signInWithPassword(supabase, readLoginForm(formData));
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
  const supabase = await createClient();
  const origin = (await headers()).get("origin");
  const result = await startGoogleSignIn(supabase, origin);
  redirect(result.ok ? result.url : loginErrorPath(result.error));
}

/** Đăng xuất phiên hiện tại: thu hồi refresh token ở Supabase Auth và xóa cookie. */
export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut({ scope: "local" });
  redirect(LOGIN_PATH);
}
