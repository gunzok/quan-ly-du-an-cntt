"use server";

import { redirect } from "next/navigation";
import type { ApiError } from "@/lib/api/errors";
import { createClient } from "@/lib/supabase/server";
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

/** Đăng xuất phiên hiện tại: thu hồi refresh token ở Supabase Auth và xóa cookie. */
export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut({ scope: "local" });
  redirect(LOGIN_PATH);
}
