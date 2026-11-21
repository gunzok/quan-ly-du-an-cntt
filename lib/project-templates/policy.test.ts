import { describe, expect, it } from "vitest";
import { toProjectTemplate, type ProjectTemplateRow } from "./model";
import {
  canManageTemplate,
  canSaveTemplate,
  decideTemplateGate,
  mapCreateFromTemplateError,
  mapTemplateWriteError,
} from "./policy";

const user = { id: "u1" };
const active = { is_admin: false, is_active: true };

describe("decideTemplateGate", () => {
  it("401 khi chưa đăng nhập", () => {
    expect(decideTemplateGate(null, null, false)).toMatchObject({
      ok: false,
      error: { code: "unauthenticated" },
    });
  });

  it("Admin hoặc PM ở ≥ 1 dự án đang hoạt động được đọc", () => {
    expect(
      decideTemplateGate(user, { is_admin: true, is_active: true }, false),
    ).toEqual({ ok: true, userId: "u1", isAdmin: true });
    expect(decideTemplateGate(user, active, true)).toEqual({
      ok: true,
      userId: "u1",
      isAdmin: false,
    });
  });

  it("Thành viên, Người xem (không là PM ở đâu), người bị khóa: 403", () => {
    for (const [profile, pm] of [
      [active, false],
      [{ is_admin: true, is_active: false }, true],
      [null, true],
    ] as const) {
      expect(decideTemplateGate(user, profile, pm)).toMatchObject({
        ok: false,
        error: { code: "forbidden" },
      });
    }
  });
});

describe("canManageTemplate / canSaveTemplate", () => {
  it("chỉ người lưu hoặc Admin quản lý", () => {
    expect(canManageTemplate({ userId: "u1", isAdmin: false }, "u1")).toBe(
      true,
    );
    expect(canManageTemplate({ userId: "u1", isAdmin: false }, "u2")).toBe(
      false,
    );
    expect(canManageTemplate({ userId: "u1", isAdmin: false }, null)).toBe(
      false,
    );
    expect(canManageTemplate({ userId: "u1", isAdmin: true }, null)).toBe(true);
  });

  it("chỉ PM của dự án hoặc Admin đang hoạt động được lưu", () => {
    expect(
      canSaveTemplate({ isAdmin: false, isActive: true, role: "pm" }),
    ).toBe(true);
    expect(canSaveTemplate({ isAdmin: true, isActive: true, role: null })).toBe(
      true,
    );
    for (const role of ["member", "viewer", null]) {
      expect(canSaveTemplate({ isAdmin: false, isActive: true, role })).toBe(
        false,
      );
    }
    expect(
      canSaveTemplate({ isAdmin: false, isActive: false, role: "pm" }),
    ).toBe(false);
  });
});

describe("ánh xạ lỗi", () => {
  it("lưu / đổi tên", () => {
    expect(mapTemplateWriteError({ code: "23505" })?.code).toBe("conflict");
    expect(
      mapTemplateWriteError({
        code: "P0001",
        message: "template_too_many_tasks",
      })?.code,
    ).toBe("business_rule_violated");
    expect(
      mapTemplateWriteError({ code: "P0001", message: "template_too_large" })
        ?.code,
    ).toBe("business_rule_violated");
    expect(
      mapTemplateWriteError({ code: "P0001", message: "khác" }),
    ).toBeNull();
    expect(mapTemplateWriteError({ code: "P0002" })?.code).toBe("not_found");
    expect(mapTemplateWriteError({ code: "42501" })?.code).toBe("forbidden");
    expect(mapTemplateWriteError({ code: "XX000" })).toBeNull();
  });

  it("tạo dự án từ template: 422 trên template_id", () => {
    for (const [code, message] of [
      ["P0002", "template_not_found"],
      ["P0001", "template_invalid"],
    ]) {
      expect(mapCreateFromTemplateError({ code, message })).toMatchObject({
        code: "business_rule_violated",
        details: [{ field: "template_id", issue: "invalid_value" }],
      });
    }
    expect(mapCreateFromTemplateError({ code: "42501" })).toBeNull();
  });
});

describe("toProjectTemplate", () => {
  const row: ProjectTemplateRow = {
    id: "t1",
    name: "Mẫu",
    status_count: 7,
    task_type_count: 4,
    label_count: 2,
    task_count: 24,
    created_by: "u1",
    created_at: "2026-11-21T00:00:00Z",
    updated_at: "2026-11-21T00:00:00Z",
    archived_at: null,
    creator: { id: "u1", full_name: " ", email: "pm@example.com" },
  };

  it("tóm tắt, người lưu (họ tên trống thì email), quyền quản lý", () => {
    expect(toProjectTemplate(row, { userId: "u1", isAdmin: false })).toEqual({
      id: "t1",
      name: "Mẫu",
      summary: { statuses: 7, task_types: 4, labels: 2, tasks: 24 },
      created_by: { id: "u1", name: "pm@example.com" },
      created_at: row.created_at,
      updated_at: row.updated_at,
      archived: false,
      archived_at: null,
      can_manage: true,
    });
    expect(
      toProjectTemplate(
        { ...row, archived_at: "2026-11-22T00:00:00Z", creator: null },
        { userId: "u2", isAdmin: false },
      ),
    ).toMatchObject({ archived: true, created_by: null, can_manage: false });
  });
});
