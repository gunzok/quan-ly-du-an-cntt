import { describe, expect, it } from "vitest";
import {
  LIST_LIMIT_DEFAULT,
  decodeCursor,
  encodeCursor,
  validateInvitation,
  validateListQuery,
  validateUserPatch,
} from "./validate";

const ID = "6c1e0f6a-3d2b-4c8e-9f10-1a2b3c4d5e6f";

describe("validateListQuery", () => {
  it("mặc định: không q, limit 50, không con trỏ", () => {
    expect(validateListQuery(new URLSearchParams())).toEqual({
      ok: true,
      data: { q: null, limit: LIST_LIMIT_DEFAULT, cursor: null },
    });
  });

  it("cắt khoảng trắng q; q rỗng coi như không tìm", () => {
    const r = validateListQuery(new URLSearchParams("q=%20an%20&limit=10"));
    expect(r).toEqual({ ok: true, data: { q: "an", limit: 10, cursor: null } });
    expect(validateListQuery(new URLSearchParams("q=%20"))).toMatchObject({
      ok: true,
      data: { q: null },
    });
  });

  it("từ chối tham số lạ, tham số lặp, limit ngoài 1..100, q quá dài", () => {
    const r = validateListQuery(
      new URLSearchParams(
        `department_id=x&limit=0&q=${"a".repeat(101)}&cursor=a&cursor=b`,
      ),
    );
    expect(r.ok).toBe(false);
    expect(!r.ok && r.details).toEqual(
      expect.arrayContaining([
        { field: "department_id", issue: "unknown_field" },
        { field: "cursor", issue: "invalid_value" },
        { field: "q", issue: "too_long" },
        { field: "limit", issue: "invalid_value" },
      ]),
    );
    for (const limit of ["101", "-1", "1.5", "abc", "1e2"]) {
      expect(validateListQuery(new URLSearchParams({ limit })).ok, limit).toBe(
        false,
      );
    }
  });

  it("con trỏ hợp lệ được giải mã; con trỏ hỏng bị từ chối", () => {
    const cursor = encodeCursor({ key: "nguyễn an", id: ID });
    expect(validateListQuery(new URLSearchParams({ cursor }))).toMatchObject({
      ok: true,
      data: { cursor: { key: "nguyễn an", id: ID } },
    });
    for (const bad of [
      "!!!",
      Buffer.from("{}").toString("base64url"),
      Buffer.from('["a","khong-phai-uuid"]').toString("base64url"),
      Buffer.from("[1,2]").toString("base64url"),
    ]) {
      expect(validateListQuery(new URLSearchParams({ cursor: bad })).ok).toBe(
        false,
      );
    }
  });
});

describe("encodeCursor/decodeCursor", () => {
  it("đi một vòng giữ nguyên dữ liệu", () => {
    const c = { key: "trần quốc bảo", id: ID };
    expect(decodeCursor(encodeCursor(c))).toEqual(c);
  });
});

describe("validateInvitation", () => {
  it("chuẩn hóa email, họ tên; phòng ban tùy chọn", () => {
    expect(
      validateInvitation({ email: "  An@Example.COM ", full_name: " Lê  An " }),
    ).toEqual({
      ok: true,
      data: {
        email: "an@example.com",
        full_name: "Lê An",
        department_id: null,
      },
    });
    expect(
      validateInvitation({ email: "a@b.vn", department_id: ID.toUpperCase() }),
    ).toMatchObject({ ok: true, data: { department_id: ID } });
  });

  it("thiếu email, sai định dạng, quá dài", () => {
    expect(validateInvitation({})).toEqual({
      ok: false,
      details: [{ field: "email", issue: "required" }],
    });
    expect(validateInvitation({ email: "khong-hop-le" })).toMatchObject({
      ok: false,
      details: [{ field: "email", issue: "invalid_format" }],
    });
    expect(
      validateInvitation({ email: `${"a".repeat(250)}@b.vn` }),
    ).toMatchObject({
      ok: false,
      details: [{ field: "email", issue: "too_long" }],
    });
    expect(validateInvitation({ email: 123 })).toMatchObject({
      ok: false,
      details: [{ field: "email", issue: "invalid_value" }],
    });
  });

  it("từ chối trường lạ (ví dụ cố gán is_admin khi mời)", () => {
    expect(validateInvitation({ email: "a@b.vn", is_admin: true })).toEqual({
      ok: false,
      details: [{ field: "is_admin", issue: "unknown_field" }],
    });
  });

  it("từ chối thân không phải object, họ tên sai kiểu hoặc có ký tự điều khiển", () => {
    for (const body of [null, [], "a@b.vn", 1]) {
      expect(validateInvitation(body)).toEqual({
        ok: false,
        details: [{ field: "body", issue: "invalid_format" }],
      });
    }
    expect(validateInvitation({ email: "a@b.vn", full_name: 1 })).toMatchObject(
      { ok: false, details: [{ field: "full_name" }] },
    );
    expect(
      validateInvitation({ email: "a@b.vn", full_name: "a\u0000b" }),
    ).toMatchObject({
      ok: false,
      details: [{ field: "full_name", issue: "invalid_format" }],
    });
    expect(
      validateInvitation({ email: "a@b.vn", full_name: "x".repeat(201) }),
    ).toMatchObject({
      ok: false,
      details: [{ field: "full_name", issue: "too_long" }],
    });
    expect(
      validateInvitation({ email: "a@b.vn", department_id: "1" }),
    ).toMatchObject({
      ok: false,
      details: [{ field: "department_id", issue: "invalid_format" }],
    });
  });
});

describe("validateUserPatch", () => {
  it("nhận is_active, is_admin, department_id (kể cả null)", () => {
    expect(validateUserPatch({ is_active: false })).toEqual({
      ok: true,
      data: { is_active: false },
    });
    expect(validateUserPatch({ is_admin: true, department_id: null })).toEqual({
      ok: true,
      data: { is_admin: true, department_id: null },
    });
    expect(validateUserPatch({ department_id: ID })).toEqual({
      ok: true,
      data: { department_id: ID },
    });
  });

  it("thân rỗng là lỗi required", () => {
    expect(validateUserPatch({})).toEqual({
      ok: false,
      details: [{ field: "body", issue: "required" }],
    });
  });

  it("từ chối trường lạ: email, full_name, id, role", () => {
    const r = validateUserPatch({
      is_active: true,
      email: "x@y.vn",
      role: "admin",
    });
    expect(r).toEqual({
      ok: false,
      details: [
        { field: "email", issue: "unknown_field" },
        { field: "role", issue: "unknown_field" },
      ],
    });
  });

  it('từ chối giá trị không phải boolean ("false", 0)', () => {
    expect(validateUserPatch({ is_active: "false" })).toEqual({
      ok: false,
      details: [{ field: "is_active", issue: "invalid_value" }],
    });
    expect(validateUserPatch({ is_admin: 0 })).toMatchObject({ ok: false });
    expect(validateUserPatch({ department_id: "" })).toMatchObject({
      ok: false,
    });
  });

  it("từ chối thân có prototype lạ", () => {
    expect(validateUserPatch(Object.create({ is_active: true }))).toMatchObject(
      {
        ok: false,
      },
    );
  });
});
