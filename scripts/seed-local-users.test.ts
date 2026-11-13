import { describe, expect, it } from "vitest";
import {
  MIN_PASSWORD_LENGTH,
  PERSONAS,
  assertLocalUrl,
  buildUserPayload,
  parseStatus,
  readSeedPassword,
} from "./seed-local-users";

describe("PERSONAS", () => {
  it("có đúng 4 persona, email giả không trùng", () => {
    expect(PERSONAS.map((p) => p.key)).toEqual([
      "admin",
      "pm",
      "member",
      "viewer",
    ]);
    const emails = PERSONAS.map((p) => p.email);
    expect(new Set(emails).size).toBe(emails.length);
    // Chỉ tên miền dành riêng cho ví dụ, không dữ liệu thật (repo công khai).
    for (const email of emails) expect(email).toMatch(/@example\.com$/);
  });
});

describe("readSeedPassword", () => {
  it("dừng và hướng dẫn cách đặt khi thiếu SEED_PASSWORD", () => {
    expect(() => readSeedPassword({})).toThrow(
      /Thiếu biến môi trường SEED_PASSWORD[\s\S]*export/,
    );
    expect(() => readSeedPassword({ SEED_PASSWORD: "" })).toThrow(
      /SEED_PASSWORD/,
    );
  });

  it("từ chối mật khẩu quá ngắn", () => {
    expect(() =>
      readSeedPassword({ SEED_PASSWORD: "x".repeat(MIN_PASSWORD_LENGTH - 1) }),
    ).toThrow(/ít nhất/);
  });

  it("trả về đúng giá trị đã đặt", () => {
    const pw = "x".repeat(MIN_PASSWORD_LENGTH);
    expect(readSeedPassword({ SEED_PASSWORD: pw })).toBe(pw);
  });
});

describe("assertLocalUrl", () => {
  it("chấp nhận stack cục bộ", () => {
    expect(assertLocalUrl("http://127.0.0.1:54321").port).toBe("54321");
    expect(assertLocalUrl("http://localhost:54321").hostname).toBe("localhost");
  });

  it("từ chối URL không phải cục bộ", () => {
    expect(() => assertLocalUrl("https://abcd.supabase.co")).toThrow(/Từ chối/);
    expect(() => assertLocalUrl("http://127.0.0.1.evil.example:54321")).toThrow(
      /Từ chối/,
    );
    expect(() => assertLocalUrl("không phải url")).toThrow(/không hợp lệ/);
  });
});

describe("parseStatus", () => {
  it("ưu tiên SECRET_KEY, dự phòng SERVICE_ROLE_KEY", () => {
    expect(
      parseStatus(
        JSON.stringify({
          API_URL: "http://127.0.0.1:54321",
          SECRET_KEY: "s",
          SERVICE_ROLE_KEY: "r",
        }),
      ),
    ).toEqual({ apiUrl: "http://127.0.0.1:54321", serviceKey: "s" });
    expect(
      parseStatus(
        JSON.stringify({
          API_URL: "http://127.0.0.1:54321",
          SERVICE_ROLE_KEY: "r",
        }),
      ),
    ).toEqual({ apiUrl: "http://127.0.0.1:54321", serviceKey: "r" });
  });

  it("báo lỗi khi stack chưa chạy hoặc không phải cục bộ", () => {
    expect(() => parseStatus("")).toThrow(/db-start/);
    expect(() => parseStatus("{}")).toThrow(/thiếu API_URL/);
    expect(() =>
      parseStatus(
        JSON.stringify({ API_URL: "https://x.supabase.co", SECRET_KEY: "s" }),
      ),
    ).toThrow(/Từ chối/);
  });
});

describe("buildUserPayload", () => {
  it("xác nhận email sẵn, gắn nhãn persona vào app_metadata", () => {
    const payload = buildUserPayload(PERSONAS[1], "mat-khau-thu");
    expect(payload).toEqual({
      email: "pm@example.com",
      password: "mat-khau-thu",
      email_confirm: true,
      user_metadata: { full_name: "Quản lý Dự án Thử" },
      app_metadata: { seed_persona: "pm" },
    });
  });
});
