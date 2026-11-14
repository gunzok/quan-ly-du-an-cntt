import { describe, expect, it } from "vitest";
import {
  DESCRIPTION_MAX_LENGTH,
  LIST_LIMIT_DEFAULT,
  TITLE_MAX_LENGTH,
  decodeTaskCursor,
  encodeTaskCursor,
  isDateOrderValid,
  isIsoDate,
  validateTaskCreate,
  validateTaskListQuery,
  validateTaskPatch,
} from "./validate";

const UUID = "6c1e8f9a-1b2c-4d3e-8f00-112233445566";

describe("isIsoDate", () => {
  it("nhận ngày YYYY-MM-DD có thật", () => {
    expect(isIsoDate("2026-12-05")).toBe(true);
    expect(isIsoDate("2028-02-29")).toBe(true);
  });
  it("từ chối ngày không có thật hoặc sai định dạng", () => {
    for (const v of [
      "2026-02-30",
      "2026-13-01",
      "2026-1-05",
      "05/12/2026",
      "2026-12-05T00:00:00Z",
      "",
      20261205,
      null,
    ]) {
      expect(isIsoDate(v)).toBe(false);
    }
  });
});

describe("isDateOrderValid (BR-13)", () => {
  it("ngày kết thúc sớm hơn ngày bắt đầu là sai", () => {
    expect(isDateOrderValid("2026-12-10", "2026-12-05")).toBe(false);
  });
  it("bằng nhau, đúng thứ tự hoặc thiếu một ngày là hợp lệ", () => {
    expect(isDateOrderValid("2026-12-05", "2026-12-05")).toBe(true);
    expect(isDateOrderValid("2026-12-01", "2026-12-05")).toBe(true);
    expect(isDateOrderValid(null, "2026-12-05")).toBe(true);
    expect(isDateOrderValid("2026-12-05", undefined)).toBe(true);
  });
});

describe("validateTaskCreate", () => {
  it("chỉ có tên: hợp lệ, các trường khác mặc định null", () => {
    expect(validateTaskCreate({ title: "  Thiết kế Kanban  " })).toEqual({
      ok: true,
      data: {
        title: "Thiết kế Kanban",
        description: null,
        assignee_id: null,
        start_date: null,
        due_date: null,
      },
    });
  });

  it("đủ trường hợp lệ", () => {
    const r = validateTaskCreate({
      title: "Task",
      description: "Dòng 1\nDòng 2\tcó tab",
      assignee_id: UUID.toUpperCase(),
      priority: "high",
      start_date: "2026-12-01",
      due_date: "2026-12-05",
      position: 1.5,
    });
    expect(r).toEqual({
      ok: true,
      data: {
        title: "Task",
        description: "Dòng 1\nDòng 2\tcó tab",
        assignee_id: UUID,
        priority: "high",
        start_date: "2026-12-01",
        due_date: "2026-12-05",
        position: 1.5,
      },
    });
  });

  it("thiếu tên hoặc tên rỗng: required (AC1 phía từ chối)", () => {
    for (const body of [{}, { title: "" }, { title: "   " }, { title: null }]) {
      const r = validateTaskCreate(body);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.details).toContainEqual({ field: "title", issue: "required" });
      }
    }
  });

  it("tên quá dài, có ký tự điều khiển, sai kiểu", () => {
    const cases: [unknown, string][] = [
      ["a".repeat(TITLE_MAX_LENGTH + 1), "too_long"],
      ["dòng\nmới", "invalid_format"],
      [123, "invalid_value"],
    ];
    for (const [title, issue] of cases) {
      const r = validateTaskCreate({ title });
      expect(r).toEqual({ ok: false, details: [{ field: "title", issue }] });
    }
    expect(validateTaskCreate({ title: "a".repeat(TITLE_MAX_LENGTH) }).ok).toBe(
      true,
    );
  });

  it("từ chối trường lạ, kể cả trường của Story sau và trường hệ thống", () => {
    const r = validateTaskCreate({
      title: "x",
      created_by: UUID,
      parent_id: UUID,
      status_id: UUID,
      label_ids: [],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.details.map((d) => d.field).sort()).toEqual([
        "created_by",
        "label_ids",
        "parent_id",
        "status_id",
      ]);
      expect(r.details.every((d) => d.issue === "unknown_field")).toBe(true);
    }
  });

  it("thân không phải object: invalid_format", () => {
    for (const body of [null, [], "x", 1]) {
      expect(validateTaskCreate(body)).toEqual({
        ok: false,
        details: [{ field: "body", issue: "invalid_format" }],
      });
    }
  });

  it("sai kiểu từng trường", () => {
    const r = validateTaskCreate({
      title: "x",
      description: 5,
      assignee_id: "khong-phai-uuid",
      priority: "critical",
      start_date: "2026-02-30",
      due_date: "hôm nay",
      position: Number.POSITIVE_INFINITY,
    });
    expect(r).toEqual({
      ok: false,
      details: [
        { field: "description", issue: "invalid_value" },
        { field: "assignee_id", issue: "invalid_format" },
        { field: "priority", issue: "invalid_value" },
        { field: "start_date", issue: "invalid_format" },
        { field: "due_date", issue: "invalid_format" },
        { field: "position", issue: "invalid_value" },
      ],
    });
  });

  it("mô tả: rỗng thành null, quá dài, ký tự điều khiển cấm", () => {
    const empty = validateTaskCreate({ title: "x", description: "  " });
    expect(empty.ok && empty.data.description).toBe(null);
    expect(
      validateTaskCreate({
        title: "x",
        description: "a".repeat(DESCRIPTION_MAX_LENGTH + 1),
      }),
    ).toEqual({
      ok: false,
      details: [{ field: "description", issue: "too_long" }],
    });
    expect(validateTaskCreate({ title: "x", description: "a\u0000b" })).toEqual(
      {
        ok: false,
        details: [{ field: "description", issue: "invalid_format" }],
      },
    );
  });

  it("position không phải số hữu hạn hoặc quá lớn bị từ chối", () => {
    for (const position of ["1", 1e13, Number.NaN, null]) {
      expect(validateTaskCreate({ title: "x", position }).ok).toBe(false);
    }
  });
});

