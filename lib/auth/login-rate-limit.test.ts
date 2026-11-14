import { describe, expect, it, vi } from "vitest";
import { strings } from "@/lib/strings";
import {
  limitLoginAttempt,
  loginGateFrom,
  loginRateLimitChecks,
  normalizeLoginEmail,
} from "./login-rate-limit";

describe("normalizeLoginEmail", () => {
  it("cắt khoảng trắng, chữ thường; rỗng/quá dài/không phải chuỗi thì null", () => {
    expect(normalizeLoginEmail("  PM@Example.COM ")).toBe("pm@example.com");
    expect(normalizeLoginEmail("")).toBeNull();
    expect(normalizeLoginEmail("   ")).toBeNull();
    expect(normalizeLoginEmail(`${"a".repeat(260)}@x.vn`)).toBeNull();
    expect(normalizeLoginEmail(null)).toBeNull();
  });
});

describe("loginRateLimitChecks", () => {
  it("mật khẩu: đếm theo IP và email; Google: chỉ IP", () => {
    expect(loginRateLimitChecks({ ip: "1.2.3.4", email: "A@x.vn" })).toEqual([
      { name: "loginIp", identifier: "ip:1.2.3.4" },
      { name: "loginEmail", identifier: "email:a@x.vn" },
    ]);
    expect(loginRateLimitChecks({ ip: null })).toEqual([
      { name: "loginIp", identifier: "ip:unknown" },
    ]);
  });
});

describe("loginGateFrom", () => {
  it("vượt ngưỡng: rate_limited với thông điệp đăng nhập", () => {
    expect(
      loginGateFrom({ ok: false, reason: "limited", retryAfterSeconds: 5 }),
    ).toEqual({
      ok: false,
      error: { code: "rate_limited", message: strings.errors.rateLimited },
    });
  });

  it("bộ đếm lỗi: FAIL-CLOSED, internal_error, có ghi log không lộ dữ liệu", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(
      loginGateFrom({ ok: false, reason: "unavailable", detail: "db_08006" }),
    ).toEqual({
      ok: false,
      error: { code: "internal_error", message: strings.errors.internal },
    });
    expect(log).toHaveBeenCalledOnce();
    expect(JSON.parse(String(log.mock.calls[0][0]))).toEqual({
      level: "error",
      event: "rate_limit_unavailable",
      where: "login",
      detail: "db_08006",
    });
    log.mockRestore();
  });

  it("cho qua khi chưa vượt", async () => {
    const consume = vi.fn(async () => ({ ok: true as const }));
    expect(
      await limitLoginAttempt({ ip: null, email: "a@x.vn" }, consume),
    ).toEqual({ ok: true });
    expect(consume).toHaveBeenCalledWith([
      { name: "loginIp", identifier: "ip:unknown" },
      { name: "loginEmail", identifier: "email:a@x.vn" },
    ]);
  });
});
