import { resultFromStatus, resultFromThrown } from "./http-result";
import { parseMailbox } from "./sanitize";
import type { EmailMessage, EmailSender, FetchLike, SendResult } from "./types";

const TIMEOUT_MS = 5_000;
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

/** Mailpit chỉ dùng cục bộ: từ chối URL không phải máy này (tránh gửi dữ liệu ra ngoài do cấu hình nhầm). */
export function isLocalMailpitUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      LOCAL_HOSTS.has(url.hostname)
    );
  } catch {
    return false;
  }
}

/**
 * Gửi vào Mailpit cục bộ (hộp thư thử của `supabase start`, giao diện http://127.0.0.1:54324) qua
 * HTTP API `POST /api/v1/send` của Mailpit. Không dùng cổng SMTP vì `supabase start` không mở cổng
 * SMTP của Mailpit ra máy chủ theo mặc định (config.toml `[local_smtp] smtp_port` đang tắt) và gửi
 * qua HTTP không cần thêm thư viện SMTP. Chỉ cho phát triển và test.
 */
export function createMailpitSender(options: {
  baseUrl: string;
  from: string;
  fetch?: FetchLike;
}): EmailSender {
  if (!isLocalMailpitUrl(options.baseUrl)) {
    throw new Error("Mailpit chỉ dùng với địa chỉ cục bộ.");
  }
  const doFetch: FetchLike = options.fetch ?? fetch;
  const endpoint = new URL("/api/v1/send", options.baseUrl).toString();
  const from = parseMailbox(options.from);
  return {
    name: "mailpit",
    async send(message: EmailMessage): Promise<SendResult> {
      try {
        const res = await doFetch(endpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            From: from
              ? { Email: from.address, Name: from.name ?? "" }
              : { Email: options.from },
            To: [{ Email: message.to }],
            Subject: message.subject,
            Text: message.text,
            HTML: message.html,
          }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        return resultFromStatus("mailpit", res.status);
      } catch (error) {
        return resultFromThrown("mailpit", error);
      }
    },
  };
}
