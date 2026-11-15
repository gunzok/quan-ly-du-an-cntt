import { describe, expect, it } from "vitest";
import { strings } from "@/lib/strings";
import { compareSavedViews } from "./model";
import {
  canCreateView,
  canEditView,
  canManagePublicViews,
  canSetVisibility,
  editForbidden,
  mapViewWriteError,
} from "./policy";

type Role = "pm" | "member" | "viewer" | null;
const actor = (role: Role, isAdmin = false, userId = "me") => ({
  userId,
  isAdmin,
  role,
});
const view = (
  visibility: "private" | "public",
  owner_id: string | null = "me",
  is_default = false,
) => ({ visibility, owner_id, is_default });

describe("canCreateView", () => {
  it("riêng tư: mọi vai trò trong dự án và Admin", () => {
    for (const role of ["pm", "member", "viewer"] as const) {
      expect(canCreateView(actor(role), "private")).toBe(true);
    }
    expect(canCreateView(actor(null, true), "private")).toBe(true);
    expect(canCreateView(actor(null), "private")).toBe(false);
  });

  it("công khai: chỉ PM của dự án và Admin", () => {
    expect(canCreateView(actor("pm"), "public")).toBe(true);
    expect(canCreateView(actor(null, true), "public")).toBe(true);
    expect(canCreateView(actor("member"), "public")).toBe(false);
    expect(canCreateView(actor("viewer"), "public")).toBe(false);
    expect(canManagePublicViews(actor(null))).toBe(false);
  });
});

describe("canEditView", () => {
  it("riêng tư: chỉ chủ sở hữu còn thuộc dự án (Admin không sửa của người khác)", () => {
    expect(canEditView(actor("viewer"), view("private"))).toBe(true);
    expect(canEditView(actor(null), view("private"))).toBe(false);
    expect(canEditView(actor("pm"), view("private", "other"))).toBe(false);
    expect(canEditView(actor(null, true), view("private", "other"))).toBe(
      false,
    );
  });

  it("công khai: PM của dự án và Admin, kể cả của người khác", () => {
    expect(canEditView(actor("pm"), view("public", "other"))).toBe(true);
    expect(canEditView(actor(null, true), view("public", "other"))).toBe(true);
    expect(canEditView(actor("member"), view("public"))).toBe(false);
  });

  it("mặc định: không ai sửa được", () => {
    expect(canEditView(actor(null, true), view("public", null, true))).toBe(
      false,
    );
    expect(canEditView(actor("pm"), view("public", null, true))).toBe(false);
  });
});

describe("canSetVisibility", () => {
  it("về riêng tư chỉ chủ sở hữu; lên công khai chỉ PM/Admin", () => {
    expect(canSetVisibility(actor("pm"), view("public"), "private")).toBe(true);
    expect(
      canSetVisibility(actor("pm"), view("public", "other"), "private"),
    ).toBe(false);
    expect(
      canSetVisibility(actor(null, true), view("public", "other"), "private"),
    ).toBe(false);
    expect(canSetVisibility(actor("member"), view("private"), "public")).toBe(
      false,
    );
    expect(canSetVisibility(actor("pm"), view("private"), "public")).toBe(true);
  });
});

describe("editForbidden", () => {
  it("thông điệp theo lý do", () => {
    const t = strings.savedViews.errors;
    expect(editForbidden(view("public", null, true)).message).toBe(
      t.defaultReadOnly,
    );
    expect(editForbidden(view("public")).message).toBe(t.publicForbidden);
    expect(editForbidden(view("private")).message).toBe(t.forbidden);
  });
});

describe("mapViewWriteError", () => {
  it("ánh xạ lỗi CSDL sang mã API", () => {
    const code = (e: { code?: string; message?: string }) =>
      mapViewWriteError(e)?.code ?? null;
    expect(code({ code: "23505" })).toBe("conflict");
    expect(code({ code: "23514" })).toBe("validation_failed");
    expect(code({ code: "42501" })).toBe("forbidden");
    expect(
      code({ code: "P0001", message: "saved_view_identity_immutable" }),
    ).toBe("forbidden");
    expect(code({ code: "P0001", message: "khác" })).toBeNull();
    expect(code({ code: "XX000" })).toBeNull();
  });
});

describe("compareSavedViews", () => {
  it("mặc định trước, rồi theo tên tiếng Việt", () => {
    const items = [
      { id: "3", name: "Đang làm", is_default: false },
      { id: "2", name: "Ân", is_default: false },
      { id: "1", name: "Zeta", is_default: true },
    ];
    expect(items.sort(compareSavedViews).map((v) => v.id)).toEqual([
      "1",
      "2",
      "3",
    ]);
  });
});
