import { describe, expect, it } from "vitest";
import {
  insertMapper,
  mapFormulaRows,
  rangeOnRow,
  rangeRows,
  shiftRange,
} from "./xlsx-refs";

const same = { formulaSheet: "S", targetSheet: "S" };
const shift = { row: 10, delta: 5 };

describe("mapFormulaRows (chèn 5 dòng sau dòng mẫu 10)", () => {
  const map = (f: string, ctx = same) =>
    mapFormulaRows(f, ctx, insertMapper(shift));

  it("ô phía dưới dời xuống, ô trên và chính dòng mẫu giữ nguyên", () => {
    expect(map("A9+A10+A11")).toBe("A9+A10+A16");
    expect(map("$B$12*2")).toBe("$B$17*2");
  });

  it("vùng chứa dòng mẫu giãn ra phủ các dòng mới", () => {
    expect(map("SUM(E10:E10)")).toBe("SUM(E10:E15)");
    expect(map("SUM(E2:E10)")).toBe("SUM(E2:E15)");
    expect(map("SUM(E11:E20)")).toBe("SUM(E16:E25)");
    expect(map("SUM(E1:E9)")).toBe("SUM(E1:E9)");
  });

  it("không đụng chuỗi, tên hàm, cả cột", () => {
    expect(map('IF(A11="A11",LOG10(A11),0)')).toBe(
      'IF(A16="A11",LOG10(A16),0)',
    );
    expect(map("SUM(A:A)")).toBe("SUM(A:A)");
  });

  it("chỉ dời tham chiếu trỏ vào trang đích", () => {
    expect(map("Khac!A11+A11")).toBe("Khac!A11+A16");
    expect(
      map("'Báo cáo'!A11+A11", {
        formulaSheet: "Khac",
        targetSheet: "Báo cáo",
      }),
    ).toBe("'Báo cáo'!A16+A11");
  });
});

describe("tiện ích vùng", () => {
  it("shiftRange dời từng phần của sqref", () => {
    expect(shiftRange("A10:H10 B12", shift)).toBe("A10:H15 B17");
  });
  it("rangeRows, rangeOnRow", () => {
    expect(rangeRows("B3:D5")).toEqual([3, 5]);
    expect(rangeRows("C7")).toEqual([7, 7]);
    expect(rangeRows("A:A")).toBeNull();
    expect(rangeOnRow("B10:D10", 12)).toBe("B12:D12");
  });
});
