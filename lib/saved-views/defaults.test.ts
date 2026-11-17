import { describe, expect, it } from "vitest";
import { viewTaskListParams } from "./apply";
import {
  DEFAULT_VIEW_KEYS,
  DEFAULT_VIEWS,
  defaultViewKey,
  defaultViewRank,
} from "./defaults";
import { readViewQuery } from "./validate";
import { validateTaskListQuery } from "@/lib/tasks/validate";

describe("7 chế độ xem mặc định (E13-2)", () => {
  it("đủ 7, đúng thứ tự OpenProject, id và tên không trùng", () => {
    expect(DEFAULT_VIEWS.map((v) => v.key)).toEqual([...DEFAULT_VIEW_KEYS]);
    expect(DEFAULT_VIEWS).toHaveLength(7);
    expect(new Set(DEFAULT_VIEWS.map((v) => v.id)).size).toBe(7);
    expect(new Set(DEFAULT_VIEWS.map((v) => v.name)).size).toBe(7);
    expect(DEFAULT_VIEWS.map((v) => v.name)).toEqual([
      "Tất cả đang mở",
      "Hoạt động gần nhất",
      "Mới tạo",
      "Quá hạn",
      "Tóm tắt",
      "Tạo bởi tôi",
      "Giao cho tôi",
    ]);
  });

  it("query hợp lệ theo schema API và đã ở dạng chuẩn hóa", () => {
    for (const v of DEFAULT_VIEWS) {
      const details: unknown[] = [];
      const parsed = readViewQuery(v.query, details as never);
      expect(details, v.key).toEqual([]);
      expect(parsed, v.key).toEqual(v.query);
    }
  });

  it("bộ lọc + sắp xếp ra đúng tham số API danh sách task và API nhận", () => {
    const params = Object.fromEntries(
      DEFAULT_VIEWS.map((v) => [
        v.key,
        viewTaskListParams(v.query.filters, v.query.sort).toString(),
      ]),
    );
    expect(params).toEqual({
      allOpen: "open=true",
      latestActivity: "open=true&sort=-updated_at",
      recentlyCreated: "open=true&sort=-created_at",
      overdue: "overdue=true",
      summary: "",
      createdByMe: "open=true&created_by=me&sort=-created_at",
      assignedToMe: "open=true&assignee_id=me",
    });
    for (const qs of Object.values(params)) {
      expect(validateTaskListQuery(new URLSearchParams(qs)).ok).toBe(true);
    }
  });

  it("tra khóa và thứ tự theo id", () => {
    expect(defaultViewKey("7e0d0000-0000-4000-8000-000000000007")).toBe(
      "assignedToMe",
    );
    expect(defaultViewKey("7e0d0000-0000-4000-8000-000000000099")).toBeNull();
    expect(defaultViewRank("7e0d0000-0000-4000-8000-000000000001")).toBe(0);
    expect(defaultViewRank("x")).toBe(7);
  });
});
