import { describe, expect, it } from "vitest";
import {
  canCreateProject,
  canDeleteProject,
  canEditProject,
  mapProjectWriteError,
  type ProjectActor,
} from "./policy";

const actor = (over: Partial<ProjectActor>): ProjectActor => ({
  userId: "u",
  isAdmin: false,
  role: null,
  ...over,
});

describe("quyền dự án (database.md mục 5)", () => {
  it("tạo: Admin hoặc PM ở ít nhất một dự án", () => {
    expect(canCreateProject({ isAdmin: true, isPmAnywhere: false })).toBe(true);
    expect(canCreateProject({ isAdmin: false, isPmAnywhere: true })).toBe(true);
    expect(canCreateProject({ isAdmin: false, isPmAnywhere: false })).toBe(
      false,
    );
  });

  it("sửa, lưu trữ: Admin, PM của dự án; Thành viên, Người xem, người ngoài không", () => {
    expect(canEditProject(actor({ isAdmin: true }))).toBe(true);
    expect(canEditProject(actor({ role: "pm" }))).toBe(true);
    expect(canEditProject(actor({ role: "member" }))).toBe(false);
    expect(canEditProject(actor({ role: "viewer" }))).toBe(false);
    expect(canEditProject(actor({}))).toBe(false);
  });

  it("xóa vĩnh viễn: chỉ Admin, PM không (sếp chốt 2026-11-13)", () => {
    expect(canDeleteProject(actor({ isAdmin: true }))).toBe(true);
    expect(canDeleteProject(actor({ isAdmin: true, role: "viewer" }))).toBe(
      true,
    );
    expect(canDeleteProject(actor({ role: "pm" }))).toBe(false);
  });
});

describe("mapProjectWriteError", () => {
  it("ràng buộc ngày → 422, ràng buộc khác → 400, RLS → 403, còn lại null", () => {
    expect(
      mapProjectWriteError({
        code: "23514",
        message: 'new row violates check constraint "projects_dates_check"',
      }),
    ).toMatchObject({ code: "business_rule_violated" });
    expect(
      mapProjectWriteError({
        code: "23514",
        message: "projects_name_not_blank",
      }),
    ).toMatchObject({ code: "validation_failed" });
    expect(mapProjectWriteError({ code: "42501" })).toMatchObject({
      code: "forbidden",
    });
    expect(mapProjectWriteError({ code: "08006" })).toBeNull();
  });
});
