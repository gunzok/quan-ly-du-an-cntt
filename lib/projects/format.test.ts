import { describe, expect, it } from "vitest";
import { formatDate, todayIso } from "./format";

describe("todayIso", () => {
  it("ranh giới ngày theo giờ Việt Nam (UTC+7), không theo UTC", () => {
    // 17:30 UTC ngày 14 = 00:30 ngày 15 ở Việt Nam.
    expect(todayIso(new Date("2026-11-14T17:30:00Z"))).toBe("2026-11-15");
    expect(todayIso(new Date("2026-11-14T16:59:59Z"))).toBe("2026-11-14");
  });
});

describe("formatDate", () => {
  it("YYYY-MM-DD → DD/MM/YYYY; null hoặc sai dạng → null", () => {
    expect(formatDate("2027-01-15")).toBe("15/01/2027");
    expect(formatDate(null)).toBeNull();
    expect(formatDate("15/01/2027")).toBeNull();
  });
});
