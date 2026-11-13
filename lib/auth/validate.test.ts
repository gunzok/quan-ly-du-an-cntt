import { describe, expect, it } from "vitest";
import {
  EMAIL_MAX_LENGTH,
  PASSWORD_MAX_LENGTH,
  readLoginForm,
  validateLoginInput,
} from "./validate";

describe("validateLoginInput", () => {
  it("chấp nhận đầu vào hợp lệ, chuẩn hóa email", () => {
    expect(
      validateLoginInput({ email: "  PM@Example.com ", password: " p@ss " }),
    ).toEqual({
      ok: true,
      data: { email: "pm@example.com", password: " p@ss " },
    });
  });

  it("báo thiếu cả hai trường", () => {
    expect(validateLoginInput({ email: "", password: "" })).toEqual({
      ok: false,
      details: [
        { field: "email", issue: "required" },
        { field: "password", issue: "required" },
      ],
    });
  });

  it("coi giá trị không phải chuỗi (null, File, số) là thiếu", () => {
    const result = validateLoginInput({ email: null, password: 123 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.details.map((d) => d.issue)).toEqual([
        "required",
        "required",
      ]);
    }
  });

  it.each(["abc", "a@b", "a b@c.d", "@example.com", "a@@b.c"])(
    "từ chối email sai định dạng: %s",
    (email) => {
      expect(validateLoginInput({ email, password: "x" })).toEqual({
        ok: false,
        details: [{ field: "email", issue: "invalid_format" }],
      });
    },
  );

  it("từ chối email và mật khẩu quá dài", () => {
    const email = `${"a".repeat(EMAIL_MAX_LENGTH)}@x.vn`;
    const password = "p".repeat(PASSWORD_MAX_LENGTH + 1);
    expect(validateLoginInput({ email, password })).toEqual({
      ok: false,
      details: [
        { field: "email", issue: "too_long" },
        { field: "password", issue: "too_long" },
      ],
    });
  });

  it("chỉ đọc email và password từ FormData, bỏ qua trường lạ", () => {
    const form = new FormData();
    form.set("email", "a@b.vn");
    form.set("password", "x");
    form.set("role", "admin");
    expect(readLoginForm(form)).toEqual({ email: "a@b.vn", password: "x" });
  });
});
