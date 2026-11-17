import { isUuid } from "@/lib/api/request";
import { defaultViewKey, defaultViewRank } from "./defaults";
import type { SavedView } from "./model";

/**
 * Menu chế độ xem S12 (Story E13-2; mockup v3 bp-ListViews.dc.html): chia danh sách từ
 * GET /projects/{id}/views thành các mục Yêu thích, Mặc định, Công khai, Riêng tư (của tôi). Thuần,
 * không I/O, để test đơn vị.
 */
export interface ViewSections {
  favorites: SavedView[];
  defaults: SavedView[];
  shared: SavedView[];
  mine: SavedView[];
}

const byName = (a: SavedView, b: SavedView) =>
  a.name.localeCompare(b.name, "vi") || a.id.localeCompare(b.id);

/** Mặc định dùng chung theo thứ tự OpenProject; mặc định khác (theo dự án) sau, theo tên. */
const byDefaultOrder = (a: SavedView, b: SavedView) =>
  defaultViewRank(a.id) - defaultViewRank(b.id) || byName(a, b);

/**
 * `search`: lọc theo tên hiển thị (không phân biệt hoa thường, bỏ dấu). `label` cho tên hiển thị
 * (mặc định dịch theo ngôn ngữ).
 */
export function viewSections(
  views: readonly SavedView[],
  label: (view: SavedView) => string,
  search = "",
): ViewSections {
  const needle = fold(search.trim());
  const shown = needle
    ? views.filter((v) => fold(label(v)).includes(needle))
    : views;
  const defaults = shown.filter((v) => v.is_default).sort(byDefaultOrder);
  const others = shown.filter((v) => !v.is_default);
  return {
    favorites: shown
      .filter((v) => v.is_favorite)
      .sort((a, b) =>
        a.is_default !== b.is_default
          ? a.is_default
            ? -1
            : 1
          : a.is_default
            ? byDefaultOrder(a, b)
            : byName(a, b),
      ),
    defaults,
    shared: others.filter((v) => v.visibility === "public").sort(byName),
    mine: others.filter((v) => v.visibility === "private").sort(byName),
  };
}

/** Chữ thường, bỏ dấu tiếng Việt (đ → d) để tìm tên. */
export function fold(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase();
}

/**
 * Chế độ xem theo tham số `?view=` cho trang của `projectId`: chỉ nhận chế độ xem của chính dự án
 * hoặc mặc định dùng chung. Không thấy (id sai, đã xóa, riêng tư của người khác, dự án khác):
 * `missing` để giao diện báo trung tính, không lộ chế độ xem có tồn tại hay không.
 */
export function resolveViewParam(
  raw: string | null,
  views: readonly SavedView[],
  projectId: string,
): { kind: "none" } | { kind: "missing" } | { kind: "found"; view: SavedView } {
  if (raw === null || raw === "") return { kind: "none" };
  if (!isUuid(raw)) return { kind: "missing" };
  const id = raw.toLowerCase();
  const view = views.find(
    (v) => v.id === id && (v.project_id === null || v.project_id === projectId),
  );
  return view ? { kind: "found", view } : { kind: "missing" };
}

export { defaultViewKey };

/** JSON với khóa object sắp xếp (so hai query không phụ thuộc thứ tự khóa). */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Hai cách xem như nhau (bộ lọc, sắp xếp, nhóm, cột; thứ tự khóa không tính). */
export function isSameViewState(a: unknown, b: unknown): boolean {
  return canonical(a) === canonical(b);
}
