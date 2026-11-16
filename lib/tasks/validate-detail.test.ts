import { describe, expect, it } from "vitest";
import { validateTaskListQuery, validateTaskPatch } from "./validate";

/** Phần mở rộng validate cho ngăn chi tiết task (Story E2-5). */
describe("validateTaskPatch: expected_updated_at", () => {
  it("nhận mốc thời gian ISO kèm thay đổi", () => {
    expect(
      validateTaskPatch({
        title: "x",
        expected_updated_at: "2026-11-15T10:00:00.123456+00:00",
      }),
    ).toEqual({
      ok: true,
      data: {
        title: "x",
        expected_updated_at: "2026-11-15T10:00:00.123456+00:00",
      },
    });
  });
  it("sai định dạng: invalid_format", () => {
    for (const value of ["hôm qua", 123, null]) {
      const result = validateTaskPatch({
        title: "x",
        expected_updated_at: value,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.details).toContainEqual({
          field: "expected_updated_at",
          issue: "invalid_format",
        });
      }
    }
  });
  it("gửi một mình (không đổi gì): thiếu nội dung", () => {
    const result = validateTaskPatch({
      expected_updated_at: "2026-11-15T10:00:00Z",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.details).toEqual([{ field: "body", issue: "required" }]);
    }
  });
});

describe("validateTaskListQuery: parent_id", () => {
  it("uuid hợp lệ, viết thường", () => {
    const result = validateTaskListQuery(
      new URLSearchParams({
        parent_id: "AAAAAAAA-0000-4000-8000-000000000001",
      }),
    );
    expect(result.ok && result.data.parent_id).toBe(
      "aaaaaaaa-0000-4000-8000-000000000001",
    );
  });
  it("không phải uuid: 400", () => {
    const result = validateTaskListQuery(
      new URLSearchParams({ parent_id: "x" }),
    );
    expect(result.ok).toBe(false);
  });
});
