import { describe, expect, it } from "vitest";
import {
  DESCRIPTION_MAX_LENGTH,
  LIST_LIMIT_DEFAULT,
  NAME_MAX_LENGTH,
  Q_MAX_LENGTH,
  decodeProjectCursor,
  encodeProjectCursor,
  namePattern,
  validateProjectCreate,
  validateProjectListQuery,
  validateProjectPatch,
} from "./validate";

describe("validateProjectCreate", () => {
  it("nhận đủ trường, cắt khoảng trắng tên, mô tả rỗng thành null", () => {
    expect(
      validateProjectCreate({
        name: "  Cổng nội bộ ",
        description: "   ",
        start_date: "2026-11-16",
        end_date: "2027-04-30",
      }),
    ).toEqual({
      ok: true,
      data: {
        name: "Cổng nội bộ",
        description: null,
        start_date: "2026-11-16",
        end_date: "2027-04-30",
      },
    });
  });

  it("chỉ có tên: các trường khác là null", () => {
    expect(validateProjectCreate({ name: "A" })).toEqual({
      ok: true,
      data: { name: "A", description: null, start_date: null, end_date: null },
    });
  });

  it.each([
    [{}, [{ field: "name", issue: "required" }]],
    [{ name: "  " }, [{ field: "name", issue: "required" }]],
    [{ name: 5 }, [{ field: "name", issue: "invalid_value" }]],
    [
      { name: "x".repeat(NAME_MAX_LENGTH + 1) },
      [{ field: "name", issue: "too_long" }],
    ],
    [{ name: "a\u0007b" }, [{ field: "name", issue: "invalid_format" }]],
    [
      { name: "A", description: "x".repeat(DESCRIPTION_MAX_LENGTH + 1) },
      [{ field: "description", issue: "too_long" }],
    ],
    [
      { name: "A", description: "a\u0000" },
      [{ field: "description", issue: "invalid_format" }],
    ],
    [
      { name: "A", start_date: "2026-02-30" },
      [{ field: "start_date", issue: "invalid_format" }],
    ],
    [
      { name: "A", end_date: "30/04/2027" },
      [{ field: "end_date", issue: "invalid_format" }],
    ],
    [
      { name: "A", template_id: "x", status: "archived" },
      [
        { field: "template_id", issue: "unknown_field" },
        { field: "status", issue: "unknown_field" },
      ],
    ],
  ])("từ chối %j", (body, details) => {
    expect(validateProjectCreate(body)).toEqual({ ok: false, details });
  });

  it("thân không phải object", () => {
    for (const body of [null, [], "x", 1]) {
      expect(validateProjectCreate(body)).toEqual({
        ok: false,
        details: [{ field: "body", issue: "invalid_format" }],
      });
    }
  });

  it("mô tả cho phép xuống dòng và tab", () => {
    const r = validateProjectCreate({ name: "A", description: "a\n\tb" });
    expect(r.ok && r.data.description).toBe("a\n\tb");
  });
});

describe("validateProjectPatch", () => {
  it("chỉ trường có mặt; null xóa mô tả và ngày", () => {
    expect(
      validateProjectPatch({ description: null, start_date: null }),
    ).toEqual({ ok: true, data: { description: null, start_date: null } });
  });

  it("lưu trữ và khôi phục bằng status", () => {
    expect(validateProjectPatch({ status: "archived" })).toEqual({
      ok: true,
      data: { status: "archived" },
    });
    expect(validateProjectPatch({ status: "active" })).toEqual({
      ok: true,
      data: { status: "active" },
    });
  });

  it.each([
    [{}, [{ field: "body", issue: "required" }]],
    [{ status: "deleted" }, [{ field: "status", issue: "invalid_value" }]],
    [{ status: null }, [{ field: "status", issue: "invalid_value" }]],
    [{ name: null }, [{ field: "name", issue: "required" }]],
    [{ created_by: "x" }, [{ field: "created_by", issue: "unknown_field" }]],
  ])("từ chối %j", (body, details) => {
    expect(validateProjectPatch(body)).toEqual({ ok: false, details });
  });
});

describe("validateProjectListQuery", () => {
  const parse = (qs: string) =>
    validateProjectListQuery(new URLSearchParams(qs));

  it("mặc định: đang hoạt động, không lọc, limit mặc định", () => {
    expect(parse("")).toEqual({
      ok: true,
      data: {
        status: "active",
        q: null,
        limit: LIST_LIMIT_DEFAULT,
        cursor: null,
      },
    });
  });

  it("nhận status, q (cắt khoảng trắng), limit, cursor", () => {
    const cursor = encodeProjectCursor({
      created_at: "2026-11-15T01:02:03.456789+00:00",
      id: "0E910000-0000-4000-8000-000000000001",
    });
    expect(
      parse(`status=archived&q=%20kho%20&limit=100&cursor=${cursor}`),
    ).toEqual({
      ok: true,
      data: {
        status: "archived",
        q: "kho",
        limit: 100,
        cursor: {
          created_at: "2026-11-15T01:02:03.456789+00:00",
          id: "0e910000-0000-4000-8000-000000000001",
        },
      },
    });
  });

  it("q chỉ khoảng trắng: không lọc", () => {
    expect(parse("q=%20%20")).toMatchObject({ ok: true, data: { q: null } });
  });

  it.each([
    ["status=all", "status", "invalid_value"],
    ["limit=0", "limit", "invalid_value"],
    ["limit=101", "limit", "invalid_value"],
    ["limit=1.5", "limit", "invalid_value"],
    ["cursor=abc", "cursor", "invalid_format"],
    [`q=${"a".repeat(Q_MAX_LENGTH + 1)}`, "q", "too_long"],
    ["q=a%07", "q", "invalid_format"],
    ["sort=name", "sort", "unknown_field"],
    ["status=active&status=archived", "status", "invalid_value"],
  ])("từ chối %s", (qs, field, issue) => {
    const r = parse(qs);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.details).toContainEqual({ field, issue });
  });
});

describe("con trỏ", () => {
  it("mã hóa rồi giải mã lại đúng", () => {
    const c = {
      created_at: "2026-11-15T01:02:03Z",
      id: "0e910000-0000-4000-8000-000000000001",
    };
    expect(decodeProjectCursor(encodeProjectCursor(c))).toEqual(c);
  });

  it("từ chối con trỏ có dấu thời gian chứa ký tự lạ (chặn chèn bộ lọc PostgREST)", () => {
    const bad = Buffer.from(
      JSON.stringify([
        '2026-11-15T01:02:03Z",id.gt.0',
        "0e910000-0000-4000-8000-000000000001",
      ]),
    ).toString("base64url");
    expect(decodeProjectCursor(bad)).toBeNull();
  });
});

describe("namePattern", () => {
  it("bao bằng ký tự đại diện, thoát %, _ và gạch ngược, bỏ *", () => {
    expect(namePattern("kho")).toBe("*kho*");
    expect(namePattern("50%_a\\b*c")).toBe("*50\\%\\_a\\\\bc*");
  });
});
