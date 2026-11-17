import { describe, expect, it } from "vitest";
import { validateViewCreate } from "@/lib/saved-views/validate";
import {
  DEFAULT_TASK_LIST_STATE,
  fromSavedViewQuery,
  nextSort,
  normalizeColumns,
  parseListPrefs,
  serializeListPrefs,
  toSavedViewQuery,
  type TaskListState,
} from "./model";

const state: TaskListState = {
  filters: {
    q: "hop dong",
    status_id: ["11111111-1111-4111-8111-111111111111"],
    priority: "high",
    due_after: "2026-11-01",
  },
  sort: [{ field: "due_date", direction: "desc" }],
  group_by: "label_ids",
  columns: ["label_ids", "title", "due_date"],
};

describe("trạng thái bảng theo lược đồ query v1", () => {
  it("toSavedViewQuery đi qua đúng schema API chế độ xem đã lưu", () => {
    const query = toSavedViewQuery(state);
    const result = validateViewCreate({ name: "Bảng", query });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.query).toEqual(query);
    expect(fromSavedViewQuery(query)).toEqual({
      ...state,
      columns: ["title", "due_date", "label_ids"],
    });
  });

  it("cột luôn có title đứng đầu, theo thứ tự cố định, không trùng", () => {
    expect(normalizeColumns(["due_date", "status_id", "due_date"])).toEqual([
      "title",
      "status_id",
      "due_date",
    ]);
  });

  it("bấm tiêu đề cột: tăng → giảm → bỏ", () => {
    const a = nextSort([], "title");
    expect(a).toEqual([{ field: "title", direction: "asc" }]);
    const b = nextSort(a, "title");
    expect(b).toEqual([{ field: "title", direction: "desc" }]);
    expect(nextSort(b, "title")).toEqual([]);
    expect(nextSort(b, "priority")).toEqual([
      { field: "priority", direction: "asc" },
    ]);
  });
});

describe("ghi nhớ cách xem ở trình duyệt", () => {
  it("lưu cột, sắp xếp, nhóm; không lưu bộ lọc", () => {
    const back = parseListPrefs(serializeListPrefs(state));
    expect(back.filters).toEqual({});
    expect(back.group_by).toBe("label_ids");
    expect(back.sort).toEqual(state.sort);
    expect(back.columns).toEqual(["title", "due_date", "label_ids"]);
  });

  it("dữ liệu hỏng hoặc bị sửa tay thì về mặc định", () => {
    expect(parseListPrefs(null)).toBe(DEFAULT_TASK_LIST_STATE);
    expect(parseListPrefs("{")).toBe(DEFAULT_TASK_LIST_STATE);
    expect(
      parseListPrefs(JSON.stringify({ version: 1, group_by: "evil" })),
    ).toBe(DEFAULT_TASK_LIST_STATE);
    expect(parseListPrefs(JSON.stringify({ columns: ["x"] }))).toBe(
      DEFAULT_TASK_LIST_STATE,
    );
  });
});
