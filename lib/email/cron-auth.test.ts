import { describe, expect, it } from "vitest";
import { verifyCronSecret } from "./cron-auth";

const SECRET = "s".repeat(16) + "e".repeat(16) + "cret";

describe("verifyCronSecret", () => {
  it("đúng bí mật: cho qua", () => {
    expect(verifyCronSecret(`Bearer ${SECRET}`, SECRET)).toEqual({ ok: true });
  });

  it.each([
    null,
    "",
    SECRET,
    `Basic ${SECRET}`,
    `Bearer ${SECRET}x`,
    `Bearer ${SECRET.slice(0, -1)}`,
    "Bearer ",
    `bearer ${SECRET}`,
  ])("sai header %j: unauthorized", (header) => {
    expect(verifyCronSecret(header, SECRET)).toEqual({
      ok: false,
      reason: "unauthorized",
    });
  });

  it("chưa cấu hình hoặc bí mật quá ngắn: từ chối mọi lời gọi", () => {
    expect(verifyCronSecret("Bearer ", undefined)).toEqual({
      ok: false,
      reason: "not_configured",
    });
    expect(verifyCronSecret("Bearer ", "")).toEqual({
      ok: false,
      reason: "not_configured",
    });
    expect(verifyCronSecret("Bearer short", "short")).toEqual({
      ok: false,
      reason: "not_configured",
    });
  });
});
