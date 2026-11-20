/**
 * Dời tham chiếu ô A1 khi chèn dòng (Story E5-3). Dùng cho công thức, vùng ô gộp, định dạng có điều
 * kiện, vùng in, bộ lọc của template xlsx khi một dòng mẫu lặp được nhân thành nhiều dòng.
 *
 * Quy tắc chèn `delta` dòng ngay SAU dòng mẫu R (dòng mẫu thành R..R+delta):
 *   - ô đơn: hàng > R thì + delta; hàng <= R giữ nguyên;
 *   - vùng s:e: s > R thì s + delta; e >= R thì e + delta (vùng chứa dòng mẫu giãn ra phủ hết các
 *     dòng mới, ví dụ =SUM(E10:E10) ở dòng tổng thành =SUM(E10:E2009)).
 * Tham chiếu cả cột (A:A) không đổi. Chuỗi trong công thức ("...") không bị đụng tới.
 */

export interface RowShift {
  /** Dòng mẫu (1-based). */
  row: number;
  /** Số dòng chèn thêm sau dòng mẫu (>= 0). */
  delta: number;
}

/** Tham chiếu ô: cột chữ, hàng số, có/không neo $. */
const CELL = String.raw`(\$?)([A-Z]{1,3})(\$?)(\d+)`;
/**
 * Tiền tố trang tính tùy chọn ('Tên có dấu cách'! hoặc Ten!), ô, và phần :ô của vùng. Không bắt
 * đầu giữa một tên (LOG10, A1B) và không phải tên hàm (theo sau là "(").
 */
const REF_RE = new RegExp(
  String.raw`(?<![A-Za-z0-9_.$])((?:'(?:[^']|'')+'|[A-Za-z_À-ỹ][A-Za-z0-9_.À-ỹ]*)!)?` +
    CELL +
    String.raw`(?::` +
    CELL +
    String.raw`)?(?![A-Za-z0-9_(])`,
  "g",
);

function unquoteSheet(prefix: string): string {
  const name = prefix.slice(0, -1);
  return name.startsWith("'") ? name.slice(1, -1).replace(/''/g, "'") : name;
}

export type RowMapper = (
  row: number,
  part: "cell" | "start" | "end",
  absolute: boolean,
) => number;

/** Hàm đổi hàng theo quy tắc chèn dòng ở đầu tệp. */
export function insertMapper({ row: r, delta }: RowShift): RowMapper {
  return (row, part) => {
    if (part === "end") return row >= r ? row + delta : row;
    return row > r ? row + delta : row;
  };
}

/**
 * Áp `map` cho mọi tham chiếu trỏ vào trang `targetSheet` trong một công thức nằm ở trang
 * `formulaSheet` (tham chiếu không có tên trang nghĩa là trang chứa công thức).
 */
export function mapFormulaRows(
  formula: string,
  ctx: { formulaSheet: string; targetSheet: string },
  map: RowMapper,
): string {
  // Tách phần chuỗi "..." (dấu "" là dấu nháy trong chuỗi) để không sửa nhầm chữ trong chuỗi.
  const parts = formula.split(/("(?:[^"]|"")*")/);
  return parts
    .map((part, i) => {
      if (i % 2 === 1) return part;
      return part.replace(
        REF_RE,
        (
          match,
          sheet: string | undefined,
          c1d: string,
          c1: string,
          r1d: string,
          r1: string,
          c2d: string | undefined,
          c2: string | undefined,
          r2d: string | undefined,
          r2: string | undefined,
        ) => {
          const sheetName = sheet ? unquoteSheet(sheet) : ctx.formulaSheet;
          if (sheetName !== ctx.targetSheet) return match;
          const prefix = sheet ?? "";
          if (c2 === undefined || r2 === undefined) {
            const row = map(Number(r1), "cell", r1d === "$");
            return `${prefix}${c1d}${c1}${r1d}${row}`;
          }
          const start = map(Number(r1), "start", r1d === "$");
          const end = map(Number(r2), "end", r2d === "$");
          return `${prefix}${c1d}${c1}${r1d}${start}:${c2d}${c2}${r2d}${end}`;
        },
      );
    })
    .join("");
}

/** Dời một vùng A1 hoặc danh sách vùng cách nhau bằng dấu cách (sqref) theo quy tắc chèn dòng. */
export function shiftRange(range: string, shift: RowShift): string {
  return range
    .split(" ")
    .map((part) =>
      mapFormulaRows(
        part,
        { formulaSheet: "", targetSheet: "" },
        insertMapper(shift),
      ),
    )
    .join(" ");
}

/** Hàng đầu và cuối của một vùng A1 ("B3:D5" → [3, 5], "C7" → [7, 7]); không phải vùng: null. */
export function rangeRows(range: string): [number, number] | null {
  const m = /^\$?[A-Z]{1,3}\$?(\d+)(?::\$?[A-Z]{1,3}\$?(\d+))?$/.exec(range);
  if (!m) return null;
  const a = Number(m[1]);
  const b = m[2] ? Number(m[2]) : a;
  return [Math.min(a, b), Math.max(a, b)];
}

/** Đặt cả vùng sang một hàng khác (dùng nhân bản ô gộp nằm gọn trong dòng mẫu). */
export function rangeOnRow(range: string, row: number): string {
  return range.replace(/(\$?[A-Z]{1,3}\$?)\d+/g, `$1${row}`);
}
