import { describe, expect, it } from "vitest";
import {
  decideAfterFailure,
  EMAIL_MAX_ATTEMPTS,
  EMAIL_MAX_RETRIES,
  retryDelayMs,
} from "./retry";

describe("chính sách thử lại email", () => {
  it("thử lại tối đa 3 lần (4 lần gửi)", () => {
    expect(EMAIL_MAX_RETRIES).toBe(3);
    expect(EMAIL_MAX_ATTEMPTS).toBe(4);
  });

  it("giãn cách tăng dần 1, 5, 15 phút rồi dừng", () => {
    expect(retryDelayMs(1)).toBe(60_000);
    expect(retryDelayMs(2)).toBe(300_000);
    expect(retryDelayMs(3)).toBe(900_000);
    expect(retryDelayMs(4)).toBeNull();
    expect(retryDelayMs(9)).toBeNull();
    const delays = [1, 2, 3].map((n) => retryDelayMs(n) as number);
    expect([...delays].sort((a, b) => a - b)).toEqual(delays);
  });

  it("lỗi tạm thời: thử lại đúng thời điểm", () => {
    const now = new Date("2026-11-18T01:00:00Z");
    expect(decideAfterFailure({ attempt: 2, retryable: true, now })).toEqual({
      kind: "retry",
      retryAt: new Date("2026-11-18T01:05:00Z"),
    });
  });

  it("hết lượt hoặc lỗi cố định: failed", () => {
    const now = new Date();
    expect(decideAfterFailure({ attempt: 4, retryable: true, now })).toEqual({
      kind: "failed",
    });
    expect(decideAfterFailure({ attempt: 1, retryable: false, now })).toEqual({
      kind: "failed",
    });
  });
});
