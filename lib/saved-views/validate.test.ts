import { describe, expect, it } from "vitest";
import { viewTaskListParams } from "./apply";
import { DEFAULT_VIEW_COLUMNS, VIEW_COLUMNS, VIEW_SORT_FIELDS } from "./model";
import {
  readViewQuery,
  validateNoParams,
  validateViewCreate,
  validateViewPatch,
} from "./validate";
import type { ApiErrorDetail } from "@/lib/api/errors";

const S1 = "11111111-1111-4111-8111-111111111111";
const S2 = "22222222-2222-4222-8222-222222222222";

function query(value: unknown) {
  const details: ApiErrorDetail[] = [];
  const data = readViewQuery(value, details);
  return { data, details };
}

describe("readViewQuery", () => {
  it("điền mặc định cho khóa thiếu, luôn đủ 6 khóa", () => {
    expect(query({}).data).toEqual({
      version: 1,
      filters: {},
      sort: [],
      group_by: null,
      columns: [...DEFAULT_VIEW_COLUMNS],
      display: "list",
    });
  });

  it("chuẩn hóa bộ lọc theo đúng quy tắc API danh sách task", () => {
    const { data, details } = query({
      filters: {
        q: "  báo cáo  ",
        status_id: [S2, S1.toUpperCase(), S2],
        assignee_id: S1.toUpperCase(),
        priority: "high",
        label_id: S2,
        due_after: "2026-01-01",
        due_before: "2026-12-31",
      },
      sort: [{ field: "due_date", direction: "asc" }],
      group_by: "status_id",
      columns: [...VIEW_COLUMNS],
      display: "board",
    });
    expect(details).toEqual([]);
    expect(data?.filters).toEqual({
      q: "báo cáo",
      status_id: [S1, S2],
      assignee_id: S1,
      priority: "high",
      label_id: S2,
      due_after: "2026-01-01",
      due_before: "2026-12-31",
    });
    expect(data?.group_by).toBe("status_id");
    expect(data?.display).toBe("board");
  });

  it("q rỗng hoặc chỉ khoảng trắng: bỏ bộ lọc", () => {
    expect(query({ filters: { q: "   " } }).data?.filters).toEqual({});
  });

  it("khóa lạ ở mọi cấp bị từ chối", () => {
    expect(query({ extra: 1 }).details).toContainEqual({
      field: "query.extra",
      issue: "unknown_field",
    });
    expect(query({ filters: { limit: "5" } }).details).toContainEqual({
      field: "query.filters.limit",
      issue: "unknown_field",
    });
    expect(query({ filters: { cursor: "x" } }).details).toContainEqual({
      field: "query.filters.cursor",
      issue: "unknown_field",
    });
    expect(
      query({ sort: [{ field: "title", direction: "asc", x: 1 }] }).details,
    ).toContainEqual({ field: "query.sort", issue: "invalid_value" });
  });

  it("giá trị lọc sai: cùng lỗi như API danh sách task, kèm đường dẫn", () => {
    const issue = (filters: unknown) => query({ filters }).details;
    expect(issue({ status_id: ["x"] })).toContainEqual({
      field: "query.filters.status_id",
      issue: "invalid_value",
    });
    expect(issue({ status_id: [] })).toContainEqual({
      field: "query.filters.status_id",
      issue: "invalid_value",
    });
    // Không lách bằng chuỗi có dấu phẩy.
    expect(issue({ status_id: `${S1},${S2}` })).toContainEqual({
      field: "query.filters.status_id",
      issue: "invalid_value",
    });
    expect(issue({ assignee_id: "me" })).toContainEqual({
      field: "query.filters.assignee_id",
      issue: "invalid_format",
    });
    expect(issue({ priority: "critical" })).toContainEqual({
      field: "query.filters.priority",
      issue: "invalid_value",
    });
    expect(issue({ due_after: "2026-02-30" })).toContainEqual({
      field: "query.filters.due_after",
      issue: "invalid_format",
    });
    expect(
      issue({ due_after: "2026-03-01", due_before: "2026-02-01" }),
    ).toContainEqual({
      field: "query.filters.due_before",
      issue: "invalid_value",
    });
    expect(issue({ q: "a".repeat(201) })).toContainEqual({
      field: "query.filters.q",
      issue: "too_long",
    });
    expect(issue({ q: "a\u0001b" })).toContainEqual({
      field: "query.filters.q",
      issue: "invalid_format",
    });
    expect(issue({ priority: 1 })).toContainEqual({
      field: "query.filters.priority",
      issue: "invalid_value",
    });
    expect(
      issue({
        status_id: Array.from(
          { length: 21 },
          (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
        ),
      }),
    ).toContainEqual({ field: "query.filters.status_id", issue: "too_long" });
  });

  it("sắp xếp, nhóm, cột, kiểu hiển thị, version", () => {
    const sort = VIEW_SORT_FIELDS.slice(0, 4).map((field) => ({
      field,
      direction: "asc",
    }));
    expect(query({ sort }).details).toContainEqual({
      field: "query.sort",
      issue: "too_long",
    });
    expect(
      query({
        sort: [
          { field: "title", direction: "asc" },
          { field: "title", direction: "desc" },
        ],
      }).details,
    ).toContainEqual({ field: "query.sort", issue: "invalid_value" });
    expect(
      query({ sort: [{ field: "title", direction: "up" }] }).details,
    ).toContainEqual({ field: "query.sort", issue: "invalid_value" });
    // label_ids hợp lệ từ E3-2; số ít label_id thì không.
    expect(query({ group_by: "label_id" }).details).toContainEqual({
      field: "query.group_by",
      issue: "invalid_value",
    });
    expect(query({ columns: ["title", "title"] }).details).toContainEqual({
      field: "query.columns",
      issue: "invalid_value",
    });
    expect(query({ columns: ["password"] }).details).toContainEqual({
      field: "query.columns",
      issue: "invalid_value",
    });
    expect(query({ display: "calendar" }).details).toContainEqual({
      field: "query.display",
      issue: "invalid_value",
    });
    expect(query({ version: 2 }).details).toContainEqual({
      field: "query.version",
      issue: "invalid_value",
    });
    expect(query({ columns: [] }).data?.columns).toEqual([]);
  });

  it("query thiếu hoặc không phải đối tượng", () => {
    expect(query(undefined).details).toEqual([
      { field: "query", issue: "required" },
    ]);
    expect(query([]).details).toEqual([
      { field: "query", issue: "invalid_value" },
    ]);
  });
});

describe("validateViewCreate", () => {
  it("tên chuẩn hóa, visibility mặc định private", () => {
    const r = validateViewCreate({ name: "  Việc  của tôi ", query: {} });
    expect(r.ok && r.data.name).toBe("Việc của tôi");
    expect(r.ok && r.data.visibility).toBe("private");
  });

  it("tên rỗng, quá dài, ký tự điều khiển; trường lạ", () => {
    const details = (body: unknown) => {
      const r = validateViewCreate(body);
      return r.ok ? [] : r.details;
    };
    expect(details({ name: " ", query: {} })).toContainEqual({
      field: "name",
      issue: "required",
    });
    expect(details({ name: "a".repeat(101), query: {} })).toContainEqual({
      field: "name",
      issue: "too_long",
    });
    expect(details({ name: "a".repeat(100), query: {} })).toEqual([]);
    expect(details({ name: "a\u0000", query: {} })).toContainEqual({
      field: "name",
      issue: "invalid_format",
    });
    expect(details({ name: "a", query: {}, owner_id: S1 })).toContainEqual({
      field: "owner_id",
      issue: "unknown_field",
    });
    expect(details({ name: "a", query: {}, is_default: true })).toContainEqual({
      field: "is_default",
      issue: "unknown_field",
    });
    expect(
      details({ name: "a", query: {}, visibility: "team" }),
    ).toContainEqual({ field: "visibility", issue: "invalid_value" });
    expect(details({ name: "a" })).toContainEqual({
      field: "query",
      issue: "required",
    });
    expect(details("x")).toEqual([{ field: "body", issue: "invalid_format" }]);
  });
});

describe("validateViewPatch", () => {
  it("chỉ trường có mặt; ít nhất một trường", () => {
    expect(validateViewPatch({ is_favorite: true })).toEqual({
      ok: true,
      data: { is_favorite: true },
    });
    expect(validateViewPatch({})).toEqual({
      ok: false,
      details: [{ field: "body", issue: "required" }],
    });
    const bad = validateViewPatch({ is_favorite: "yes", project_id: S1 });
    expect(bad.ok ? [] : bad.details).toEqual([
      { field: "project_id", issue: "unknown_field" },
      { field: "is_favorite", issue: "invalid_value" },
    ]);
  });
});

describe("validateNoParams", () => {
  it("không nhận tham số", () => {
    expect(validateNoParams(new URLSearchParams()).ok).toBe(true);
    expect(validateNoParams(new URLSearchParams("x=1")).ok).toBe(false);
  });
});

describe("viewTaskListParams", () => {
  it("bộ lọc → tham số GET /tasks, status_id ngăn bằng dấu phẩy", () => {
    expect(
      viewTaskListParams({ status_id: [S1, S2], priority: "low" }).toString(),
    ).toBe(`status_id=${S1}%2C${S2}&priority=low`);
  });
});
