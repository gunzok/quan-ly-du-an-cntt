import { describe, expect, it } from "vitest";
import type { ProjectMember } from "@/lib/project-members/model";
import type { TaskRelationView } from "@/lib/task-relations/model";
import type { TaskDetail } from "./detail";
import {
  assigneeOptions,
  canEditField,
  isNoop,
  isOverdue,
  normalizeDescription,
  openBlockers,
  readOnlyReason,
  subtaskProgress,
  todayIso,
  undoPatch,
} from "./detail-view";

const perms = (over: Partial<TaskDetail["permissions"]> = {}) => ({
  can_edit: true,
  can_delete: true,
  can_reassign: true,
  can_add_subtask: true,
  ...over,
});

const task = {
  id: "t",
  title: "Cũ",
  description: null,
  priority: "medium",
  start_date: "2026-11-01",
  due_date: null,
  assignee_id: "u1",
  label_ids: ["l2", "l1"],
  updated_at: "2026-11-01T00:00:00Z",
} as unknown as TaskDetail;

describe("todayIso, isOverdue", () => {
  it("ngày theo giờ Việt Nam", () => {
    // 2026-11-15 18:00 UTC = 2026-11-16 01:00 giờ VN.
    expect(todayIso(new Date("2026-11-15T18:00:00Z"))).toBe("2026-11-16");
  });
  it("trễ khi hạn trước hôm nay và chưa xong", () => {
    expect(isOverdue("2026-11-15", null, "2026-11-16")).toBe(true);
    expect(isOverdue("2026-11-16", null, "2026-11-16")).toBe(false);
    expect(isOverdue("2026-11-15", "2026-11-15T10:00:00Z", "2026-11-16")).toBe(
      false,
    );
    expect(isOverdue(null, null, "2026-11-16")).toBe(false);
  });
});

describe("readOnlyReason, canEditField", () => {
  it("sửa được: không lý do", () => {
    expect(readOnlyReason("member", false, { can_edit: true })).toBeNull();
  });
  it("Thành viên không chủ task: notOwner; Người xem: viewer", () => {
    expect(readOnlyReason("member", false, { can_edit: false })).toBe(
      "notOwner",
    );
    expect(readOnlyReason("viewer", false, { can_edit: false })).toBe("viewer");
  });
  it("người phụ trách chỉ khóa ô người phụ trách khi không giao đi được", () => {
    const p = perms({ can_reassign: false });
    expect(canEditField("assignee_id", p)).toBe(false);
    expect(canEditField("title", p)).toBe(true);
    expect(canEditField("title", perms({ can_edit: false }))).toBe(false);
  });
});

describe("assigneeOptions", () => {
  const m = (
    id: string,
    role: ProjectMember["role"],
    name: string,
    is_active = true,
  ): ProjectMember => ({
    user_id: id,
    role,
    joined_at: "",
    user: { id, full_name: name, email: null, is_active, department: null },
  });
  const members = [
    m("v", "viewer", "Vy"),
    m("b", "member", "Bình"),
    m("a", "pm", "An"),
    m("k", "member", "Khóa", false),
  ];
  it("chỉ PM, Thành viên đang hoạt động; sắp theo tên", () => {
    expect(
      assigneeOptions(members, null, (u) => u.full_name).map((o) => o.id),
    ).toEqual(["a", "b"]);
  });
  it("người đang phụ trách không hợp lệ vẫn hiện, đánh dấu không giao được", () => {
    const opts = assigneeOptions(members, "k", (u) => u.full_name);
    expect(opts.find((o) => o.id === "k")).toEqual({
      id: "k",
      name: "Khóa",
      assignable: false,
    });
  });
});

describe("subtaskProgress, openBlockers", () => {
  it("đếm việc con đã xong", () => {
    const s = (done: boolean) =>
      ({ completed_at: done ? "x" : null }) as TaskDetail["subtasks"][number];
    expect(subtaskProgress([s(true), s(false), s(true)])).toEqual({
      done: 2,
      total: 3,
    });
  });
  it("chỉ quan hệ bị chặn bởi task chưa xong (trạng thái lạ coi là chưa xong)", () => {
    const r = (relation: string, status_id: string | null) =>
      ({
        relation,
        task: { id: status_id, title: "", status_id },
      }) as unknown as TaskRelationView;
    const cat = (id: string | null) =>
      id === "done"
        ? ("done" as const)
        : id === "todo"
          ? ("todo" as const)
          : undefined;
    const out = openBlockers(
      [
        r("blocked_by", "done"),
        r("blocked_by", "todo"),
        r("blocks", "todo"),
        r("blocked_by", "?"),
      ],
      cat,
    );
    expect(out.map((x) => x.task.status_id)).toEqual(["todo", "?"]);
  });
});

describe("undoPatch, isNoop, normalizeDescription", () => {
  it("hoàn tác lấy giá trị cũ, bỏ expected_updated_at", () => {
    expect(
      undoPatch(task, {
        title: "Mới",
        label_ids: ["l3"],
        expected_updated_at: "x",
      }),
    ).toEqual({ title: "Cũ", label_ids: ["l2", "l1"] });
  });
  it("không đổi gì thì noop (nhãn so không theo thứ tự)", () => {
    expect(isNoop(task, { title: "Cũ", label_ids: ["l1", "l2"] })).toBe(true);
    expect(isNoop(task, { title: "Mới" })).toBe(false);
    expect(isNoop(task, { label_ids: ["l1"] })).toBe(false);
  });
  it("mô tả chỉ khoảng trắng thành null, giữ nguyên xuống dòng", () => {
    expect(normalizeDescription("  \n ")).toBeNull();
    expect(normalizeDescription("a\n\nb ")).toBe("a\n\nb ");
  });
});
