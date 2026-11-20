import { createMailpitSender, isLocalMailpitUrl } from "./mailpit";
import { createResendSender } from "./resend";
import { parseMailbox } from "./sanitize";
import type { EmailSender, FetchLike } from "./types";

/**
 * Chọn bộ gửi email theo biến môi trường (không bao giờ commit giá trị thật):
 *
 *   EMAIL_PROVIDER   resend | mailpit | disabled. Bỏ trống: có RESEND_API_KEY → resend; không có
 *                    và KHÔNG phải production/preview → mailpit; còn lại → tắt.
 *   RESEND_API_KEY   khóa API Resend (chỉ máy chủ).
 *   EMAIL_FROM       người gửi, ví dụ "Quản lý dự án <no-reply@ten-mien-cong-ty>". Bắt buộc với
 *                    resend; mailpit có mặc định.
 *   MAILPIT_URL      mặc định http://127.0.0.1:54324 (chỉ nhận địa chỉ cục bộ).
 *   APP_BASE_URL     gốc tuyệt đối để dựng liên kết trong email, ví dụ https://qlda.example.com.
 *
 * Thiếu cấu hình KHÔNG làm sập: trả `{ enabled: false, reason }` để worker ghi log và bỏ qua (dòng
 * outbox vẫn pending, quá 24 giờ thì skipped).
 */
export type EmailProviderName = "resend" | "mailpit";

export type EmailConfig =
  | {
      enabled: true;
      provider: EmailProviderName;
      sender: EmailSender;
      appBaseUrl: string;
    }
  | { enabled: false; reason: string };

export const DEFAULT_MAILPIT_URL = "http://127.0.0.1:54324";
export const DEFAULT_LOCAL_APP_BASE_URL = "http://localhost:3000";
export const DEFAULT_LOCAL_FROM = "Quản lý dự án <no-reply@qlda.local>";

type Env = Record<string, string | undefined>;

/** production/preview trên Vercel hoặc NODE_ENV=production. */
export function isDeployedEnv(env: Env): boolean {
  return (
    env.VERCEL_ENV === "production" ||
    env.VERCEL_ENV === "preview" ||
    env.NODE_ENV === "production"
  );
}

/** Gốc liên kết: http(s), không đường dẫn con, không thông tin đăng nhập; bỏ "/" cuối. */
export function parseAppBaseUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (url.username || url.password || url.search || url.hash) return null;
    if (url.pathname !== "/" && url.pathname !== "") return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function resolveEmailConfig(
  env: Env = process.env,
  options: { fetch?: FetchLike } = {},
): EmailConfig {
  const explicit = env.EMAIL_PROVIDER?.trim().toLowerCase();
  let provider: string;
  if (explicit) {
    provider = explicit;
  } else if (env.RESEND_API_KEY) {
    provider = "resend";
  } else if (!isDeployedEnv(env)) {
    provider = "mailpit";
  } else {
    return { enabled: false, reason: "provider_not_configured" };
  }

  if (provider === "disabled") return { enabled: false, reason: "disabled" };

  // Cục bộ (không phải production/preview) mà bỏ trống: `pnpm dev` ở cổng 3000.
  const appBaseUrl = env.APP_BASE_URL
    ? parseAppBaseUrl(env.APP_BASE_URL)
    : isDeployedEnv(env)
      ? null
      : DEFAULT_LOCAL_APP_BASE_URL;
  if (!appBaseUrl) return { enabled: false, reason: "app_base_url_missing" };

  if (provider === "resend") {
    if (!env.RESEND_API_KEY) {
      return { enabled: false, reason: "resend_api_key_missing" };
    }
    const from = env.EMAIL_FROM?.trim();
    if (!from || !parseMailbox(from)) {
      return { enabled: false, reason: "email_from_invalid" };
    }
    return {
      enabled: true,
      provider: "resend",
      appBaseUrl,
      sender: createResendSender({
        apiKey: env.RESEND_API_KEY,
        from,
        fetch: options.fetch,
      }),
    };
  }

  if (provider === "mailpit") {
    const baseUrl = env.MAILPIT_URL?.trim() || DEFAULT_MAILPIT_URL;
    if (!isLocalMailpitUrl(baseUrl)) {
      return { enabled: false, reason: "mailpit_url_not_local" };
    }
    const from = env.EMAIL_FROM?.trim() || DEFAULT_LOCAL_FROM;
    if (!parseMailbox(from)) {
      return { enabled: false, reason: "email_from_invalid" };
    }
    return {
      enabled: true,
      provider: "mailpit",
      appBaseUrl,
      sender: createMailpitSender({ baseUrl, from, fetch: options.fetch }),
    };
  }

  return { enabled: false, reason: "provider_unknown" };
}
