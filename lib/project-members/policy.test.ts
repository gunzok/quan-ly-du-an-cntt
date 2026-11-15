import { describe, expect, it } from "vitest";
import {
  canManageMembers,
  canSearchUsers,
  mapMemberWriteError,
} from "./policy";

const actor = (role: "pm" | "member" | "viewer" | null, isAdmin = false) => ({
  userId: "u",
  isAdmin,
  role,
});

describe("canManageMembers", () => {
  it("AC2: chỉ PM của dự án và Admin ghi", () => {
    expect(canManageMembers(actor("pm"))).toBe(true);
    expect(canManageMembers(actor(null, true))).toBe(true);
    expect(canManageMembers(actor("member"))).toBe(false);
    expect(canManageMembers(actor("viewer"))).toBe(false);
    expect(canManageMembers(actor(null))).toBe(false);
  });
});

describe("canSearchUsers", () => {
  it("Admin hoặc PM ở ít nhất một dự án", () => {
    expect(canSearchUsers({ isAdmin: true, isPmSomewhere: false })).toBe(true);
    expect(canSearchUsers({ isAdmin: false, isPmSomewhere: true })).toBe(true);
    expect(canSearchUsers({ isAdmin: false, isPmSomewhere: false })).toBe(
      false,
    );
  });
});

describe("mapMemberWriteError", () => {
  const code = (e: { code?: string; message?: string }) =>
    mapMemberWriteError(e)?.code ?? null;
  it("ánh xạ lỗi CSDL sang mã API", () => {
    expect(code({ code: "P0001", message: "last_project_pm" })).toBe(
      "conflict",
    );
    expect(code({ code: "P0001", message: "member_user_inactive" })).toBe(
      "business_rule_violated",
    );
    expect(code({ code: "42501", message: "member_forbidden" })).toBe(
      "forbidden",
    );
    expect(code({ code: "23503" })).toBe("business_rule_violated");
  });
  it("lỗi khác: null (nơi gọi trả 500)", () => {
    expect(code({ code: "P0001", message: "khac" })).toBeNull();
    expect(code({ code: "XX000" })).toBeNull();
    expect(code({})).toBeNull();
  });
  it("PM cuối cùng chỉ vào trường role, người bị khóa chỉ vào user_id", () => {
    expect(
      mapMemberWriteError({ code: "P0001", message: "last_project_pm" })
        ?.details,
    ).toEqual([{ field: "role", issue: "invalid_value" }]);
    expect(
      mapMemberWriteError({ code: "P0001", message: "member_user_inactive" })
        ?.details,
    ).toEqual([{ field: "user_id", issue: "invalid_value" }]);
  });
});
