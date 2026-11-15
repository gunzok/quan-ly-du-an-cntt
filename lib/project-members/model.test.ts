import { describe, expect, it } from "vitest";
import {
  activePmCount,
  compareMembers,
  displayName,
  toProjectMember,
  toUserCandidate,
  type ProjectMember,
} from "./model";

const member = (
  user_id: string,
  role: ProjectMember["role"],
  full_name: string,
  is_active = true,
): ProjectMember => ({
  user_id,
  role,
  joined_at: "2026-11-15T00:00:00Z",
  user: { id: user_id, full_name, email: null, is_active, department: null },
});

describe("compareMembers", () => {
  it("PM trước, rồi Thành viên, Người xem; cùng vai trò theo tên tiếng Việt", () => {
    const sorted = [
      member("1", "viewer", "An"),
      member("2", "member", "Đức"),
      member("3", "pm", "Bình"),
      member("4", "member", "Châu"),
    ].sort(compareMembers);
    expect(sorted.map((m) => m.user_id)).toEqual(["3", "4", "2", "1"]);
  });
});

describe("activePmCount", () => {
  it("không tính PM bị khóa", () => {
    expect(
      activePmCount([
        member("1", "pm", "A"),
        member("2", "pm", "B", false),
        member("3", "member", "C"),
      ]),
    ).toBe(1);
  });
});

describe("toProjectMember, toUserCandidate, displayName", () => {
  it("đổi dòng PostgREST sang dạng API; hồ sơ trống thì mặc định an toàn", () => {
    expect(
      toProjectMember({
        user_id: "u",
        role: "pm",
        joined_at: "t",
        profile: {
          id: "u",
          full_name: "A",
          email: "a@x.vn",
          is_active: true,
          department: { id: "d", name: "Phòng" },
        },
      }),
    ).toEqual({
      user_id: "u",
      role: "pm",
      joined_at: "t",
      user: {
        id: "u",
        full_name: "A",
        email: "a@x.vn",
        is_active: true,
        department: { id: "d", name: "Phòng" },
      },
    });
    expect(
      toProjectMember({
        user_id: "u",
        role: "viewer",
        joined_at: "t",
        profile: null,
      }).user,
    ).toEqual({
      id: "u",
      full_name: "",
      email: null,
      is_active: false,
      department: null,
    });
    expect(
      toUserCandidate({
        id: "u",
        full_name: null,
        email: "b@x.vn",
        department_id: null,
        department_name: null,
      }),
    ).toEqual({ id: "u", full_name: "", email: "b@x.vn", department: null });
    expect(displayName({ full_name: "  ", email: "b@x.vn" })).toBe("b@x.vn");
  });
});
