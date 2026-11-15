import { describe, expect, it } from "vitest";
import { LAG_DAYS_MAX_ABS, validateRelationCreate } from "./validate";

const UUID = "6C1E8F9A-1B2C-4D3E-8F00-112233445566";

function issues(body: unknown) {
  const r = validateRelationCreate(body);
  expect(r.ok).toBe(false);
  return r.ok ? [] : r.details;
}

describe("validateRelationCreate", () => {
  it("nhận đủ 4 kiểu, chuẩn hóa uuid về chữ thường, lag_days mặc định 0", () => {
    for (const kind of ["relates", "blocks", "precedes", "duplicates"]) {
      const r = validateRelationCreate({ kind, to_task_id: UUID });
      expect(r).toEqual({
        ok: true,
        data: { kind, to_task_id: UUID.toLowerCase(), lag_days: 0 },
      });
    }
  });

  it("precedes nhận lag_days nguyên trong ±365 (kể cả âm)", () => {
    for (const lag of [LAG_DAYS_MAX_ABS, -LAG_DAYS_MAX_ABS, 3, -2]) {
      const r = validateRelationCreate({
        kind: "precedes",
        to_task_id: UUID,
        lag_days: lag,
      });
      expect(r.ok && r.data.lag_days).toBe(lag);
    }
  });

  it("lag_days = 0 được với mọi kiểu; -0 thành 0", () => {
    const r = validateRelationCreate({
      kind: "blocks",
      to_task_id: UUID,
      lag_days: -0,
    });
    expect(r.ok && Object.is(r.data.lag_days, 0)).toBe(true);
  });

  it("thiếu kind, to_task_id: required", () => {
    expect(issues({})).toEqual([
      { field: "kind", issue: "required" },
      { field: "to_task_id", issue: "required" },
    ]);
    expect(issues({ kind: null, to_task_id: null })).toEqual([
      { field: "kind", issue: "required" },
      { field: "to_task_id", issue: "required" },
    ]);
  });

  it("kind lạ, to_task_id sai định dạng", () => {
    expect(issues({ kind: "blocked_by", to_task_id: "abc" })).toEqual([
      { field: "kind", issue: "invalid_value" },
      { field: "to_task_id", issue: "invalid_format" },
    ]);
    expect(issues({ kind: 1, to_task_id: 1 })).toEqual([
      { field: "kind", issue: "invalid_value" },
      { field: "to_task_id", issue: "invalid_format" },
    ]);
  });

  it("lag_days sai kiểu, không nguyên, ngoài khoảng, null", () => {
    for (const lag of ["1", 1.5, 366, -366, null, Number.NaN, Infinity]) {
      expect(
        issues({ kind: "precedes", to_task_id: UUID, lag_days: lag }),
      ).toEqual([{ field: "lag_days", issue: "invalid_value" }]);
    }
  });

  it("lag_days khác 0 chỉ cho precedes", () => {
    for (const kind of ["relates", "blocks", "duplicates"]) {
      expect(issues({ kind, to_task_id: UUID, lag_days: 2 })).toEqual([
        { field: "lag_days", issue: "invalid_value" },
      ]);
    }
  });

  it("từ chối trường lạ (from_task_id, created_by)", () => {
    expect(
      issues({
        kind: "blocks",
        to_task_id: UUID,
        from_task_id: UUID,
        created_by: UUID,
      }),
    ).toEqual([
      { field: "from_task_id", issue: "unknown_field" },
      { field: "created_by", issue: "unknown_field" },
    ]);
  });

  it("thân không phải object", () => {
    for (const body of [null, [], "x", 1]) {
      expect(issues(body)).toEqual([
        { field: "body", issue: "invalid_format" },
      ]);
    }
  });
});
