/**
 * Thứ tự thẻ trong một cột Kanban (Story E3-1, QLDA-47). Thuần, không I/O, để test đơn vị.
 *
 * `tasks.position` là số thực (double precision, mặc định 0). Thả thẻ vào giữa hai thẻ: lấy điểm
 * giữa hai hàng xóm, chỉ sửa MỘT task (không đánh số lại cả cột). Thứ tự hiển thị: position tăng
 * dần, hòa thì created_at rồi id (ổn định, khớp ở mọi trình duyệt).
 *
 * Khoảng cách quá nhỏ: task tạo không gửi position đều bằng 0 nên hai hàng xóm thường trùng
 * position. Khi đó không có điểm giữa: dãn MỘT đoạn ngắn nhất các thẻ dính nhau (về một phía của
 * chỗ thả) ra cho đều, giữ nguyên thứ tự tương đối của chúng. Chỉ dãn phía người dùng được sửa mọi
 * thẻ (Thành viên chỉ sửa task mình phụ trách/tạo) và số thẻ phải sửa không vượt `maxOthers`;
 * không phía nào được thì đặt gần đúng (trùng position với hàng xóm, `exact: false`) để giao diện
 * báo cho người dùng. Sau lần dãn đầu, các position đã khác nhau nên lần sau chỉ còn sửa một task.
 */

/** Khoảng cách tối thiểu giữa hai position liền kề để còn chèn điểm giữa (tránh sai số dấu phẩy động). */
export const MIN_GAP = 1e-6;
/** Bước khi thả ở đầu/cuối cột hoặc khi dãn một đoạn chạm đầu/cuối cột. */
export const POSITION_STEP = 1;

export interface OrderedCard {
  id: string;
  position: number;
  created_at: string;
}

