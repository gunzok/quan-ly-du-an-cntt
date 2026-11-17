import { describe, expect, it } from "vitest";
import { DEFAULT_VIEWS } from "./defaults";
import { fold, isSameViewState, resolveViewParam, viewSections } from "./menu";
import type { SavedView } from "./model";

const P = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

function view(patch: Partial<SavedView>): SavedView {
  return {
    id: "33333333-3333-4333-8333-333333333333",
    project_id: P,
    owner_id: "u",
    name: "x",
    query: DEFAULT_VIEWS[0].query,
    visibility: "private",
    is_default: false,
    is_favorite: false,
    can_edit: true,
    created_at: "2026-11-01T00:00:00Z",
    updated_at: "2026-11-01T00:00:00Z",
    ...patch,
  };
}

const defaults = DEFAULT_VIEWS.map((d) =>
  view({
    id: d.id,
    project_id: null,
    owner_id: null,
    name: d.name,
    visibility: "public",
    is_default: true,
    can_edit: false,
  }),
);
const shared = view({
  id: "44444444-4444-4444-8444-444444444444",
  name: "Rủi ro trễ",
  visibility: "public",
  is_favorite: true,
});
const mine = view({
  id: "55555555-5555-4555-8555-555555555555",
  name: "Lỗi cần review",
});
const mineB = view({
  id: "66666666-6666-4666-8666-666666666666",
  name: "Đợt 1",
});

describe("viewSections", () => {
  const all = [mine, shared, mineB, ...[...defaults].reverse()];

  it("chia mục; mặc định theo thứ tự OpenProject; còn lại theo tên tiếng Việt", () => {
    const s = viewSections(all, (v) => v.name);
    expect(s.defaults.map((v) => v.name)).toEqual(
      DEFAULT_VIEWS.map((d) => d.name),
    );
    expect(s.shared).toEqual([shared]);
    expect(s.mine.map((v) => v.name)).toEqual(["Đợt 1", "Lỗi cần review"]);
    expect(s.favorites).toEqual([shared]);
  });

  it("yêu thích: mặc định trước, rồi theo tên", () => {
    const favDefault = { ...defaults[3], is_favorite: true };
    const s = viewSections([shared, favDefault], (v) => v.name);
    expect(s.favorites.map((v) => v.id)).toEqual([favDefault.id, shared.id]);
  });

  it("tìm theo tên hiển thị, bỏ dấu, không phân biệt hoa thường", () => {
    const s = viewSections(all, (v) => v.name, "  QUA HAN ");
    expect(s.defaults.map((v) => v.name)).toEqual(["Quá hạn"]);
    expect(s.mine).toEqual([]);
    expect(viewSections(all, (v) => v.name, "dot").mine).toEqual([mineB]);
    // Tìm theo tên đã dịch.
    expect(
      viewSections(all, (v) => (v.is_default ? "Overdue" : v.name), "overdue")
        .defaults,
    ).toHaveLength(7);
  });

  it("fold bỏ dấu và đ", () => {
    expect(fold("Đã Giao Cho Tôi")).toBe("da giao cho toi");
  });
});

describe("resolveViewParam (?view=)", () => {
  const views = [defaults[0], mine, view({ id: OTHER, project_id: OTHER })];

  it("không có tham số", () => {
    expect(resolveViewParam(null, views, P)).toEqual({ kind: "none" });
    expect(resolveViewParam("", views, P)).toEqual({ kind: "none" });
  });

  it("tìm thấy: của dự án hoặc mặc định dùng chung; uuid chữ hoa cũng được", () => {
    expect(resolveViewParam(mine.id.toUpperCase(), views, P)).toEqual({
      kind: "found",
      view: mine,
    });
    expect(resolveViewParam(defaults[0].id, views, P)).toMatchObject({
      kind: "found",
    });
  });

  it("id sai, không thấy, hoặc thuộc dự án khác: missing (thông báo trung tính)", () => {
    expect(resolveViewParam("abc", views, P)).toEqual({ kind: "missing" });
    expect(
      resolveViewParam("77777777-7777-4777-8777-777777777777", views, P),
    ).toEqual({ kind: "missing" });
    expect(resolveViewParam(OTHER, views, P)).toEqual({ kind: "missing" });
  });
});

describe("isSameViewState", () => {
  it("không phụ thuộc thứ tự khóa, bỏ khóa undefined", () => {
    expect(
      isSameViewState(
        { filters: { open: true, created_by: "me" }, sort: [] },
        { sort: [], filters: { created_by: "me", open: true, q: undefined } },
      ),
    ).toBe(true);
    expect(isSameViewState({ filters: { open: true } }, { filters: {} })).toBe(
      false,
    );
    expect(isSameViewState({ a: [1, 2] }, { a: [2, 1] })).toBe(false);
  });
});
