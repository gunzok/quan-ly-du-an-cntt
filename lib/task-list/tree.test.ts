import { describe, expect, it } from "vitest";
import type { Task } from "@/lib/tasks/model";
import {
  buildRows,
  groupComparator,
  matchesListFilters,
  NONE_GROUP,
  parentIds,
  taskComparator,
  type BuildInput,
  type ListContext,
  type TaskRow,
} from "./tree";

let seq = 0;
function task(id: string, patch: Partial<Task> = {}): Task {
  seq += 1;
  return {
    id,
    project_id: "p",
    parent_id: null,
    depth: 1,
    type_id: null,
    title: id,
    description: null,
    assignee_id: null,
    created_by: null,
    priority: "medium",
    start_date: null,
    due_date: null,
    status_id: "s1",
    position: 0,
    completed_at: null,
    created_at: `2026-11-01T00:00:${String(seq % 60).padStart(2, "0")}Z`,
    updated_at: "2026-11-01T00:00:00Z",
    label_ids: [],
    ...patch,
  };
}

const ctx: ListContext = {
  statusOrder: new Map([
    ["s1", 0],
    ["s2", 1],
    ["s3", 2],
  ]),
  typeOrder: new Map([
    ["t1", 0],
    ["t2", 1],
  ]),
  labelOrder: new Map([
    ["l1", 0],
    ["l2", 1],
  ]),
  memberName: new Map([
    ["u1", "Bảo"],
    ["u2", "An"],
  ]),
};

// Cây: A > A1 > A11, A > A2; B (gốc); C có cha không tải được (thành gốc).
const A = task("A", { title: "Alpha" });
const A1 = task("A1", { parent_id: "A", depth: 2, status_id: "s2" });
const A11 = task("A11", { parent_id: "A1", depth: 3, priority: "urgent" });
const A2 = task("A2", { parent_id: "A", depth: 2, label_ids: ["l1", "l2"] });
const B = task("B", { title: "Beta", assignee_id: "u1" });
const C = task("C", { parent_id: "missing", depth: 2 });
const ALL = [A, A1, A11, A2, B, C];

function input(patch: Partial<BuildInput> = {}): BuildInput {
  return {
    tasks: ALL,
    matched: null,
    sort: [],
    groupBy: null,
    collapsed: new Set(),
    collapsedGroups: new Set(),
    ctx,
    ...patch,
  };
}

const keys = (i: BuildInput) => buildRows(i).rows.map((r) => r.key);
const taskRows = (i: BuildInput) =>
  buildRows(i).rows.filter((r): r is TaskRow => r.kind === "task");

describe("buildRows: cây phân cấp", () => {
  it("dựng 3 cấp theo parent_id; cha không tải được thì thành gốc", () => {
    const rows = taskRows(input());
    expect(rows.map((r) => [r.task.id, r.level, r.childCount])).toEqual([
      ["A", 1, 2],
      ["A1", 2, 1],
      ["A11", 3, 0],
      ["A2", 2, 0],
      ["B", 1, 0],
      ["C", 1, 0],
    ]);
  });

  it("AC1: thu gọn task cha ẩn mọi hàng con cháu, mở lại thì hiện", () => {
    expect(keys(input({ collapsed: new Set(["A"]) }))).toEqual(["A", "B", "C"]);
    expect(keys(input({ collapsed: new Set(["A1"]) }))).toEqual([
      "A",
      "A1",
      "A2",
      "B",
      "C",
    ]);
    const row = taskRows(input({ collapsed: new Set(["A"]) }))[0];
    expect(row.expanded).toBe(false);
    expect(row.childCount).toBe(2);
    expect(keys(input())).toContain("A11");
  });

  it("AC1: trạng thái thu gọn giữ nguyên khi lọc", () => {
    const filtered = input({
      matched: new Set(["A11", "B"]),
      collapsed: new Set(["A1"]),
    });
    // A11 khớp nhưng A1 đang thu gọn: vẫn ẩn; tổ tiên hiện làm ngữ cảnh.
    expect(keys(filtered)).toEqual(["A", "A1", "B"]);
    const rows = taskRows(filtered);
    expect(rows.find((r) => r.task.id === "A")?.context).toBe(true);
    expect(rows.find((r) => r.task.id === "B")?.context).toBe(false);
    expect(buildRows(filtered).matchCount).toBe(2);
    // Mở A1: A11 hiện ở cấp 3.
    expect(keys({ ...filtered, collapsed: new Set() })).toEqual([
      "A",
      "A1",
      "A11",
      "B",
    ]);
  });

  it("sắp xếp anh em trong từng cấp, giữ cấu trúc cây", () => {
    const rows = keys(input({ sort: [{ field: "title", direction: "desc" }] }));
    // Gốc: C, Beta, Alpha (desc); con của A: A2, A1.
    expect(rows).toEqual(["C", "B", "A", "A2", "A1", "A11"]);
  });
});

