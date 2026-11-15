import { describe, expect, it } from "vitest";
import type { Actor } from "@/lib/tasks/policy";
import { canManageRelation, mapRelationWriteError } from "./policy";

const ME = "u-me";
const OTHER = "u-other";
const mine = { created_by: ME, assignee_id: null };
const assigned = { created_by: OTHER, assignee_id: ME };
const theirs = { created_by: OTHER, assignee_id: OTHER };

function actor(over: Partial<Actor>): Actor {
  return { userId: ME, isAdmin: false, role: null, ...over };
}

describe("canManageRelation", () => {
  it("Admin, PM: mọi cặp task", () => {
    for (const a of [actor({ isAdmin: true }), actor({ role: "pm" })]) {
      expect(canManageRelation(a, theirs, theirs)).toBe(true);
    }
  });
  it("Thành viên: chỉ khi sửa được cả hai (tạo hoặc phụ trách)", () => {
    const m = actor({ role: "member" });
    expect(canManageRelation(m, mine, assigned)).toBe(true);
    expect(canManageRelation(m, mine, theirs)).toBe(false);
    expect(canManageRelation(m, theirs, mine)).toBe(false);
  });
  it("Người xem và người ngoài: không", () => {
    expect(canManageRelation(actor({ role: "viewer" }), mine, mine)).toBe(
      false,
    );
    expect(canManageRelation(actor({}), mine, mine)).toBe(false);
  });
});

describe("mapRelationWriteError", () => {
  it("vòng và trùng: 409 conflict", () => {
    expect(
      mapRelationWriteError({ code: "P0001", message: "task_relation_cycle" })
        ?.code,
    ).toBe("conflict");
    expect(mapRelationWriteError({ code: "23505", message: "dup" })?.code).toBe(
      "conflict",
    );
  });
  it("khác dự án, tự quan hệ: 422", () => {
    expect(
      mapRelationWriteError({
        code: "P0001",
        message: "task_relation_cross_project",
      })?.code,
    ).toBe("business_rule_violated");
    expect(
      mapRelationWriteError({
        code: "23514",
        message: 'violates check constraint "task_relations_not_self"',
      })?.code,
    ).toBe("business_rule_violated");
  });
  it("CHECK khác: 400; khóa ngoại: 404; RLS: 403", () => {
    expect(
      mapRelationWriteError({
        code: "23514",
        message: "task_relations_lag_days_kind",
      })?.code,
    ).toBe("validation_failed");
    expect(mapRelationWriteError({ code: "23503" })?.code).toBe("not_found");
    expect(mapRelationWriteError({ code: "42501" })?.code).toBe("forbidden");
  });
  it("lỗi lạ: null (nơi gọi trả 500)", () => {
    expect(mapRelationWriteError({ code: "P0001", message: "x" })).toBeNull();
    expect(mapRelationWriteError({ code: "XX000" })).toBeNull();
  });
});
