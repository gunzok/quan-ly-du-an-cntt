import { describe, expect, it } from "vitest";
import {
  canChoosePublic,
  canSaveViews,
  checkViewName,
  classifyWriteError,
  removeView,
  suggestCopyName,
  upsertView,
  viewActions,
  type ManageActor,
} from "./manage";
import type { SavedView } from "./model";

const ME = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

function view(over: Partial<SavedView> = {}): SavedView {
  return {
    id: "33333333-3333-4333-8333-333333333333",
    project_id: "44444444-4444-4444-8444-444444444444",
    owner_id: ME,
    name: "Của tôi",
    query: {
      version: 1,
      filters: {},
      sort: [],
      group_by: null,
      columns: ["title"],
      display: "list",
    },
    visibility: "private",
    is_default: false,
    is_favorite: false,
    can_edit: true,
    created_at: "2026-11-01T00:00:00Z",
    updated_at: "2026-11-01T00:00:00Z",
    ...over,
  };
}

const actor = (role: ManageActor["role"], isAdmin = false): ManageActor => ({
  userId: ME,
  isAdmin,
  role,
});

describe("canChoosePublic / canSaveViews (ma trận E13-1)", () => {
  it("công khai chỉ PM và Admin; riêng tư mọi vai trò kể cả Người xem", () => {
    expect(canChoosePublic(actor("pm"))).toBe(true);
    expect(canChoosePublic(actor(null, true))).toBe(true);
    expect(canChoosePublic(actor("member"))).toBe(false);
    expect(canChoosePublic(actor("viewer"))).toBe(false);
    expect(canSaveViews(actor("viewer"))).toBe(true);
    expect(canSaveViews(actor("member"))).toBe(true);
    expect(canSaveViews(actor(null, true))).toBe(true);
    expect(canSaveViews(actor(null))).toBe(false);
  });
});

describe("viewActions", () => {
  it("chế độ xem riêng của tôi: sửa, xóa; PM được công khai, Thành viên/Người xem thì không", () => {
    expect(viewActions(view(), actor("pm"))).toEqual({
      canEdit: true,
      canPublish: true,
      canPrivatize: false,
      readOnlyReason: null,
    });
    for (const role of ["member", "viewer"] as const) {
      expect(viewActions(view(), actor(role))).toEqual({
        canEdit: true,
        canPublish: false,
        canPrivatize: false,
        readOnlyReason: null,
      });
    }
  });

  it("chế độ xem công khai: chỉ chủ sở hữu được chuyển về riêng tư", () => {
    const mine = view({ visibility: "public" });
    expect(viewActions(mine, actor("pm")).canPrivatize).toBe(true);
    const others = view({ visibility: "public", owner_id: OTHER });
    const a = viewActions(others, actor("pm"));
    expect(a.canEdit).toBe(true);
    expect(a.canPrivatize).toBe(false);
    expect(a.canPublish).toBe(false);
  });

  it("AC2: Thành viên với chế độ xem công khai của PM: chỉ đọc, lý do 'public'", () => {
    const pmView = view({
      visibility: "public",
      owner_id: OTHER,
      can_edit: false,
    });
    expect(viewActions(pmView, actor("member"))).toEqual({
      canEdit: false,
      canPublish: false,
      canPrivatize: false,
      readOnlyReason: "public",
    });
  });

  it("mặc định: chỉ đọc với mọi người, kể cả khi can_edit lệch", () => {
    const d = view({ is_default: true, owner_id: null, can_edit: true });
    expect(viewActions(d, actor(null, true))).toEqual({
      canEdit: false,
      canPublish: false,
      canPrivatize: false,
      readOnlyReason: "default",
    });
  });

  it("riêng tư không sửa được (bất thường): lý do 'other'", () => {
    expect(
      viewActions(view({ can_edit: false }), actor("member")).readOnlyReason,
    ).toBe("other");
  });
});

describe("checkViewName", () => {
  it("cắt hai đầu, gộp khoảng trắng; rỗng là required; quá 100 ký tự là too_long", () => {
    expect(checkViewName("  Việc   của tôi ")).toEqual({
      name: "Việc của tôi",
      problem: null,
    });
    expect(checkViewName("   ").problem).toBe("required");
    expect(checkViewName("a".repeat(100)).problem).toBeNull();
    expect(checkViewName("a".repeat(101)).problem).toBe("too_long");
  });
});

describe("classifyWriteError", () => {
  it("ánh xạ mã lỗi API", () => {
    const e = (code: Parameters<typeof classifyWriteError>[0]["code"]) =>
      classifyWriteError({ code, message: "x" });
    expect(e("conflict")).toBe("name_conflict");
    expect(e("not_found")).toBe("not_found");
    expect(e("forbidden")).toBe("forbidden");
    expect(e("validation_failed")).toBe("invalid");
    expect(e("internal_error")).toBe("other");
    expect(e("rate_limited")).toBe("other");
  });
});

describe("upsertView / removeView / suggestCopyName", () => {
  it("thay theo id, thêm khi chưa có, xóa theo id", () => {
    const a = view();
    const b = view({ id: "55555555-5555-4555-8555-555555555555", name: "B" });
    expect(upsertView([a], b)).toEqual([a, b]);
    const renamed = { ...a, name: "Mới" };
    expect(upsertView([a, b], renamed)).toEqual([renamed, b]);
    expect(removeView([a, b], a.id)).toEqual([b]);
  });

  it("tên bản sao không vượt 100 ký tự", () => {
    expect(suggestCopyName("Quá hạn", "(bản sao)")).toBe("Quá hạn (bản sao)");
    const long = suggestCopyName("x".repeat(100), "(bản sao)");
    expect(long.length).toBeLessThanOrEqual(100);
  });
});
