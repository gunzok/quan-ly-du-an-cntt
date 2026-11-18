import { describe, expect, it, vi } from "vitest";
import { parseAppBaseUrl, resolveEmailConfig } from "./config";

const ok = (status = 200, body: unknown = {}) =>
  vi.fn().mockResolvedValue({
    ok: status < 300,
    status,
    json: async () => body,
  });

describe("parseAppBaseUrl", () => {
  it("nhận origin http(s), bỏ / cuối", () => {
    expect(parseAppBaseUrl("https://qlda.example.com/")).toBe(
      "https://qlda.example.com",
    );
  });
  it.each([
    "ftp://x.vn",
    "javascript:alert(1)",
    "https://u:p@x.vn",
    "https://x.vn/app",
    "https://x.vn/?a=1",
    "khong-phai-url",
  ])("từ chối %j", (value) => {
    expect(parseAppBaseUrl(value)).toBeNull();
  });
});

describe("resolveEmailConfig", () => {
  it("có RESEND_API_KEY + EMAIL_FROM + APP_BASE_URL: resend", () => {
    const config = resolveEmailConfig({
      NODE_ENV: "production",
      RESEND_API_KEY: "re_test",
      EMAIL_FROM: "QLDA <no-reply@cong-ty.vn>",
      APP_BASE_URL: "https://qlda.example.com",
    });
    expect(config).toMatchObject({
      enabled: true,
      provider: "resend",
      appBaseUrl: "https://qlda.example.com",
    });
  });

  it("production/preview thiếu cấu hình: TẮT (không ném lỗi)", () => {
    expect(resolveEmailConfig({ VERCEL_ENV: "preview" })).toEqual({
      enabled: false,
      reason: "provider_not_configured",
    });
    expect(resolveEmailConfig({ NODE_ENV: "production" })).toEqual({
      enabled: false,
      reason: "provider_not_configured",
    });
  });

  it("resend thiếu EMAIL_FROM hoặc APP_BASE_URL: tắt kèm lý do", () => {
    expect(
      resolveEmailConfig({
        VERCEL_ENV: "production",
        RESEND_API_KEY: "re_test",
        APP_BASE_URL: "https://qlda.example.com",
      }),
    ).toEqual({ enabled: false, reason: "email_from_invalid" });
    expect(
      resolveEmailConfig({
        VERCEL_ENV: "production",
        RESEND_API_KEY: "re_test",
        EMAIL_FROM: "no-reply@cong-ty.vn",
      }),
    ).toEqual({ enabled: false, reason: "app_base_url_missing" });
    expect(
      resolveEmailConfig({
        EMAIL_PROVIDER: "resend",
        APP_BASE_URL: "https://qlda.example.com",
      }),
    ).toEqual({ enabled: false, reason: "resend_api_key_missing" });
  });

  it("cục bộ không cấu hình: mailpit, liên kết localhost:3000", () => {
    expect(resolveEmailConfig({ NODE_ENV: "development" })).toMatchObject({
      enabled: true,
      provider: "mailpit",
      appBaseUrl: "http://localhost:3000",
    });
  });

  it("mailpit chỉ nhận địa chỉ cục bộ", () => {
    expect(
      resolveEmailConfig({
        EMAIL_PROVIDER: "mailpit",
        MAILPIT_URL: "https://mail.example.com",
        APP_BASE_URL: "http://localhost:3000",
      }),
    ).toEqual({ enabled: false, reason: "mailpit_url_not_local" });
  });

  it("EMAIL_PROVIDER=disabled hoặc lạ", () => {
    expect(resolveEmailConfig({ EMAIL_PROVIDER: "disabled" })).toEqual({
      enabled: false,
      reason: "disabled",
    });
    expect(
      resolveEmailConfig({
        EMAIL_PROVIDER: "smtp",
        APP_BASE_URL: "http://localhost:3000",
      }),
    ).toEqual({ enabled: false, reason: "provider_unknown" });
  });
});

describe("bộ gửi Resend (fetch giả)", () => {
  const env = {
    RESEND_API_KEY: "re_secret_key",
    EMAIL_FROM: "QLDA <no-reply@cong-ty.vn>",
    APP_BASE_URL: "https://qlda.example.com",
  };
  const message = {
    to: "an@cong-ty.vn",
    subject: "S",
    text: "T",
    html: "<p>T</p>",
    idempotencyKey: "qlda-email-1",
  };

  it("gọi API Resend với khóa trong header, idempotency key", async () => {
    const fetch = ok(200, { id: "msg_1" });
    const config = resolveEmailConfig(env, { fetch });
    if (!config.enabled) throw new Error("expected enabled");
    await expect(config.sender.send(message)).resolves.toEqual({
      ok: true,
      providerId: "msg_1",
    });
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.headers).toMatchObject({
      authorization: "Bearer re_secret_key",
      "idempotency-key": "qlda-email-1",
    });
    expect(JSON.parse(init.body)).toEqual({
      from: "QLDA <no-reply@cong-ty.vn>",
      to: ["an@cong-ty.vn"],
      subject: "S",
      text: "T",
      html: "<p>T</p>",
    });
  });

  it.each([
    [429, true],
    [500, true],
    [503, true],
    [422, false],
    [401, false],
  ])("HTTP %i → retryable=%s, mã không lộ khóa", async (status, retryable) => {
    const config = resolveEmailConfig(env, { fetch: ok(status) });
    if (!config.enabled) throw new Error("expected enabled");
    const result = await config.sender.send(message);
    expect(result).toEqual({
      ok: false,
      retryable,
      code: `resend_http_${status}`,
    });
  });

  it("lỗi mạng/hết giờ: thử lại, không đưa thông điệp gốc vào mã", async () => {
    const fetch = vi
      .fn()
      .mockRejectedValue(new Error("connect ECONNREFUSED re_secret_key"));
    const config = resolveEmailConfig(env, { fetch });
    if (!config.enabled) throw new Error("expected enabled");
    expect(await config.sender.send(message)).toEqual({
      ok: false,
      retryable: true,
      code: "resend_network_error",
    });
  });
});

describe("bộ gửi Mailpit (fetch giả)", () => {
  it("gọi POST /api/v1/send của Mailpit", async () => {
    const fetch = ok(200, { ID: "x" });
    const config = resolveEmailConfig(
      {
        EMAIL_PROVIDER: "mailpit",
        MAILPIT_URL: "http://127.0.0.1:54324",
        APP_BASE_URL: "http://localhost:3000",
      },
      { fetch },
    );
    if (!config.enabled) throw new Error("expected enabled");
    expect(
      await config.sender.send({
        to: "an@example.com",
        subject: "S",
        text: "T",
        html: "H",
      }),
    ).toEqual({ ok: true });
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("http://127.0.0.1:54324/api/v1/send");
    expect(JSON.parse(init.body)).toEqual({
      From: { Email: "no-reply@qlda.local", Name: "Quản lý dự án" },
      To: [{ Email: "an@example.com" }],
      Subject: "S",
      Text: "T",
      HTML: "H",
    });
  });
});
