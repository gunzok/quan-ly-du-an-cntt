import { resultFromStatus, resultFromThrown } from "./http-result";
import type { EmailMessage, EmailSender, FetchLike, SendResult } from "./types";

/** API gửi của Resend (https://resend.com/docs/api-reference/emails/send-email). */
export const RESEND_ENDPOINT = "https://api.resend.com/emails";
const TIMEOUT_MS = 10_000;

/**
 * Gửi qua Resend bằng HTTP API (fetch), không thêm SDK. Khóa chỉ nằm trong header Authorization,
 * không bao giờ vào log hay mã lỗi.
 */
export function createResendSender(options: {
  apiKey: string;
  from: string;
  fetch?: FetchLike;
}): EmailSender {
  const doFetch: FetchLike = options.fetch ?? fetch;
  return {
    name: "resend",
    async send(message: EmailMessage): Promise<SendResult> {
      const headers: Record<string, string> = {
        authorization: `Bearer ${options.apiKey}`,
        "content-type": "application/json",
      };
      if (message.idempotencyKey) {
        headers["idempotency-key"] = message.idempotencyKey;
      }
      try {
        const res = await doFetch(RESEND_ENDPOINT, {
          method: "POST",
          headers,
          body: JSON.stringify({
            from: options.from,
            to: [message.to],
            subject: message.subject,
            text: message.text,
            html: message.html,
          }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        const result = resultFromStatus("resend", res.status);
        if (!result.ok) return result;
        const body = (await res.json().catch(() => null)) as {
          id?: unknown;
        } | null;
        return {
          ok: true,
          providerId: typeof body?.id === "string" ? body.id : undefined,
        };
      } catch (error) {
        return resultFromThrown("resend", error);
      }
    },
  };
}
