import { describe, expect, it } from "vitest";
import { reportFileName } from "./model";
import {
  currentMonthPeriod,
  isCalendarDate,
  periodBounds,
  periodDays,
} from "./period";
import { validateExportReport } from "./validate";

const ok = {
  format: "xlsx",
  period_start: "2026-11-01",
  period_end: "2026-11-30",
} as const;

describe("validateExportReport", () => {
  it("nhận thân hợp lệ", () => {
    expect(validateExportReport(ok)).toEqual({ ok: true, data: ok });
  });
  it("từ chối trường lạ, thiếu trường, định dạng sai", () => {
    expect(validateExportReport({ ...ok, extra: 1 })).toEqual({
      ok: false,
      details: [{ field: "extra", issue: "unknown_field" }],
    });
    expect(validateExportReport({})).toMatchObject({ ok: false });
    expect(validateExportReport({ ...ok, format: "pdf" })).toEqual({
      ok: false,
      details: [{ field: "format", issue: "invalid_value" }],
    });
    expect(validateExportReport({ ...ok, period_start: "2026-02-31" })).toEqual(
      {
        ok: false,
        details: [{ field: "period_start", issue: "invalid_format" }],
      },
    );
    expect(validateExportReport([])).toMatchObject({ ok: false });
  });
  it("kỳ ngược hoặc dài quá 366 ngày: period_end invalid_value", () => {
    const bad = { field: "period_end", issue: "invalid_value" };
    expect(validateExportReport({ ...ok, period_end: "2026-10-31" })).toEqual({
      ok: false,
      details: [bad],
    });
    expect(
      validateExportReport({
        ...ok,
        period_start: "2025-01-01",
        period_end: "2026-01-02",
      }),
    ).toEqual({ ok: false, details: [bad] });
    expect(
      validateExportReport({
        ...ok,
        period_start: "2024-01-01",
        period_end: "2024-12-31",
      }).ok,
    ).toBe(true);
  });
});

describe("kỳ báo cáo giờ Việt Nam", () => {
  it("ngày lịch hợp lệ", () => {
    expect(isCalendarDate("2028-02-29")).toBe(true);
    expect(isCalendarDate("2026-02-29")).toBe(false);
    expect(isCalendarDate("2026-1-01")).toBe(false);
  });
  it("số ngày và ranh giới UTC", () => {
    expect(periodDays("2026-11-01", "2026-11-30")).toBe(30);
    expect(periodBounds("2026-11-01", "2026-11-30")).toEqual({
      from: "2026-10-31T17:00:00.000Z",
      to: "2026-11-30T17:00:00.000Z",
    });
  });
  it("tháng hiện tại theo giờ Việt Nam (đêm 31/10 UTC đã là tháng 11)", () => {
    expect(currentMonthPeriod(new Date("2026-10-31T18:00:00Z"))).toEqual({
      start: "2026-11-01",
      end: "2026-11-30",
    });
    expect(currentMonthPeriod(new Date("2028-02-10T00:00:00Z")).end).toBe(
      "2028-02-29",
    );
  });
});

describe("reportFileName", () => {
  it("ASCII, bỏ dấu, có kỳ", () => {
    expect(reportFileName("Dự án Đường sắt / Giai đoạn 2", ok)).toBe(
      "bao-cao-du-an-duong-sat-giai-doan-2-2026-11-01-2026-11-30.xlsx",
    );
    expect(reportFileName("!!!", ok)).toBe(
      "bao-cao-du-an-2026-11-01-2026-11-30.xlsx",
    );
  });
});
