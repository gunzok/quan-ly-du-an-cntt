import { describe, expect, it } from "vitest";
import { calcProgressPercent } from "./progress";

describe("calcProgressPercent", () => {
  it("tính đúng phần trăm và làm tròn", () => {
    expect(calcProgressPercent(0, 4)).toBe(0);
    expect(calcProgressPercent(1, 4)).toBe(25);
    expect(calcProgressPercent(1, 3)).toBe(33);
    expect(calcProgressPercent(2, 3)).toBe(67);
    expect(calcProgressPercent(5, 5)).toBe(100);
  });

  it("trả về 0 khi chưa có việc nào", () => {
    expect(calcProgressPercent(0, 0)).toBe(0);
  });

  it("từ chối đầu vào không hợp lệ", () => {
    expect(() => calcProgressPercent(-1, 3)).toThrow(RangeError);
    expect(() => calcProgressPercent(4, 3)).toThrow(RangeError);
    expect(() => calcProgressPercent(1.5, 3)).toThrow(RangeError);
    expect(() => calcProgressPercent(Number.NaN, 3)).toThrow(RangeError);
  });
});
