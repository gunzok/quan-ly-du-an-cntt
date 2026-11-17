import { describe, expect, it } from "vitest";
import type { Task } from "@/lib/tasks/model";
import { matchesListFilters } from "./tree";

/** E13-2: lọc ở trình duyệt cùng ngữ nghĩa với API cho bộ lọc của chế độ xem mặc định. */
function task(patch: Partial<Task>): Task {
  return {
    id: "t",
    project_id: "p",
    parent_id: null,
    depth: 1,
    type_id: null,
    title: "t",
    description: null,
    assignee_id: null,
    created_by: null,
    priority: "medium",
    start_date: null,
    due_date: null,
    status_id: "s1",
    position: 0,
    completed_at: null,
    created_at: "2026-11-01T00:00:00Z",
    updated_at: "2026-11-01T00:00:00Z",
    label_ids: [],
    ...patch,
  };
}
const who = { me: "u-me", today: "2026-11-17" };
const m = (t: Partial<Task>, f: Parameters<typeof matchesListFilters>[1]) =>
  matchesListFilters(task(t), f, null, who);

describe("matchesListFilters: me, created_by, open, overdue", () => {
  it("me là người đang xem", () => {
    expect(m({ assignee_id: "u-me" }, { assignee_id: "me" })).toBe(true);
    expect(m({ assignee_id: "u-x" }, { assignee_id: "me" })).toBe(false);
    expect(m({ created_by: "u-me" }, { created_by: "me" })).toBe(true);
    expect(m({ created_by: "u-x" }, { created_by: "me" })).toBe(false);
    expect(m({ created_by: "u-x" }, { created_by: "u-x" })).toBe(true);
  });

  it("open: chưa hoàn thành", () => {
    expect(m({}, { open: true })).toBe(true);
    expect(m({ completed_at: "2026-11-02T00:00:00Z" }, { open: true })).toBe(
      false,
    );
  });

  it("overdue: chưa xong, hạn trước hôm nay; hạn hôm nay chưa trễ; không hạn thì không", () => {
    expect(m({ due_date: "2026-11-16" }, { overdue: true })).toBe(true);
    expect(m({ due_date: "2026-11-17" }, { overdue: true })).toBe(false);
    expect(m({ due_date: null }, { overdue: true })).toBe(false);
    expect(
      m(
        { due_date: "2026-11-01", completed_at: "2026-11-02T00:00:00Z" },
        { overdue: true },
      ),
    ).toBe(false);
  });
});
