import { describe, expect, it } from "vitest";
import { strings } from "@/lib/strings";
import { decideReaderGate, mapWriteError, rejectionError } from "./policy";

const user = { id: "u1" };

describe("decideReaderGate", () => {
  it("chưa đăng nhập: 401", () => {
    expect(decideReaderGate(null, null, false)).toMatchObject({
      ok: false,
      error: { code: "unauthenticated" },
    });
  });
  it("Admin hoặc PM đang hoạt động: được đọc", () => {
    expect(
      decideReaderGate(user, { is_admin: true, is_active: true }, false).ok,
    ).toBe(true);
    expect(
      decideReaderGate(user, { is_admin: false, is_active: true }, true).ok,
    ).toBe(true);
  });
  it("không phải Admin/PM, bị khóa, hồ sơ ẩn: 403", () => {
    for (const [profile, pm] of [
      [{ is_admin: false, is_active: true }, false],
      [{ is_admin: true, is_active: false }, true],
      [null, true],
    ] as const) {
      expect(decideReaderGate(user, profile, pm)).toMatchObject({
        ok: false,
        error: { code: "forbidden" },
      });
    }
  });
});

describe("rejectionError, mapWriteError", () => {
  it("lý do từ chối tệp: 422 với thông điệp riêng", () => {
    expect(rejectionError("macro")).toMatchObject({
      code: "business_rule_violated",
      message: strings.reportTemplates.errors.macro,
    });
    expect(rejectionError("zip_bomb").message).toBe(
      strings.reportTemplates.errors.zipBomb,
    );
  });
  it("ánh xạ mã Postgres", () => {
    expect(mapWriteError({ code: "23505" })?.code).toBe("conflict");
    expect(mapWriteError({ code: "42501" })?.code).toBe("forbidden");
    expect(mapWriteError({ code: "23514" })?.code).toBe("validation_failed");
    expect(mapWriteError({ code: "XX000" })).toBeNull();
  });
});