describe("buildRows: nhóm", () => {
  it("AC2: nhóm theo trạng thái theo thứ tự cấu hình, thu gọn được", () => {
    const r = buildRows(input({ groupBy: "status_id" }));
    const groups = r.rows.filter((x) => x.kind === "group");
    expect(groups.map((g) => [g.value, g.count])).toEqual([
      ["s1", 5],
      ["s2", 1],
    ]);
    // Cha-con chỉ nối khi cùng nhóm: A11 (s1) có cha A1 (s2) nên là gốc trong nhóm s1.
    expect(r.rows.map((x) => x.key)).toEqual([
      "group:s1",
      "s1/A",
      "s1/A2",
      "s1/A11",
      "s1/B",
      "s1/C",
      "group:s2",
      "s2/A1",
    ]);
    const collapsed = keys(
      input({ groupBy: "status_id", collapsedGroups: new Set(["s1"]) }),
    );
    expect(collapsed).toEqual(["group:s1", "group:s2", "s2/A1"]);
  });

  it("nhóm theo nhãn: task nhiều nhãn ở mỗi nhóm, không nhãn ở cuối", () => {
    const rows = keys(input({ groupBy: "label_ids" }));
    expect(rows.filter((k) => k.startsWith("group:"))).toEqual([
      "group:l1",
      "group:l2",
      `group:${NONE_GROUP}`,
    ]);
    expect(rows).toContain("l1/A2");
    expect(rows).toContain("l2/A2");
    expect(buildRows(input({ groupBy: "label_ids" })).matchCount).toBe(6);
  });

  it("nhóm theo người phụ trách, ưu tiên, loại", () => {
    const byAssignee = buildRows(input({ groupBy: "assignee_id" })).rows.filter(
      (r) => r.kind === "group",
    );
    expect(byAssignee.map((g) => g.value)).toEqual(["u1", NONE_GROUP]);
    const byPriority = buildRows(input({ groupBy: "priority" })).rows.filter(
      (r) => r.kind === "group",
    );
    expect(byPriority.map((g) => g.value)).toEqual(["urgent", "medium"]);
    const byType = buildRows(input({ groupBy: "type_id" })).rows.filter(
      (r) => r.kind === "group",
    );
    expect(byType.map((g) => g.value)).toEqual([NONE_GROUP]);
  });

  it("khi nhóm, chỉ task khớp (không hàng ngữ cảnh)", () => {
    const rows = taskRows(
      input({ groupBy: "status_id", matched: new Set(["A11"]) }),
    );
    expect(rows.map((r) => [r.task.id, r.context])).toEqual([["A11", false]]);
  });
});

describe("matchesListFilters (cùng ngữ nghĩa API danh sách)", () => {
  const t = task("x", {
    status_id: "s2",
    assignee_id: "u1",
    priority: "high",
    label_ids: ["l1"],
    due_date: "2026-11-20",
  });
  it("khớp từng điều kiện, kết hợp AND", () => {
    expect(matchesListFilters(t, {}, null)).toBe(true);
    expect(matchesListFilters(t, { status_id: ["s1", "s2"] }, null)).toBe(true);
    expect(matchesListFilters(t, { status_id: ["s1"] }, null)).toBe(false);
    expect(matchesListFilters(t, { assignee_id: "u2" }, null)).toBe(false);
    expect(matchesListFilters(t, { priority: "high" }, null)).toBe(true);
    expect(matchesListFilters(t, { label_id: "l2" }, null)).toBe(false);
    expect(
      matchesListFilters(
        t,
        { due_after: "2026-11-20", due_before: "2026-11-20" },
        null,
      ),
    ).toBe(true);
    expect(matchesListFilters(t, { due_after: "2026-11-21" }, null)).toBe(
      false,
    );
    expect(matchesListFilters(t, {}, new Set(["y"]))).toBe(false);
  });
  it("lọc theo hạn loại task không có hạn", () => {
    expect(
      matchesListFilters(task("n"), { due_before: "2030-01-01" }, null),
    ).toBe(false);
  });
});

describe("so sánh", () => {
  it("giá trị trống luôn ở cuối, cả khi giảm dần", () => {
    const a = task("a", { due_date: "2026-01-01" });
    const b = task("b", { due_date: null });
    const c = task("c", { due_date: "2026-02-01" });
    for (const direction of ["asc", "desc"] as const) {
      const sorted = [b, a, c].sort(
        taskComparator([{ field: "due_date", direction }], ctx),
      );
      expect(sorted.at(-1)?.id).toBe("b");
    }
  });
  it("ưu tiên tăng dần là thấp → khẩn cấp; nhóm ưu tiên khẩn cấp trước", () => {
    const low = task("l", { priority: "low" });
    const urgent = task("u", { priority: "urgent" });
    expect(
      [urgent, low]
        .sort(taskComparator([{ field: "priority", direction: "asc" }], ctx))
        .map((x) => x.id),
    ).toEqual(["l", "u"]);
    expect(
      ["low", "urgent", "high"].sort(groupComparator("priority", ctx)),
    ).toEqual(["urgent", "high", "low"]);
  });
  it("người phụ trách sắp theo tên tiếng Việt", () => {
    expect(
      [NONE_GROUP, "u1", "u2", "gone"].sort(
        groupComparator("assignee_id", ctx),
      ),
    ).toEqual(["u2", "u1", "gone", NONE_GROUP]);
  });
});

describe("parentIds", () => {
  it("chỉ task có con đã tải", () => {
    expect([...parentIds(ALL)].sort()).toEqual(["A", "A1"]);
  });
});