describe("validateTaskPatch", () => {
  it("chỉ trường có mặt; null xóa ngày, người phụ trách, mô tả", () => {
    expect(
      validateTaskPatch({
        assignee_id: null,
        due_date: null,
        description: null,
      }),
    ).toEqual({
      ok: true,
      data: { assignee_id: null, due_date: null, description: null },
    });
  });

  it("thân rỗng: required", () => {
    expect(validateTaskPatch({})).toEqual({
      ok: false,
      details: [{ field: "body", issue: "required" }],
    });
  });

  it("title, priority, position không được null", () => {
    const r = validateTaskPatch({
      title: null,
      priority: null,
      position: null,
    });
    expect(r).toEqual({
      ok: false,
      details: [
        { field: "title", issue: "required" },
        { field: "priority", issue: "invalid_value" },
        { field: "position", issue: "invalid_value" },
      ],
    });
  });

  it("từ chối đổi project_id, status_id, created_by, completed_at", () => {
    const r = validateTaskPatch({
      project_id: UUID,
      status_id: UUID,
      created_by: UUID,
      completed_at: "2026-11-14T00:00:00Z",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.details).toHaveLength(4);
      expect(r.details.every((d) => d.issue === "unknown_field")).toBe(true);
    }
  });

  it("kéo thả: chỉ position", () => {
    expect(validateTaskPatch({ position: 3 })).toEqual({
      ok: true,
      data: { position: 3 },
    });
  });
});

describe("con trỏ phân trang", () => {
  const cursor = { created_at: "2026-11-14T09:10:11.123456+00:00", id: UUID };

  it("mã hóa rồi giải mã ra đúng giá trị", () => {
    expect(decodeTaskCursor(encodeTaskCursor(cursor))).toEqual(cursor);
  });

  it("từ chối con trỏ hỏng hoặc chứa giá trị có thể chen bộ lọc", () => {
    const bad = [
      "!!!",
      Buffer.from("not json").toString("base64url"),
      Buffer.from(JSON.stringify(["2026-11-14", UUID])).toString("base64url"),
      Buffer.from(
        JSON.stringify(['2026-11-14T09:10:11Z",id.gt.0', UUID]),
      ).toString("base64url"),
      Buffer.from(JSON.stringify([cursor.created_at, "x"])).toString(
        "base64url",
      ),
      "a".repeat(300),
    ];
    for (const raw of bad) expect(decodeTaskCursor(raw)).toBeNull();
  });
});

describe("validateTaskListQuery", () => {
  it("mặc định", () => {
    expect(validateTaskListQuery(new URLSearchParams())).toEqual({
      ok: true,
      data: {
        limit: LIST_LIMIT_DEFAULT,
        cursor: null,
        assignee_id: null,
        status_id: null,
        priority: null,
      },
    });
  });

  it("lọc cơ bản và limit", () => {
    const r = validateTaskListQuery(
      new URLSearchParams({
        limit: "100",
        assignee_id: UUID,
        status_id: UUID,
        priority: "urgent",
      }),
    );
    expect(r).toEqual({
      ok: true,
      data: {
        limit: 100,
        cursor: null,
        assignee_id: UUID,
        status_id: UUID,
        priority: "urgent",
      },
    });
  });

  it("từ chối limit ngoài 1-100, tham số lạ, tham số lặp, giá trị sai", () => {
    for (const qs of [
      "limit=0",
      "limit=101",
      "limit=abc",
      "q=tim",
      "sort=due_date",
      "priority=low&priority=high",
      "assignee_id=abc",
      "priority=critical",
      "cursor=%%%",
    ]) {
      expect(validateTaskListQuery(new URLSearchParams(qs)).ok).toBe(false);
    }
  });
});
