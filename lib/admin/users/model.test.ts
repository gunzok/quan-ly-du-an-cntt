import { describe, expect, it } from "vitest";
import { toAdminUser, userStatus, type AdminUserRow } from "./model";

const row: AdminUserRow = {
  id: "u1",
  full_name: "Lê An",
  email: "an@example.com",
  department_id: "d1",
  department_name: "Kiểm thử",
  is_admin: false,
  is_active: true,
  project_count: 3,
  pm_project_count: 1,
  last_sign_in_at: null,
  invited_at: null,
  email_confirmed_at: null,
  created_at: "2026-11-13T00:00:00Z",
  sort_key: "lê an",
};

describe("userStatus", () => {
  it("khóa > chờ nhận lời mời > hoạt động", () => {
    expect(userStatus({ ...row, is_active: false, invited_at: "x" })).toBe(
      "locked",
    );
    expect(userStatus({ ...row, invited_at: "x" })).toBe("invited");
    expect(userStatus({ ...row, invited_at: "x", last_sign_in_at: "y" })).toBe(
      "active",
    );
    expect(userStatus(row)).toBe("active");
  });
});

describe("toAdminUser", () => {
  it("gom phòng ban, bỏ cột nội bộ (sort_key, email_confirmed_at)", () => {
    const user = toAdminUser(row);
    expect(user.department).toEqual({ id: "d1", name: "Kiểm thử" });
    expect(user).not.toHaveProperty("sort_key");
    expect(user).not.toHaveProperty("email_confirmed_at");
    expect(toAdminUser({ ...row, department_id: null }).department).toBeNull();
  });
});
