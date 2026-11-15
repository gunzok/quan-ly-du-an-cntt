import { describe, expect, it } from "vitest";
import {
  validateMemberListQuery,
  validateMemberPut,
  validateMemberUserId,
  validateUserSearchQuery,
} from "./validate";

const UUID = "6C1E0000-0000-4000-8000-000000000001";

describe("validateMemberPut", () => {
  it("nhận đúng ba vai trò", () => {
    for (const role of ["pm", "member", "viewer"]) {
      expect(validateMemberPut({ role })).toEqual({ ok: true, data: { role } });
    }
  });
  it("thiếu, sai vai trò, trường lạ, không phải object: 400", () => {
    expect(validateMemberPut({})).toEqual({
      ok: false,
      details: [{ field: "role", issue: "required" }],
    });
    expect(validateMemberPut({ role: "admin" })).toEqual({
      ok: false,
      details: [{ field: "role", issue: "invalid_value" }],
    });
    expect(validateMemberPut({ role: "PM" }).ok).toBe(false);
    expect(validateMemberPut({ role: "pm", user_id: UUID })).toEqual({
      ok: false,
      details: [{ field: "user_id", issue: "unknown_field" }],
    });
    expect(validateMemberPut(["pm"]).ok).toBe(false);
    expect(validateMemberPut(null).ok).toBe(false);
  });
});

describe("validateMemberUserId", () => {
  it("uuid về chữ thường; sai định dạng: invalid_format", () => {
    expect(validateMemberUserId(UUID)).toEqual({
      ok: true,
      data: UUID.toLowerCase(),
    });
    expect(validateMemberUserId("abc")).toEqual({
      ok: false,
      details: [{ field: "user_id", issue: "invalid_format" }],
    });
  });
});

describe("validateUserSearchQuery", () => {
  const parse = (qs: string) =>
    validateUserSearchQuery(new URLSearchParams(qs));
  it("q cắt khoảng trắng; mặc định limit 20", () => {
    expect(parse("q=%20%20Nguy%E1%BB%85n%20%20V%C4%83n%20")).toEqual({
      ok: true,
      data: { q: "Nguyễn Văn", exclude_project_id: null, limit: 20 },
    });
    expect(parse(`q=ab&exclude_project_id=${UUID}&limit=5`)).toEqual({
      ok: true,
      data: { q: "ab", exclude_project_id: UUID.toLowerCase(), limit: 5 },
    });
  });
  it("thiếu q, q quá ngắn, quá dài, ký tự điều khiển: 400", () => {
    expect(parse("")).toMatchObject({
      ok: false,
      details: [{ field: "q", issue: "required" }],
    });
    expect(parse("q=a")).toMatchObject({
      details: [{ field: "q", issue: "required" }],
    });
    expect(parse(`q=${"a".repeat(101)}`)).toMatchObject({
      details: [{ field: "q", issue: "too_long" }],
    });
    expect(parse("q=ab%00")).toMatchObject({
      details: [{ field: "q", issue: "invalid_format" }],
    });
  });
  it("limit ngoài 1..20, exclude_project_id sai, tham số lạ hoặc lặp: 400", () => {
    for (const qs of [
      "q=ab&limit=0",
      "q=ab&limit=21",
      "q=ab&limit=1.5",
      "q=ab&exclude_project_id=x",
      "q=ab&role=pm",
      "q=ab&q=cd",
    ]) {
      expect(parse(qs).ok).toBe(false);
    }
  });
});

describe("validateMemberListQuery", () => {
  it("không nhận tham số nào", () => {
    expect(validateMemberListQuery(new URLSearchParams("")).ok).toBe(true);
    expect(validateMemberListQuery(new URLSearchParams("limit=5"))).toEqual({
      ok: false,
      details: [{ field: "limit", issue: "unknown_field" }],
    });
  });
});
