/**
 * Giao diện gửi email (ADR-002): nghiệp vụ chỉ biết `EmailSender`, đổi nhà cung cấp (Resend, Mailpit
 * cục bộ, bản giả trong test) không sửa nghiệp vụ.
 */

/** Một email đã dựng xong. Mọi trường đã được làm sạch (lib/email/sanitize.ts). */
export interface EmailMessage {
  to: string;
  subject: string;
  /** Bản text thuần (luôn có). */
  text: string;
  /** Bản HTML tối thiểu, nội dung người dùng đã thoát ký tự. */
  html: string;
  /**
   * Khóa chống gửi trùng phía nhà cung cấp (id dòng outbox). Resend nhận qua header
   * Idempotency-Key; Mailpit bỏ qua.
   */
  idempotencyKey?: string;
}

/**
 * Kết quả gửi. `code` là mã ngắn để log và lưu vào outbox (last_error): KHÔNG chứa nội dung email,
 * địa chỉ hay khóa. `retryable` = lỗi tạm thời (mạng, 5xx, 429) nên thử lại.
 */
export type SendResult =
  | { ok: true; providerId?: string }
  | { ok: false; retryable: boolean; code: string };

export interface EmailSender {
  /** Tên nhà cung cấp cho log ("resend", "mailpit"...). */
  readonly name: string;
  send(message: EmailMessage): Promise<SendResult>;
}

/** fetch rút gọn để test thay được. */
export type FetchLike = (
  input: string,
  init: RequestInit,
) => Promise<Pick<Response, "ok" | "status" | "json">>;
