import { describe, expect, it } from "vitest";
import { strings } from "@/lib/strings";
import { compareDepartments, toDepartment } from "./model";
import { decideActiveUserGate, mapDepartmentWriteError } from "./policy";

describe("decideActiveUserGate", () => {
  it("chưa đăng nhập: 401; hồ sơ không đọc được hoặc bị khóa: 403", () => {
    expect(decideActiveUserGate(null, null)).toMatchObject({
      ok: false,
      error: { code: "unauthenticated" },
    });
    expect(decideActiveUserGate({ id: "u" }, null)).toMatchObject({
      ok: false,
      error: { code: "forbidden" },
    });
    expect(
      decideActiveUserGate({ id: "u" }, { is_active: false }),
    ).toMatchObject({ ok: false, error: { code: "forbidden" } });
  });

  it("người dùng đang hoạt động (không cần là Admin): cho qua", () => {
    expect(decideActiveUserGate({ id: "u" }, { is_active: true })).toEqual({
      ok: true,
      userId: "u",
    });
  });
});

describe("mapDepartmentWriteError", () => {
  it("trùng tên: 409 kèm trường name", () => {
    expect(mapDepartmentWriteError({ code: "23505" })).toEqual({
      code: "conflict",
      message: strings.departments.errors.nameExists,
      details: [{ field: "name", issue: "invalid_value" }],
    });
  });

  it("RLS từ chối: 403; CHECK: 400; lỗi khác: null", () => {
    expect(mapDepartmentWriteError({ code: "42501" })).toMatchObject({
      code: "forbidden",
    });
    expect(mapDepartmentWriteError({ code: "23514" })).toMatchObject({
      code: "validation_failed",
    });
    expect(mapDepartmentWriteError({ code: "XX000" })).toBeNull();
    expect(mapDepartmentWriteError({})).toBeNull();
  });
});

describe("model", () => {
  const row = (name: string, position: number, archived = false) =>
    toDepartment({
      id: name,
      name,
      position,
      archived_at: archived ? "2026-11-14T00:00:00Z" : null,
    });

  it("toDepartment suy ra archived từ archived_at", () => {
    expect(row("A", 1).archived).toBe(false);
    expect(row("A", 1, true)).toMatchObject({
      archived: true,
      archived_at: "2026-11-14T00:00:00Z",
    });
  });

  it("sắp xếp: đang dùng trước, rồi position, rồi tên tiếng Việt", () => {
    const sorted = [
      row("Z lưu trữ", 0, true),
      row("Đào tạo", 2),
      row("Bảo vệ", 2),
      row("Kế toán", 1),
    ].sort(compareDepartments);
    expect(sorted.map((d) => d.name)).toEqual([
      "Kế toán",
      "Bảo vệ",
      "Đào tạo",
      "Z lưu trữ",
    ]);
  });
});
