import { describe, expect, it } from "vitest";
import { validateMePatch } from "./validate";

describe("validateMePatch (PATCH /api/v1/me)", () => {
  it("nhận locale vi hoặc en", () => {
    expect(validateMePatch({ locale: "en" })).toEqual({
      ok: true,
      data: { locale: "en" },
    });
    expect(validateMePatch({ locale: "vi" })).toEqual({
      ok: true,
      data: { locale: "vi" },
    });
  });

  it("thân rỗng, sai giá trị, trường lạ, không phải object: 400", () => {
    expect(validateMePatch({})).toEqual({
      ok: false,
      details: [{ field: "body", issue: "required" }],
    });
    expect(validateMePatch({ locale: "fr" })).toEqual({
      ok: false,
      details: [{ field: "locale", issue: "invalid_value" }],
    });
    expect(validateMePatch({ locale: null })).toEqual({
      ok: false,
      details: [{ field: "locale", issue: "required" }],
    });
    expect(validateMePatch({ locale: "en", is_admin: true })).toEqual({
      ok: false,
      details: [{ field: "is_admin", issue: "unknown_field" }],
    });
    expect(validateMePatch(["en"])).toEqual({
      ok: false,
      details: [{ field: "body", issue: "invalid_format" }],
    });
  });

  it("E1-7: không nhận email, is_admin, is_active, department_id", () => {
    const res = validateMePatch({
      full_name: "A",
      email: "x@example.com",
      is_active: true,
      department_id: null,
    });
    expect(res).toEqual({
      ok: false,
      details: [
        { field: "email", issue: "unknown_field" },
        { field: "is_active", issue: "unknown_field" },
        { field: "department_id", issue: "unknown_field" },
      ],
    });
  });

  it("full_name: bỏ khoảng trắng, 1..100 ký tự (đếm theo ký tự, NFC)", () => {
    expect(validateMePatch({ full_name: "  Nguyễn Văn A  " })).toEqual({
      ok: true,
      data: { full_name: "Nguyễn Văn A" },
    });
    // "ễ" tổ hợp (NFD) được chuẩn hóa về NFC.
    expect(validateMePatch({ full_name: "Nguyễn" })).toEqual({
      ok: true,
      data: { full_name: "Nguyễn" },
    });
    expect(validateMePatch({ full_name: "ễ".repeat(100) }).ok).toBe(true);
    expect(validateMePatch({ full_name: "a".repeat(101) })).toEqual({
      ok: false,
      details: [{ field: "full_name", issue: "too_long" }],
    });
    expect(validateMePatch({ full_name: "   " })).toEqual({
      ok: false,
      details: [{ field: "full_name", issue: "required" }],
    });
    expect(validateMePatch({ full_name: 5 })).toEqual({
      ok: false,
      details: [{ field: "full_name", issue: "invalid_format" }],
    });
    expect(validateMePatch({ full_name: "A\u0000B" })).toEqual({
      ok: false,
      details: [{ field: "full_name", issue: "invalid_format" }],
    });
    expect(validateMePatch({ full_name: "A‮B" }).ok).toBe(false);
  });

  it("phone: đúng định dạng CSDL, null hoặc rỗng để xóa", () => {
    expect(validateMePatch({ phone: " +84 900 000 000 " })).toEqual({
      ok: true,
      data: { phone: "+84 900 000 000" },
    });
    expect(validateMePatch({ phone: "028 (3822) 12.34" }).ok).toBe(true);
    expect(validateMePatch({ phone: "(028) 3822-1234" }).ok).toBe(false);
    expect(validateMePatch({ phone: null })).toEqual({
      ok: true,
      data: { phone: null },
    });
    expect(validateMePatch({ phone: "" })).toEqual({
      ok: true,
      data: { phone: null },
    });
    for (const bad of [
      "abc",
      "12345",
      "+",
      "0900-000-000-000-0000",
      "09a0000000",
      900,
    ]) {
      expect(validateMePatch({ phone: bad })).toEqual({
        ok: false,
        details: [{ field: "phone", issue: "invalid_format" }],
      });
    }
  });

  it("nhiều trường cùng lúc, báo mọi lỗi", () => {
    expect(
      validateMePatch({ full_name: "B", phone: "0900000000", locale: "en" }),
    ).toEqual({
      ok: true,
      data: { full_name: "B", phone: "0900000000", locale: "en" },
    });
    expect(validateMePatch({ full_name: "", phone: "x" })).toEqual({
      ok: false,
      details: [
        { field: "full_name", issue: "required" },
        { field: "phone", issue: "invalid_format" },
      ],
    });
  });
});
