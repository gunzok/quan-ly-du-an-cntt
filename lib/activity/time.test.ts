import { describe, expect, it } from "vitest";
import {
  addDays,
  daysBetween,
  groupByVnDay,
  vnDateOf,
  vnDateRangeToUtc,
  vnDayStartUtc,
} from "./time";

describe("ranh giới ngày theo giờ Việt Nam (UTC+7)", () => {
  it("đầu ngày Việt Nam là 17:00 UTC hôm trước", () => {
    expect(vnDayStartUtc("2026-11-17")).toBe("2026-11-16T17:00:00.000Z");
    expect(vnDayStartUtc("2027-01-01")).toBe("2026-12-31T17:00:00.000Z");
  });

  it("khoảng [from, to] tính cả hai đầu thành nửa khoảng UTC [gte, lt)", () => {
    expect(vnDateRangeToUtc("2026-11-10", "2026-11-17")).toEqual({
      gte: "2026-11-09T17:00:00.000Z",
      lt: "2026-11-17T17:00:00.000Z",
    });
    expect(vnDateRangeToUtc(null, "2026-02-28")).toEqual({
      gte: null,
      lt: "2026-02-28T17:00:00.000Z",
    });
    expect(vnDateRangeToUtc("2028-02-29", null)).toEqual({
      gte: "2028-02-28T17:00:00.000Z",
      lt: null,
    });
  });

  it("thời điểm sát nửa đêm rơi đúng ngày Việt Nam", () => {
    // 16:59:59.999Z = 23:59:59.999 giờ VN cùng ngày; 17:00Z = 00:00 ngày hôm sau.
    expect(vnDateOf("2026-11-16T16:59:59.999Z")).toBe("2026-11-16");
    expect(vnDateOf("2026-11-16T17:00:00Z")).toBe("2026-11-17");
    expect(vnDateOf("2026-11-17T00:30:00+07:00")).toBe("2026-11-17");
    expect(vnDateOf(new Date("2026-12-31T17:00:00Z"))).toBe("2027-01-01");
  });

  it("cộng ngày qua tháng, năm nhuận", () => {
    expect(addDays("2026-11-30", 1)).toBe("2026-12-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(daysBetween("2026-11-16", "2026-11-17")).toBe(1);
    expect(daysBetween("2026-11-17", "2026-11-10")).toBe(-7);
  });

  it("nhóm theo ngày Việt Nam, giữ thứ tự mới nhất trước", () => {
    const groups = groupByVnDay([
      { created_at: "2026-11-17T02:00:00Z", n: 1 },
      { created_at: "2026-11-16T17:00:00Z", n: 2 }, // 00:00 ngày 17 giờ VN
      { created_at: "2026-11-16T16:59:00Z", n: 3 }, // 23:59 ngày 16 giờ VN
      { created_at: "2026-11-10T09:00:00Z", n: 4 },
    ]);
    expect(groups.map((g) => [g.day, g.items.map((i) => i.n)])).toEqual([
      ["2026-11-17", [1, 2]],
      ["2026-11-16", [3]],
      ["2026-11-10", [4]],
    ]);
    expect(groupByVnDay([])).toEqual([]);
  });
});
