import { describe, expect, it } from "vitest";
import {
  EMPTY_ACTIVITY_FILTERS,
  isFiltered,
  toApiFilters,
  type ActivityFilterState,
} from "./filters";

const TODAY = "2026-11-17";
const state = (p: Partial<ActivityFilterState>) => ({
  ...EMPTY_ACTIVITY_FILTERS,
  ...p,
});

describe("toApiFilters", () => {
  it("không lọc: không tham số", () => {
    expect(toApiFilters(EMPTY_ACTIVITY_FILTERS, TODAY)).toEqual({
      ok: true,
      filters: {},
    });
    expect(isFiltered(EMPTY_ACTIVITY_FILTERS)).toBe(false);
  });

  it("khoảng chọn nhanh tính theo ngày Việt Nam, cả hai đầu", () => {
    expect(toApiFilters(state({ period: "today" }), TODAY)).toEqual({
      ok: true,
      filters: { from: TODAY, to: TODAY },
    });
    expect(toApiFilters(state({ period: "last7" }), TODAY)).toEqual({
      ok: true,
      filters: { from: "2026-11-11", to: TODAY },
    });
    expect(toApiFilters(state({ period: "last30" }), "2026-03-01")).toEqual({
      ok: true,
      filters: { from: "2026-01-31", to: "2026-03-01" },
    });
  });

  it("người, đối tượng, loại thay đổi, khoảng tùy chọn", () => {
    expect(
      toApiFilters(
        state({
          actor: "u1",
          entity: "task",
          action: "update",
          period: "custom",
          from: "2026-11-01",
        }),
        TODAY,
      ),
    ).toEqual({
      ok: true,
      filters: {
        actor_id: "u1",
        entity_type: "task",
        action: "update",
        from: "2026-11-01",
      },
    });
    expect(
      toApiFilters(
        state({ period: "custom", from: "2026-11-02", to: "2026-11-01" }),
        TODAY,
      ),
    ).toEqual({ ok: false });
    expect(isFiltered(state({ period: "custom" }))).toBe(false);
    expect(isFiltered(state({ period: "custom", to: TODAY }))).toBe(true);
  });
});