export function compareCards(a: OrderedCard, b: OrderedCard): number {
  if (a.position !== b.position) return a.position - b.position;
  if (a.created_at !== b.created_at) return a.created_at < b.created_at ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export interface PositionUpdate {
  id: string;
  position: number;
}

export interface MovePlan {
  /** Position mới của thẻ được kéo. */
  position: number;
  /** Thẻ khác phải đổi position (dãn đoạn dính nhau); thường rỗng. */
  others: PositionUpdate[];
  /** false: không đặt đúng chỗ thả được vì thiếu quyền sửa thẻ hàng xóm. */
  exact: boolean;
}

function gapOk(lo: number, hi: number): boolean {
  if (!(hi - lo >= MIN_GAP)) return false;
  const mid = (lo + hi) / 2;
  return lo < mid && mid < hi;
}

/**
 * Tính vị trí khi chèn một thẻ vào cột.
 *
 * @param column  thẻ của cột đích, ĐÃ sắp theo compareCards, KHÔNG gồm thẻ đang kéo.
 * @param index   chỗ chèn trong `column` (0 = đầu cột, column.length = cuối cột).
 * @param current position hiện tại của thẻ (giữ nguyên khi cột đích rỗng).
 * @param options.canEdit   người dùng có sửa được thẻ này không (mặc định: được).
 * @param options.maxOthers số thẻ khác tối đa được sửa khi dãn (giữ số request trong giới hạn tần
 *                          suất API); vượt thì đặt gần đúng.
 */
export function planMove(
  column: readonly OrderedCard[],
  index: number,
  current: number,
  options: { canEdit?: (id: string) => boolean; maxOthers?: number } = {},
): MovePlan {
  const canEdit = options.canEdit ?? (() => true);
  const maxOthers = options.maxOthers ?? Number.POSITIVE_INFINITY;
  const i = Math.max(0, Math.min(index, column.length));
  const before = column[i - 1];
  const after = column[i];
  if (!before && !after) return { position: current, others: [], exact: true };
  if (!before) {
    return { position: after.position - POSITION_STEP, others: [], exact: true };
  }
  if (!after) {
    return { position: before.position + POSITION_STEP, others: [], exact: true };
  }
  if (gapOk(before.position, after.position)) {
    return {
      position: (before.position + after.position) / 2,
      others: [],
      exact: true,
    };
  }

  const plans = [spreadRight(column, i), spreadLeft(column, i)]
    .filter(
      (o) =>
        o.others.length <= maxOthers && o.others.every((u) => canEdit(u.id)),
    )
    .sort((a, b) => a.others.length - b.others.length);
  if (plans[0]) return plans[0];
  // Không dãn được (thiếu quyền hoặc quá nhiều thẻ): trùng position với thẻ trước, thứ tự trong nhóm theo created_at.
  return { position: before.position, others: [], exact: false };
}

/**
 * Dãn thẻ đang kéo + column[i..r] trong khoảng (column[i-1].position, column[r+1].position),
 * mở rộng r tới khi mỗi khe ≥ MIN_GAP; chạm cuối cột thì bước POSITION_STEP.
 */
function spreadRight(column: readonly OrderedCard[], i: number): MovePlan {
  const lo = column[i - 1].position;
  for (let r = i; r < column.length; r += 1) {
    const next = column[r + 1];
    const count = r - i + 2; // thẻ kéo + column[i..r]
    if (!next) break;
    const step = (next.position - lo) / (count + 1);
    if (step >= MIN_GAP && lo + step > lo) {
      return build(column.slice(i, r + 1), (k) => lo + step * (k + 1), "right");
    }
  }
  return build(column.slice(i), (k) => lo + POSITION_STEP * (k + 1), "right");
}

/** Đối xứng spreadRight: dãn column[l..i-1] + thẻ đang kéo trong (column[l-1], column[i]). */
function spreadLeft(column: readonly OrderedCard[], i: number): MovePlan {
  const hi = column[i].position;
  for (let l = i - 1; l >= 0; l -= 1) {
    const prev = column[l - 1];
    const count = i - l + 1;
    if (!prev) break;
    const step = (hi - prev.position) / (count + 1);
    if (step >= MIN_GAP && hi - step < hi) {
      return build(
        column.slice(l, i),
        (k) => hi - step * (count - k),
        "left",
      );
    }
  }
  const run = column.slice(0, i);
  const count = run.length + 1;
  return build(run, (k) => hi - POSITION_STEP * (count - k), "left");
}

/**
 * Gán position theo hàm vị trí `at(k)` (k tăng dần theo thứ tự hiển thị) cho đoạn `run` và thẻ
 * đang kéo: phía phải thì thẻ kéo đứng đầu đoạn, phía trái thì đứng cuối.
 */
function build(
  run: readonly OrderedCard[],
  at: (k: number) => number,
  side: "left" | "right",
): MovePlan {
  if (side === "right") {
    return {
      position: at(0),
      others: run.map((c, k) => ({ id: c.id, position: at(k + 1) })),
      exact: true,
    };
  }
  return {
    position: at(run.length),
    others: run.map((c, k) => ({ id: c.id, position: at(k) })),
    exact: true,
  };
}

/**
 * Chỗ chèn trong cột ĐẦY ĐỦ khi người dùng thả vào chỉ số `visibleIndex` của danh sách đang
 * HIỂN THỊ (có thể đã lọc hoặc chỉ hiện một phần). Bám theo thẻ hiển thị đứng trước chỗ thả; không
 * có thì bám thẻ hiển thị đứng sau; cột không có thẻ nào hiển thị thì thêm cuối cột.
 *
 * @param full    cột đầy đủ đã sắp, không gồm thẻ đang kéo.
 * @param visible id thẻ đang hiển thị theo thứ tự, không gồm thẻ đang kéo.
 */
export function fullIndexFor(
  full: readonly { id: string }[],
  visible: readonly string[],
  visibleIndex: number,
): number {
  const prev = visible[visibleIndex - 1];
  if (prev !== undefined) {
    const at = full.findIndex((c) => c.id === prev);
    if (at >= 0) return at + 1;
  }
  const next = visible[visibleIndex];
  if (next !== undefined) {
    const at = full.findIndex((c) => c.id === next);
    if (at >= 0) return at;
  }
  return full.length;
}
