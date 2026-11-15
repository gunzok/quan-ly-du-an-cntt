import { describe, expect, it } from "vitest";
import { relationLabel, toRelationView, type TaskRelation } from "./model";

describe("relationLabel", () => {
  it("chiều xuôi giữ nguyên kiểu", () => {
    for (const k of ["relates", "blocks", "precedes", "duplicates"] as const) {
      expect(relationLabel(k, "outgoing")).toBe(k);
    }
  });
  it("chiều đảo: blocked_by, follows, duplicated_by; relates đối xứng", () => {
    expect(relationLabel("blocks", "incoming")).toBe("blocked_by");
    expect(relationLabel("precedes", "incoming")).toBe("follows");
    expect(relationLabel("duplicates", "incoming")).toBe("duplicated_by");
    expect(relationLabel("relates", "incoming")).toBe("relates");
  });
});

describe("toRelationView", () => {
  const row: TaskRelation = {
    id: "r1",
    from_task_id: "a",
    to_task_id: "b",
    kind: "blocks",
    lag_days: 0,
    created_by: "u",
    created_at: "2026-11-15T00:00:00Z",
  };
  it("nhìn từ task nguồn và task đích", () => {
    const other = { id: "b", title: "B", status_id: null };
    expect(toRelationView(row, "a", other)).toMatchObject({
      id: "r1",
      direction: "outgoing",
      relation: "blocks",
      task: other,
    });
    expect(
      toRelationView(row, "b", { id: "a", title: "A", status_id: "s" }),
    ).toMatchObject({
      direction: "incoming",
      relation: "blocked_by",
      task: { id: "a", title: "A", status_id: "s" },
    });
  });
});
