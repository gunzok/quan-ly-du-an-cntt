import { describe, expect, it } from "vitest";
import type { Task } from "@/lib/tasks/model";
import {
  EMPTY_FILTERS,
  UNASSIGNED,
  canMoveTask,
  groupByStatus,
  hasActiveFilters,
  isOverdue,
  matchesFilters,
  subtaskCounts,
  todayIso,
} from "./board";

function task(id: string, over: Partial<Task> = {}): Task {
  return {
    id,
    project_id: "p",
    parent_id: null,
    depth: 1,
    type_id: null,
    title: id,
    description: null,
    assignee_id: null,
    created_by: "creator",
    priority: "medium",
    start_date: null,
    due_date: null,
    status_id: "s1",
    position: 0,
    completed_at: null,
    created_at: "2026-11-15T00:00:00Z",
    updated_at: "2026-11-15T00:00:00Z",
    label_ids: [],
    ...over,
  };
}

describe("groupByStatus", () => {
  it("mỗi trạng thái một cột, sắp theo position; trạng thái lạ bị bỏ", () => {
    const cols = groupByStatus(
      [{ id: "s1" }, { id: "s2" }],
      [
        task("b", { position: 2 }),
        task("a", { position: 1 }),
        task("c", { status_id: "s2" }),
        task("x", { status_id: "khac" }),
      ],
    );
    expect(cols.get("s1")?.map((t) => t.id)).toEqual(["a", "b"]);
    expect(cols.get("s2")?.map((t) => t.id)).toEqual(["c"]);
    expect([...cols.keys()]).toEqual(["s1", "s2"]);
  });
});

describe("subtaskCounts", () => {
  it("đếm việc con trực tiếp, đã xong theo nhóm trạng thái", () => {
    const counts = subtaskCounts(
      [
        task("p"),
        task("c1", { parent_id: "p", status_id: "done" }),
        task("c2", { parent_id: "p" }),
        task("g", { parent_id: "c2", status_id: "done" }),
      ],
      (s) => (s === "done" ? "done" : "todo"),
    );
    expect(counts.get("p")).toEqual({ done: 1, total: 2 });
    expect(counts.get("c2")).toEqual({ done: 1, total: 1 });
    expect(counts.has("g")).toBe(false);
  });
});

describe("todayIso, isOverdue", () => {
  it("ngày theo giờ Việt Nam (UTC+7)", () => {
    expect(todayIso(new Date("2026-11-15T17:30:00Z"))).toBe("2026-11-16");
    expect(todayIso(new Date("2026-11-15T16:59:00Z"))).toBe("2026-11-15");
  });

  it("trễ hạn: hạn trước hôm nay và chưa xong", () => {
    expect(isOverdue("2026-11-14", "in_progress", "2026-11-15")).toBe(true);
    expect(isOverdue("2026-11-15", "todo", "2026-11-15")).toBe(false);
    expect(isOverdue("2026-11-14", "done", "2026-11-15")).toBe(false);
    expect(isOverdue(null, "todo", "2026-11-15")).toBe(false);
  });
});

describe("matchesFilters", () => {
  const t = task("t", {
    assignee_id: "u1",
    priority: "high",
    label_ids: ["l1"],
  });

  it("không lọc: khớp mọi task", () => {
    expect(hasActiveFilters(EMPTY_FILTERS)).toBe(false);
    expect(matchesFilters(t, EMPTY_FILTERS, null)).toBe(true);
  });

  it("kết hợp AND người phụ trách, ưu tiên, nhãn, từ khóa", () => {
    const f = {
      assignee: "u1",
      priority: "high" as const,
      label: "l1",
      q: "abc",
    };
    expect(hasActiveFilters(f)).toBe(true);
    expect(matchesFilters(t, f, new Set(["t"]))).toBe(true);
    expect(matchesFilters(t, f, new Set())).toBe(false);
    expect(matchesFilters(t, { ...f, assignee: "u2" }, null)).toBe(false);
    expect(matchesFilters(t, { ...f, priority: "low" }, null)).toBe(false);
    expect(matchesFilters(t, { ...f, label: "l2" }, null)).toBe(false);
  });

  it("chưa giao", () => {
    const f = { ...EMPTY_FILTERS, assignee: UNASSIGNED };
    expect(matchesFilters(t, f, null)).toBe(false);
    expect(matchesFilters(task("u"), f, null)).toBe(true);
  });
});

describe("canMoveTask (BR-03)", () => {
  const mine = task("m", { assignee_id: "me" });
  const created = task("c", { created_by: "me" });
  const other = task("o", { assignee_id: "you" });

  it("PM, Admin: mọi task; Người xem: không task nào", () => {
    for (const actor of [
      { userId: "me", isAdmin: false, role: "pm" as const },
      { userId: "me", isAdmin: true, role: null },
    ]) {
      expect(canMoveTask(actor, other)).toBe(true);
    }
    const viewer = { userId: "me", isAdmin: false, role: "viewer" as const };
    expect(canMoveTask(viewer, mine)).toBe(false);
  });

  it("Thành viên: task mình phụ trách hoặc tạo", () => {
    const member = { userId: "me", isAdmin: false, role: "member" as const };
    expect(canMoveTask(member, mine)).toBe(true);
    expect(canMoveTask(member, created)).toBe(true);
    expect(canMoveTask(member, other)).toBe(false);
  });
});
