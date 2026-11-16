import { describe, expect, it } from "vitest";
import {
  orderSubtaskTree,
  taskPermissions,
  TASK_MAX_DEPTH,
  type TaskSummary,
} from "./detail";
import type { Actor } from "./policy";

const ME = "00000000-0000-0000-0000-0000000000c1";
const OTHER = "00000000-0000-0000-0000-0000000000b1";
const actor = (role: Actor["role"], isAdmin = false): Actor => ({
  userId: ME,
  isAdmin,
  role,
});

function row(
  id: string,
  parent_id: string | null,
  position = 0,
  created_at = "2026-11-01T00:00:00Z",
): TaskSummary {
  return {
    id,
    parent_id,
    depth: 0,
    title: id,
    status_id: null,
    assignee_id: null,
    due_date: null,
    completed_at: null,
    position,
    created_at,
  };
}

describe("orderSubtaskTree", () => {
  it("duyệt trước theo cây, anh em theo position rồi created_at", () => {
    const rows = [
      row("b", "root", 1),
      row("a2", "a", 0, "2026-11-02T00:00:00Z"),
      row("a", "root", 0),
      row("a1", "a", 0, "2026-11-01T00:00:00Z"),
    ];
    expect(orderSubtaskTree(rows, "root").map((r) => r.id)).toEqual([
      "a",
      "a1",
      "a2",
      "b",
    ]);
  });

  it("bỏ dòng mồ côi, không lặp vô hạn khi dữ liệu có vòng", () => {
    const rows = [
      row("a", "root"),
      row("x", "y"),
      row("y", "x"),
      row("root", "a"),
    ];
    expect(orderSubtaskTree(rows, "root").map((r) => r.id)).toEqual(["a"]);
  });
});

describe("taskPermissions", () => {
  const notMine = { created_by: OTHER, assignee_id: OTHER, depth: 1 };
  const assigned = { created_by: OTHER, assignee_id: ME, depth: 1 };
  const mine = { created_by: ME, assignee_id: null, depth: 1 };

  it("PM và Admin: mọi quyền", () => {
    for (const a of [actor("pm"), actor(null, true)]) {
      expect(taskPermissions(a, notMine)).toEqual({
        can_edit: true,
        can_delete: true,
        can_reassign: true,
        can_add_subtask: true,
      });
    }
  });

  it("Người xem: không quyền nào (AC2)", () => {
    expect(taskPermissions(actor("viewer"), mine)).toEqual({
      can_edit: false,
      can_delete: false,
      can_reassign: false,
      can_add_subtask: false,
    });
  });

  it("Thành viên: chỉ task mình phụ trách hoặc tạo; phụ trách thì không giao đi, không xóa", () => {
    expect(taskPermissions(actor("member"), notMine).can_edit).toBe(false);
    expect(taskPermissions(actor("member"), assigned)).toEqual({
      can_edit: true,
      can_delete: false,
      can_reassign: false,
      can_add_subtask: true,
    });
    expect(taskPermissions(actor("member"), mine).can_reassign).toBe(true);
  });

  it("task cấp cuối không thêm việc con", () => {
    expect(
      taskPermissions(actor("pm"), { ...mine, depth: TASK_MAX_DEPTH })
        .can_add_subtask,
    ).toBe(false);
  });
});
