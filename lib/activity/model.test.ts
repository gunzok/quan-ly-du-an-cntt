import { describe, expect, it } from "vitest";
import {
  collectRefIds,
  sanitizeRow,
  toEntry,
  type ActivityRow,
  type RefNames,
} from "./model";

const P = "11111111-1111-4111-8111-111111111111";
const ACTOR = "22222222-2222-4222-8222-222222222222";
const TASK = "33333333-3333-4333-8333-333333333333";
const S1 = "44444444-4444-4444-8444-444444444444";
const S2 = "55555555-5555-4555-8555-555555555555";
const U = "66666666-6666-4666-8666-666666666666";
const PARENT = "77777777-7777-4777-8777-777777777777";

function row(partial: Partial<ActivityRow>): ActivityRow {
  return {
    id: 1,
    created_at: "2026-11-17T02:00:00.123456+00:00",
    actor_id: ACTOR,
    entity_type: "task",
    entity_id: TASK,
    action: "update",
    changes: { before: {}, after: {} },
    ...partial,
  };
}

function names(partial: Partial<RefNames> = {}): RefNames {
  return {
    people: new Map(),
    statuses: new Map(),
    types: new Map(),
    tasks: new Map(),
    projectName: "Dự án A",
    ...partial,
  };
}

describe("sanitizeRow: chỉ trả trường trong danh sách cho phép", () => {
  it("sửa task: giữ trường đã đổi, bỏ cột lạ, mô tả không lộ nội dung", () => {
    const s = sanitizeRow(
      row({
        changes: {
          before: {
            status_id: S1,
            description: "bí mật nội bộ",
            completed_at: null,
            secret_col: "x",
          },
          after: {
            status_id: S2,
            description: "bí mật mới",
            completed_at: "2026-11-17T02:00:00Z",
            secret_col: "y",
          },
        },
      }),
    )!;
    expect(s.changes).toEqual([
      { field: "status_id", kind: "status", before: S1, after: S2 },
      { field: "description", kind: "redacted", before: null, after: null },
    ]);
    expect(JSON.stringify(s)).not.toContain("bí mật");
    expect(JSON.stringify(s)).not.toContain("secret_col");
  });

  it("tạo task: bỏ tên, mô tả, trường trống; tên lưu ở stored_name", () => {
    const s = sanitizeRow(
      row({
        action: "create",
        changes: {
          before: null,
          after: {
            id: TASK,
            project_id: P,
            title: "Thiết kế Kanban",
            description: "dài",
            assignee_id: U,
            priority: "high",
            due_date: null,
            parent_id: PARENT,
            created_by: ACTOR,
            depth: 2,
          },
        },
      }),
    )!;
    expect(s.stored_name).toBe("Thiết kế Kanban");
    expect(s.changes.map((c) => c.field)).toEqual([
      "assignee_id",
      "priority",
      "parent_id",
    ]);
    expect(s.changes.every((c) => c.before === null)).toBe(true);
  });

  it("xóa task: không có chi tiết, tên lấy từ before", () => {
    const s = sanitizeRow(
      row({
        action: "delete",
        changes: { before: { title: "Task cũ", status_id: S1 }, after: null },
      }),
    )!;
    expect(s.changes).toEqual([]);
    expect(s.stored_name).toBe("Task cũ");
  });

  it("giá trị sai kiểu thành null, uuid về chữ thường", () => {
    const s = sanitizeRow(
      row({
        changes: {
          before: {
            priority: "medium",
            due_date: "17/11/2026",
            assignee_id: 7,
          },
          after: {
            priority: "<script>",
            due_date: "2026-11-20",
            assignee_id: U.toUpperCase(),
          },
        },
      }),
    )!;
    expect(s.changes).toEqual([
      { field: "assignee_id", kind: "person", before: null, after: U },
      { field: "priority", kind: "priority", before: "medium", after: null },
      { field: "due_date", kind: "date", before: null, after: "2026-11-20" },
    ]);
  });

  it("thành viên dự án: chỉ vai trò; dự án: bỏ created_by", () => {
    const m = sanitizeRow(
      row({
        entity_type: "project_member",
        entity_id: U,
        changes: {
          before: { role: "member" },
          after: { role: "pm" },
        },
      }),
    )!;
    expect(m.changes).toEqual([
      { field: "role", kind: "role", before: "member", after: "pm" },
    ]);
    const p = sanitizeRow(
      row({
        entity_type: "project",
        entity_id: P,
        action: "create",
        changes: {
          before: null,
          after: { name: "Dự án B", status: "active", created_by: ACTOR },
        },
      }),
    )!;
    expect(p.stored_name).toBe("Dự án B");
    expect(p.changes.map((c) => c.field)).toEqual(["status"]);
  });

  it("loại hoặc hành động lạ: bỏ qua dòng", () => {
    expect(sanitizeRow(row({ entity_type: "label" }))).toBeNull();
    expect(sanitizeRow(row({ action: "truncate" }))).toBeNull();
  });

  it("actor null (hệ thống) giữ null", () => {
    expect(sanitizeRow(row({ actor_id: null }))!.actor_id).toBeNull();
  });
});

describe("toEntry: ghép tên, đối tượng đã xóa để null", () => {
  it("tra người, trạng thái; trạng thái đã xóa và người đã xóa thì name null", () => {
    const s = sanitizeRow(
      row({
        changes: {
          before: { status_id: S1, assignee_id: null },
          after: { status_id: S2, assignee_id: U },
        },
      }),
    )!;
    expect([...collectRefIds([s]).people].sort()).toEqual([ACTOR, U].sort());
    const e = toEntry(
      s,
      names({
        people: new Map([[ACTOR, { full_name: "Minh Anh", email: null }]]),
        statuses: new Map([[S1, "Cần làm"]]),
        tasks: new Map([[TASK, "Tên hiện tại"]]),
      }),
    );
    expect(e.actor).toEqual({ id: ACTOR, full_name: "Minh Anh", email: null });
    expect(e.entity_name).toBe("Tên hiện tại");
    expect(e.changes).toEqual([
      {
        field: "status_id",
        kind: "status",
        before: { id: S1, name: "Cần làm" },
        after: { id: S2, name: null },
      },
      {
        field: "assignee_id",
        kind: "person",
        before: null,
        after: { id: U, full_name: null, email: null },
      },
    ]);
  });

  it("đổi tên task: entity_name là tên lúc đó, không phải tên hiện tại", () => {
    const s = sanitizeRow(
      row({
        changes: { before: { title: "Cũ" }, after: { title: "Mới" } },
      }),
    )!;
    expect(
      toEntry(s, names({ tasks: new Map([[TASK, "Hiện tại"]]) })).entity_name,
    ).toBe("Mới");
  });

  it("thành viên: entity_name là họ tên; dự án không lưu tên thì dùng tên hiện tại", () => {
    const m = sanitizeRow(
      row({
        entity_type: "project_member",
        entity_id: U,
        action: "delete",
        changes: { before: { role: "viewer" }, after: null },
      }),
    )!;
    expect(
      toEntry(
        m,
        names({
          people: new Map([[U, { full_name: "  Huy  ", email: "h@x" }]]),
        }),
      ).entity_name,
    ).toBe("Huy");
    const p = sanitizeRow(
      row({
        entity_type: "project",
        entity_id: P,
        changes: {
          before: { end_date: null },
          after: { end_date: "2026-12-01" },
        },
      }),
    )!;
    expect(toEntry(p, names()).entity_name).toBe("Dự án A");
  });
});
