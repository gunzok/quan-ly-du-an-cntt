import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Nhận lời mời và đặt mật khẩu (Story E1-7, QLDA-80; security.md STRIDE F5).
 *
 * Luồng (theo tài liệu Supabase "Email Templates", mục server-side + "Email prefetching"):
 * 1. Admin mời bằng auth.admin.inviteUserByEmail. Mẫu email (supabase/templates/invite.html)
 *    trỏ về `{{ .SiteURL }}/auth/accept-invite?token_hash={{ .TokenHash }}&type=invite`, không có
 *    redirect_to.
 * 2. GET /auth/accept-invite CHỈ hiển thị form, KHÔNG tiêu token: trình quét link của hộp thư
 *    (ví dụ Safe Links) mở link trước cũng không làm hỏng lời mời.
 * 3. Người dùng gửi mật khẩu (Server Action): kiểm mật khẩu ở máy chủ trước, rồi mới
 *    verifyOtp({ token_hash, type: "invite" }) phía máy chủ (thư viện ghi cookie phiên httpOnly),
 *    rồi updateUser({ password }). Token dùng một lần; type luôn là "invite" (không lấy từ URL).
 *
 * Mọi lỗi của token (giả, hết hạn, đã dùng, sai loại) trả CÙNG một trạng thái "link không dùng
 * được": GoTrue cũng trả cùng mã `otp_expired`, nên không lộ người dùng có tồn tại hay không.
 */

/** Độ dài tối thiểu (ký tự) và tối đa (byte UTF-8, giới hạn bcrypt của Supabase Auth). */
export const NEW_PASSWORD_MIN_LENGTH = 12;
export const NEW_PASSWORD_MAX_BYTES = 72;

/**
 * Hình dạng token_hash chấp nhận: GoTrue hiện dùng chuỗi hex (SHA-224, 56 ký tự); để rộng cho
 * định dạng khác của Supabase (ví dụ tiền tố `pkce_`) nhưng chặn chuỗi rác hoặc quá dài.
 */
const TOKEN_HASH_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

export function isTokenHashShape(value: unknown): value is string {
  return typeof value === "string" && TOKEN_HASH_PATTERN.test(value);
}

/** Lấy token_hash từ searchParams của trang (giá trị lặp hoặc sai hình dạng: null). */
export function readTokenHashParam(
  value: string | string[] | undefined,
): string | null {
  return isTokenHashShape(value) ? value : null;
}

export type PasswordIssue = "required" | "too_short" | "too_long";
export type ConfirmIssue = "required" | "mismatch";

export interface AcceptInviteFieldErrors {
  password?: PasswordIssue;
  confirm?: ConfirmIssue;
}

export type AcceptInviteValidation =
  | { ok: true; data: { tokenHash: string; password: string } }
  | { ok: false; linkInvalid: true }
  | { ok: false; linkInvalid?: false; fieldErrors: AcceptInviteFieldErrors };

export function passwordIssue(password: string): PasswordIssue | undefined {
  if (password === "") {
    return "required";
  }
  if (new TextEncoder().encode(password).length > NEW_PASSWORD_MAX_BYTES) {
    return "too_long";
  }
  // Đếm theo điểm mã (không theo đơn vị UTF-16) để ký tự ngoài BMP tính là 1.
  if ([...password].length < NEW_PASSWORD_MIN_LENGTH) {
    return "too_short";
  }
  return undefined;
}

/** Schema phía máy chủ cho form đặt mật khẩu. Không tin kiểm tra ở giao diện. */
export function validateAcceptInviteForm(form: Pick<FormData, "get">) {
  const tokenHash = form.get("token_hash");
  if (!isTokenHashShape(tokenHash)) {
    return { ok: false, linkInvalid: true } satisfies AcceptInviteValidation;
  }
  const rawPassword = form.get("password");
  const rawConfirm = form.get("confirm_password");
  const password = typeof rawPassword === "string" ? rawPassword : "";
  const confirm = typeof rawConfirm === "string" ? rawConfirm : "";

  const fieldErrors: AcceptInviteFieldErrors = {};
  const pwIssue = passwordIssue(password);
  if (pwIssue) {
    fieldErrors.password = pwIssue;
  }
  if (confirm === "") {
    fieldErrors.confirm = "required";
  } else if (confirm !== password) {
    fieldErrors.confirm = "mismatch";
  }
  if (fieldErrors.password || fieldErrors.confirm) {
    return { ok: false, fieldErrors } satisfies AcceptInviteValidation;
  }
  return {
    ok: true,
    data: { tokenHash, password },
  } satisfies AcceptInviteValidation;
}

interface AuthErrorLike {
  status?: number;
  code?: string;
  name?: string;
}

export type AcceptInviteFailure =
  /** Token giả, hết hạn, đã dùng: hướng dẫn xin Admin gửi lại. */
  | "link_invalid"
  | "rate_limited"
  /** Supabase Auth lỗi máy chủ/mạng khi kiểm token (token CHƯA bị tiêu, thử lại được). */
  | "unavailable"
  /** Token đã được dùng (đã có phiên) nhưng không đặt được mật khẩu. */
  | "password_not_set";

export type AcceptInviteResult =
  { ok: true } | { ok: false; reason: AcceptInviteFailure };

function isServerOrNetwork(error: AuthErrorLike): boolean {
  return (
    error.name === "AuthRetryableFetchError" ||
    error.status === undefined ||
    error.status === 0 ||
    error.status >= 500
  );
}

/** Lỗi verifyOtp: mọi lỗi 4xx (otp_expired, token sai, ...) gom về link_invalid. */
export function mapVerifyError(error: AuthErrorLike): AcceptInviteFailure {
  if (error.status === 429 || error.code === "over_request_rate_limit") {
    return "rate_limited";
  }
  return isServerOrNetwork(error) ? "unavailable" : "link_invalid";
}

/**
 * Tiêu token mời rồi đặt mật khẩu. `supabase` phải là client máy chủ (createServerClient) để
 * phiên được ghi vào cookie httpOnly. Không làm phiên lẫn: nếu đặt mật khẩu thất bại sau khi token
 * đã bị tiêu thì đăng xuất cục bộ (xóa cookie) và báo password_not_set.
 */
export async function acceptInvite(
  supabase: SupabaseClient,
  input: { tokenHash: string; password: string },
): Promise<AcceptInviteResult> {
  let verified: Awaited<ReturnType<SupabaseClient["auth"]["verifyOtp"]>>;
  try {
    verified = await supabase.auth.verifyOtp({
      token_hash: input.tokenHash,
      type: "invite",
    });
  } catch {
    return { ok: false, reason: "unavailable" };
  }
  if (verified.error || !verified.data.session) {
    return {
      ok: false,
      reason: mapVerifyError(verified.error ?? { status: 403 }),
    };
  }

  let updated: { error: AuthErrorLike | null };
  try {
    updated = await supabase.auth.updateUser({ password: input.password });
  } catch {
    updated = { error: { status: 0 } };
  }
  if (updated.error) {
    await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
    return { ok: false, reason: "password_not_set" };
  }
  return { ok: true };
}
