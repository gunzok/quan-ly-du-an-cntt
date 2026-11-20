/**
 * Chính sách thử lại email (AC2 Story E4-2, ADR-002 "thử lại tối đa 3 lần"): lần gửi đầu + tối đa 3
 * lần thử lại = 4 lần, giãn cách tăng dần 1, 5, 15 phút. Hết lượt hoặc lỗi cố định (ví dụ địa chỉ
 * bị nhà cung cấp từ chối) thì `failed`. CSDL chỉ ghi kết quả (public.email_outbox_finish).
 */
export const EMAIL_MAX_RETRIES = 3;
export const EMAIL_MAX_ATTEMPTS = EMAIL_MAX_RETRIES + 1;

/** Giãn cách trước lần thử lại thứ 1, 2, 3 (mili giây). */
export const EMAIL_RETRY_DELAYS_MS: readonly number[] = [
  60_000,
  5 * 60_000,
  15 * 60_000,
];

/** Giãn cách sau khi lần gửi thứ `attempt` (1-based) thất bại; null khi đã hết lượt. */
export function retryDelayMs(attempt: number): number | null {
  if (!Number.isInteger(attempt) || attempt < 1)
    return EMAIL_RETRY_DELAYS_MS[0];
  if (attempt >= EMAIL_MAX_ATTEMPTS) return null;
  return EMAIL_RETRY_DELAYS_MS[
    Math.min(attempt, EMAIL_RETRY_DELAYS_MS.length) - 1
  ];
}

export type FailureDecision =
  { kind: "retry"; retryAt: Date } | { kind: "failed" };

/** Sau một lần gửi lỗi: thử lại lúc nào, hay dừng hẳn. */
export function decideAfterFailure(input: {
  attempt: number;
  retryable: boolean;
  now: Date;
}): FailureDecision {
  if (!input.retryable) return { kind: "failed" };
  const delay = retryDelayMs(input.attempt);
  if (delay === null) return { kind: "failed" };
  return { kind: "retry", retryAt: new Date(input.now.getTime() + delay) };
}
