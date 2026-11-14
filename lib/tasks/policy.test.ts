import { describe, expect, it } from "vitest";
import { strings } from "@/lib/strings";
import {
  canCreateTask,
  canDeleteTask,
  canEditTask,
  mapTaskWriteError,
  type Actor,
} from "./policy";

const ME = "00000000-0000-0000-0000-0000000000c1";
const OTHER = "00000000-0000-0000-0000-0000000000b1";

const actor = (role: Actor["role"], isAdmin = false): Actor => ({
  userId: ME,
  isAdmin,
  role,
});

const createdByMe = { created_by: ME, assignee_id: null };
const assignedToMe = { created_by: OTHER, assignee_id: ME };
const notMine = { created_by: OTHER, assignee_id: OTHER };

describe("canCreateTask", () => {
  it("Admin, PM, Thành viên được tạo", () => {
    expect(canCreateTask(actor(null, true))).toBe(true);
    expect(canCreateTask(actor("pm"))).toBe(true);
    expect(canCreateTask(actor("member"))).toBe(true);
  });
  it("Người xem và người ngoài không (BR-02)", () => {
    expect(canCreateTask(actor("viewer"))).toBe(false);
    expect(canCreateTask(actor(null))).toBe(false);
  });
});

describe("canEditTask (BR-03)", () => {
  it("PM và Admin sửa mọi task", () => {
    for (const t of [createdByMe, assignedToMe, notMine]) {
      expect(canEditTask(actor("pm"), t)).toBe(true);
      expect(canEditTask(actor(null, true), t)).toBe(true);
    }
  });
  it("Thành viên sửa task mình tạo hoặc phụ trách", () => {
    expect(canEditTask(actor("member"), createdByMe)).toBe(true);
    expect(canEditTask(actor("member"), assignedToMe)).toBe(true);
  });
  it("Thành viên không sửa task của người khác", () => {
    expect(canEditTask(actor("member"), notMine)).toBe(false);
  });
  it("Người xem và người ngoài không sửa, kể cả task mình tạo trước đó", () => {
    expect(canEditTask(actor("viewer"), createdByMe)).toBe(false);
    expect(canEditTask(actor(null), assignedToMe)).toBe(false);
  });
});

describe("canDeleteTask", () => {
  it("PM và Admin xóa mọi task", () => {
    expect(canDeleteTask(actor("pm"), notMine)).toBe(true);
    expect(canDeleteTask(actor(null, true), notMine)).toBe(true);
  });
  it("Thành viên chỉ xóa task mình tạo", () => {
    expect(canDeleteTask(actor("member"), createdByMe)).toBe(true);
    expect(canDeleteTask(actor("member"), assignedToMe)).toBe(false);
    expect(canDeleteTask(actor("member"), notMine)).toBe(false);
  });
  it("Người xem và người ngoài không xóa", () => {
    expect(canDeleteTask(actor("viewer"), createdByMe)).toBe(false);
    expect(canDeleteTask(actor(null), createdByMe)).toBe(false);
  });
});

describe("mapTaskWriteError", () => {
  it("người được giao không thuộc dự án: 422", () => {
    expect(
      mapTaskWriteError({ code: "P0001", message: "assignee_not_member" }),
    ).toEqual({
      code: "business_rule_violated",
      message: strings.tasks.errors.assigneeNotMember,
      details: [{ field: "assignee_id", issue: "invalid_value" }],
    });
  });
  it("vi phạm BR-13 ở CSDL: 422", () => {
    expect(
      mapTaskWriteError({
        code: "23514",
        message:
          'new row for relation "tasks" violates check constraint "tasks_dates_check"',
      }),
    ).toMatchObject({
      code: "business_rule_violated",
      message: strings.tasks.errors.dateOrder,
    });
  });
  it("ràng buộc khác: 400; RLS: 403; lỗi lạ: null (500)", () => {
    expect(
      mapTaskWriteError({ code: "23514", message: "tasks_title_length" }),
    ).toMatchObject({ code: "validation_failed" });
    expect(mapTaskWriteError({ code: "42501" })).toMatchObject({
      code: "forbidden",
    });
    expect(mapTaskWriteError({ code: "P0001", message: "khac" })).toBeNull();
    expect(mapTaskWriteError({ code: "08006" })).toBeNull();
  });
});
