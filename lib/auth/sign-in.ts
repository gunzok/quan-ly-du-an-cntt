import type { SupabaseClient } from "@supabase/supabase-js";
import type { ApiError } from "@/lib/api/errors";
import { strings } from "@/lib/strings";
import { validateLoginInput } from "./validate";

export type SignInResult =
  { ok: true; email: string } | { ok: false; error: ApiError; email: string };

interface AuthErrorLike {
  status?: number;
  code?: string;
  name?: string;
}

/**
 * Ánh xạ lỗi Supabase Auth sang lỗi trả cho người dùng.
 * Mọi lỗi phía tài khoản (sai mật khẩu, không tồn tại, chưa xác nhận email, bị khóa)
 * đều trả CÙNG một lỗi chung để không lộ tài khoản có tồn tại hay không.
 */
export function mapSignInError(error: AuthErrorLike): ApiError {
  if (error.status === 429 || error.code === "over_request_rate_limit") {
    return { code: "rate_limited", message: strings.errors.rateLimited };
  }
  const isServerOrNetwork =
    error.name === "AuthRetryableFetchError" ||
    error.status === undefined ||
    error.status === 0 ||
    error.status >= 500;
  if (isServerOrNetwork) {
    return { code: "internal_error", message: strings.errors.internal };
  }
  return {
    code: "unauthenticated",
    message: strings.errors.invalidCredentials,
  };
}

/**
 * Kiểm tra đầu vào rồi đăng nhập bằng email/mật khẩu qua client Supabase phía máy chủ.
 * Client phải được tạo bằng createServerClient để thư viện ghi cookie phiên.
 */
export async function signInWithPassword(
  supabase: SupabaseClient,
  raw: { email: unknown; password: unknown },
): Promise<SignInResult> {
  const echoEmail = typeof raw.email === "string" ? raw.email.trim() : "";
  const parsed = validateLoginInput(raw);
  if (!parsed.ok) {
    return {
      ok: false,
      email: echoEmail,
      error: {
        code: "validation_failed",
        message: strings.errors.validationFailed,
        details: parsed.details,
      },
    };
  }

  const { data, error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error || !data.session) {
    return {
      ok: false,
      email: parsed.data.email,
      error: mapSignInError(error ?? {}),
    };
  }
  return { ok: true, email: parsed.data.email };
}
