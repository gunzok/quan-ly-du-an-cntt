import type { SupabaseClient } from "@supabase/supabase-js";
import { strings } from "@/lib/strings";
import { AUTH_CALLBACK_PATH, HOME_PATH, LOGIN_PATH } from "./routes";

/** Route Handler nhận mã từ Supabase Auth sau khi đăng nhập Google. */
export const OAUTH_CALLBACK_PATH = AUTH_CALLBACK_PATH;

/** Tham số trên /login mang khóa lỗi đăng nhập Google (chỉ nhận khóa đã biết, không nhận văn bản). */
export const LOGIN_ERROR_PARAM = "error";

/** Mã PKCE của Supabase là UUID; giới hạn rộng để chặn chuỗi rác quá dài. */
const AUTH_CODE_MAX_LENGTH = 512;

export type OAuthErrorKey = "not_invited" | "rate_limited" | "oauth_failed";

const OAUTH_ERROR_KEYS: readonly OAuthErrorKey[] = [
  "not_invited",
  "rate_limited",
  "oauth_failed",
];

interface AuthErrorLike {
  status?: number;
  code?: string;
  name?: string;
  message?: string;
}

/**
 * Ánh xạ lỗi từ Supabase Auth (tham số error_code/error_description trên URL callback, hoặc lỗi
 * khi đổi mã) sang khóa lỗi hiển thị. `signup_disabled`: tài khoản Google chưa có trong hệ thống
 * và Auth đã tắt đăng ký (enable_signup = false), tức là chưa được Admin mời.
 */
export function mapOAuthError(error: AuthErrorLike): OAuthErrorKey {
  if (
    error.code === "signup_disabled" ||
    /signups? not allowed/i.test(error.message ?? "")
  ) {
    return "not_invited";
  }
  if (error.status === 429 || error.code === "over_request_rate_limit") {
    return "rate_limited";
  }
  return "oauth_failed";
}

/** Đường dẫn trang đăng nhập kèm khóa lỗi. */
export function loginErrorPath(key: OAuthErrorKey): string {
  return `${LOGIN_PATH}?${LOGIN_ERROR_PARAM}=${key}`;
}

/**
 * Thông báo cho khóa lỗi trên /login. Giá trị lạ trả undefined: không bao giờ hiển thị
 * văn bản lấy từ URL (tránh chèn nội dung giả mạo vào trang đăng nhập).
 */
export function loginErrorMessage(
  value: string | string[] | undefined,
): string | undefined {
  const key = Array.isArray(value) ? value[0] : value;
  return OAUTH_ERROR_KEYS.includes(key as OAuthErrorKey)
    ? strings.errors.oauth[key as OAuthErrorKey]
    : undefined;
}

/**
 * URL Supabase Auth chuyển về sau khi Google xác thực: luôn là /auth/callback trên origin của app.
 * Không có tham số `next` tự do (tránh open redirect); Supabase Auth còn đối chiếu URL này với
 * danh sách cho phép (additional_redirect_urls / Redirect URLs ở Dashboard).
 */
export function buildOAuthRedirectUrl(
  origin: string | null | undefined,
): string | null {
  if (!origin) {
    return null;
  }
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return null;
  }
  return `${url.origin}${OAUTH_CALLBACK_PATH}`;
}

export type StartGoogleResult =
  { ok: true; url: string } | { ok: false; error: OAuthErrorKey };

/**
 * Tạo URL đăng nhập Google qua Supabase Auth (luồng PKCE). Client phải là client máy chủ
 * (createServerClient): thư viện ghi code verifier vào cookie httpOnly để Route Handler
 * /auth/callback đọc lại khi đổi mã. Không gọi mạng; trình duyệt được chuyển tới URL trả về.
 */
export async function startGoogleSignIn(
  supabase: SupabaseClient,
  origin: string | null | undefined,
): Promise<StartGoogleResult> {
  const redirectTo = buildOAuthRedirectUrl(origin);
  if (!redirectTo) {
    return { ok: false, error: "oauth_failed" };
  }
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo,
      skipBrowserRedirect: true,
      // Luôn hỏi chọn tài khoản để người dùng dùng đúng email đã được mời.
      queryParams: { prompt: "select_account" },
    },
  });
  if (error || !data.url) {
    return { ok: false, error: mapOAuthError(error ?? {}) };
  }
  return { ok: true, url: data.url };
}

/**
 * Xử lý tham số của /auth/callback, trả đường dẫn nội bộ cần chuyển tới:
 * - có `error`/`error_code` (Auth từ chối, ví dụ chưa được mời, hoặc người dùng hủy): về /login kèm lỗi;
 * - có `code`: đổi mã lấy phiên (thư viện ghi cookie phiên httpOnly), thành công về `/`;
 * - không có gì hợp lệ: về /login kèm lỗi chung.
 * Kết quả luôn là đường dẫn cố định, không lấy từ URL.
 */
export async function resolveOAuthCallback(
  params: URLSearchParams,
  exchangeCode: (code: string) => Promise<{ error: AuthErrorLike | null }>,
): Promise<string> {
  const errorCode = params.get("error_code");
  const error = params.get("error");
  if (errorCode || error) {
    return loginErrorPath(
      mapOAuthError({
        code: errorCode ?? undefined,
        message: params.get("error_description") ?? undefined,
      }),
    );
  }

  const code = params.get("code");
  if (!code || code.length > AUTH_CODE_MAX_LENGTH) {
    return loginErrorPath("oauth_failed");
  }

  let result: { error: AuthErrorLike | null };
  try {
    result = await exchangeCode(code);
  } catch {
    return loginErrorPath("oauth_failed");
  }
  if (result.error) {
    return loginErrorPath(mapOAuthError(result.error));
  }
  return HOME_PATH;
}
