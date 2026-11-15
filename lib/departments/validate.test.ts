import { describe, expect, it } from "vitest";
import {
  DEPARTMENT_NAME_MAX_LENGTH,
  POSITION_MAX,
  validateDepartmentCreate,
  validateDepartmentListQuery,
  validateDepartmentPatch,
} from "./validate";

describe("validateDepartmentListQuery", () => {
  it("mặc định không kèm phòng ban đã lưu trữ", () => {
    expect(validateDepartmentListQuery(new URLSearchParams())).toEqual({
      ok: true,
      data: { include_archived: false },
    });
    expect(
      validateDepartmentListQuery(new URLSearchParams("include_archived=true")),
    ).toEqual({ ok: true, data: { include_archived: true } });
    expect(
      validateDepartmentListQuery(
        new URLSearchParams("include_archived=false"),
      ),
    ).toEqual({ ok: true, data: { include_archived: false } });
  });

  it("từ chối tham số lạ, giá trị lạ, tham số lặp", () => {
    expect(
      validateDepartmentListQuery(
        new URLSearchParams("q=a&include_archived=1"),
      ),
    ).toEqual({
      ok: false,
      details: [
        { field: "q", issue: "unknown_field" },
        { field: "include_archived", issue: "invalid_value" },
      ],
    });
    expect(
      validateDepartmentListQuery(
        new URLSearchParams("include_archived=true&include_archived=true"),
      ).ok,
    ).toBe(false);
  });
});

describe("validateDepartmentCreate", () => {
  it("chuẩn hóa tên: cắt hai đầu, gộp khoảng trắng", () => {
    expect(
      validateDepartmentCreate({ name: "  Phòng \t Kế   toán \n" }),
    ).toEqual({ ok: true, data: { name: "Phòng Kế toán" } });
    expect(validateDepartmentCreate({ name: "Phòng A", position: 3 })).toEqual({
      ok: true,
      data: { name: "Phòng A", position: 3 },
    });
  });

  it("tên bắt buộc, đúng kiểu, không quá dài, không có ký tự điều khiển", () => {
    const cases: [unknown, string][] = [
      [{}, "required"],
      [{ name: null }, "required"],
      [{ name: "   " }, "required"],
      [{ name: 5 }, "invalid_value"],
      [{ name: "a".repeat(DEPARTMENT_NAME_MAX_LENGTH + 1) }, "too_long"],
      [{ name: "Phòng\u0000A" }, "invalid_format"],
    ];
    for (const [body, issue] of cases) {
      expect(validateDepartmentCreate(body), JSON.stringify(body)).toEqual({
        ok: false,
        details: [{ field: "name", issue }],
      });
    }
    expect(
      validateDepartmentCreate({ name: "a".repeat(DEPARTMENT_NAME_MAX_LENGTH) })
        .ok,
    ).toBe(true);
  });

  it("position là số nguyên 0..POSITION_MAX", () => {
    for (const position of [-1, 1.5, "1", POSITION_MAX + 1, null]) {
      expect(
        validateDepartmentCreate({ name: "A", position }),
        String(position),
      ).toEqual({
        ok: false,
        details: [{ field: "position", issue: "invalid_value" }],
      });
    }
  });

  it("từ chối trường lạ và thân không phải object", () => {
    expect(validateDepartmentCreate({ name: "A", archived: true })).toEqual({
      ok: false,
      details: [{ field: "archived", issue: "unknown_field" }],
    });
    for (const body of [null, [], "A", 1]) {
      expect(validateDepartmentCreate(body)).toEqual({
        ok: false,
        details: [{ field: "body", issue: "invalid_format" }],
      });
    }
  });
});

describe("validateDepartmentPatch", () => {
  it("nhận đổi tên, thứ tự, lưu trữ/dùng lại", () => {
    expect(validateDepartmentPatch({ name: " Phòng  B " })).toEqual({
      ok: true,
      data: { name: "Phòng B" },
    });
    expect(validateDepartmentPatch({ archived: true, position: 0 })).toEqual({
      ok: true,
      data: { archived: true, position: 0 },
    });
    expect(validateDepartmentPatch({ archived: false })).toEqual({
      ok: true,
      data: { archived: false },
    });
  });

  it("thân rỗng, trường lạ, kiểu sai bị từ chối", () => {
    expect(validateDepartmentPatch({})).toEqual({
      ok: false,
      details: [{ field: "body", issue: "required" }],
    });
    expect(validateDepartmentPatch({ id: "x", name: "A" })).toEqual({
      ok: false,
      details: [{ field: "id", issue: "unknown_field" }],
    });
    expect(validateDepartmentPatch({ archived: "true" })).toEqual({
      ok: false,
      details: [{ field: "archived", issue: "invalid_value" }],
    });
    expect(validateDepartmentPatch({ name: "" })).toEqual({
      ok: false,
      details: [{ field: "name", issue: "required" }],
    });
    expect(validateDepartmentPatch({ name: null })).toEqual({
      ok: false,
      details: [{ field: "name", issue: "required" }],
    });
  });
});
