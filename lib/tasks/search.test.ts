import { describe, expect, it } from "vitest";
import type { ApiErrorDetail } from "@/lib/api/errors";
import {
  SEARCH_Q_MAX_LENGTH,
  STATUS_FILTER_MAX,
  readSearchQuery,
  readStatusIds,
} from "./search";
import { validateTaskListQuery } from "./validate";

const A = "6c1e8f9a-1b2c-4d3e-8f00-112233445566";
const B = "0a1e8f9a-1b2c-4d3e-8f00-112233445566";

function errorsOf(qs: string | Record<string, string>) {
  const r = validateTaskListQuery(new URLSearchParams(qs));
  return r.ok ? [] : r.details;
}

describe("E3-3: q (từ khóa)", () => {
  it("cắt khoảng trắng hai đầu, giữ nguyên dấu và hoa thường (CSDL mới bỏ dấu)", () => {
    const details: ApiErrorDetail[] = [];
    expect(readSearchQuery("  Báo  CÁO ", details)).toBe("Báo  CÁO");
    expect(details).toEqual([]);
  });

  it("rỗng hoặc chỉ khoảng trắng: coi như không tìm", () => {
    for (const raw of ["", "   ", "  "]) {
      const r = validateTaskListQuery(new URLSearchParams({ q: raw }));
      expect(r.ok && r.data.q).toBeNull();
    }
  });

  it("giữ ký tự đặc biệt của LIKE (% _ \\) để CSDL thoát", () => {
    const r = validateTaskListQuery(
      new URLSearchParams({ q: "50% a_b c\\d *" }),
    );
    expect(r.ok && r.data.q).toBe("50% a_b c\\d *");
  });

  it(`dài quá ${SEARCH_Q_MAX_LENGTH} ký tự: 400 too_long; đúng giới hạn thì nhận`, () => {
    expect(errorsOf({ q: "a".repeat(SEARCH_Q_MAX_LENGTH + 1) })).toEqual([
      { field: "q", issue: "too_long" },
    ]);
    expect(errorsOf({ q: "a".repeat(SEARCH_Q_MAX_LENGTH) })).toEqual([]);
    // Khoảng trắng hai đầu không tính vào độ dài.
    expect(errorsOf({ q: ` ${"a".repeat(SEARCH_Q_MAX_LENGTH)} ` })).toEqual([]);
  });

  it("ký tự điều khiển: 400 invalid_format", () => {
    for (const raw of ["a\u0000b", "a\tb", "a\nb"]) {
      expect(errorsOf({ q: raw })).toEqual([
        { field: "q", issue: "invalid_format" },
      ]);
    }
  });

  it("q lặp lại: 400", () => {
    expect(errorsOf("q=a&q=b")).toContainEqual({
      field: "q",
      issue: "invalid_value",
    });
  });
});

describe("E3-3: status_id nhiều giá trị", () => {
  it("nhận một hoặc nhiều uuid ngăn bằng dấu phẩy, bỏ trùng, chữ thường", () => {
    const details: ApiErrorDetail[] = [];
    expect(readStatusIds(`${A.toUpperCase()},${B},${A}`, details)).toEqual(
      [A, B].sort(),
    );
    expect(details).toEqual([]);
  });

  it("phần tử sai hoặc rỗng: 400 invalid_format", () => {
    for (const raw of ["abc", `${A},`, `${A},,${B}`, ""]) {
      expect(errorsOf({ status_id: raw })).toEqual([
        { field: "status_id", issue: "invalid_format" },
      ]);
    }
  });

  it(`quá ${STATUS_FILTER_MAX} trạng thái: 400 too_long`, () => {
    const ids = Array.from(
      { length: STATUS_FILTER_MAX + 1 },
      (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    );
    expect(errorsOf({ status_id: ids.join(",") })).toEqual([
      { field: "status_id", issue: "too_long" },
    ]);
    expect(errorsOf({ status_id: ids.slice(1).join(",") })).toEqual([]);
  });
});

describe("E3-3: due_after, due_before", () => {
  it("nhận ngày hợp lệ, cho phép hai đầu bằng nhau", () => {
    const r = validateTaskListQuery(
      new URLSearchParams({
        due_after: "2026-12-01",
        due_before: "2026-12-01",
      }),
    );
    expect(r.ok && [r.data.due_after, r.data.due_before]).toEqual([
      "2026-12-01",
      "2026-12-01",
    ]);
  });

  it("sai định dạng hoặc ngày không có thật: 400 invalid_format", () => {
    expect(errorsOf({ due_after: "2026-02-30" })).toEqual([
      { field: "due_after", issue: "invalid_format" },
    ]);
    expect(errorsOf({ due_before: "01/12/2026" })).toEqual([
      { field: "due_before", issue: "invalid_format" },
    ]);
  });

  it("due_after sau due_before: 400 invalid_value", () => {
    expect(
      errorsOf({ due_after: "2026-12-02", due_before: "2026-12-01" }),
    ).toEqual([{ field: "due_before", issue: "invalid_value" }]);
  });
});

describe("E3-3: kết hợp", () => {
  it("mọi tham số cùng lúc", () => {
    const r = validateTaskListQuery(
      new URLSearchParams({
        q: "bao cao",
        status_id: `${A},${B}`,
        assignee_id: A,
        priority: "high",
        label_id: B,
        due_after: "2026-01-01",
        due_before: "2026-12-31",
        limit: "10",
      }),
    );
    expect(r).toEqual({
      ok: true,
      data: {
        limit: 10,
        cursor: null,
        assignee_id: A,
        status_ids: [A, B].sort(),
        priority: "high",
        label_id: B,
        q: "bao cao",
        due_after: "2026-01-01",
        due_before: "2026-12-31",
      },
    });
  });

  it("tham số lạ vẫn bị từ chối", () => {
    expect(errorsOf({ q: "a", due_from: "2026-01-01" })).toEqual([
      { field: "due_from", issue: "unknown_field" },
    ]);
  });
});
