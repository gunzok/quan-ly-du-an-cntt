import { describe, expect, it } from "vitest";
import {
  MIN_GAP,
  compareCards,
  fullIndexFor,
  planMove,
  type MovePlan,
  type OrderedCard,
} from "./position";

const card = (
  id: string,
  position: number,
  created_at = "2026-11-15T00:00:00Z",
): OrderedCard => ({
  id,
  position,
  created_at,
});

/** Áp kế hoạch rồi trả thứ tự id sau khi chèn thẻ "X" — kiểm kết quả cuối, không chỉ con số. */
function orderAfter(
  column: OrderedCard[],
  plan: MovePlan,
  createdX = "2026-11-15T12:00:00Z",
): string[] {
  const updated = new Map(plan.others.map((u) => [u.id, u.position]));
  const next = column.map((c) => ({
    ...c,
    position: updated.get(c.id) ?? c.position,
  }));
  next.push(card("X", plan.position, createdX));
  return next.sort(compareCards).map((c) => c.id);
}

describe("compareCards", () => {
  it("position tăng dần, hòa thì created_at rồi id", () => {
    const list = [
      card("b", 1, "2026-01-02T00:00:00Z"),
      card("a", 1, "2026-01-02T00:00:00Z"),
      card("c", 0, "2026-01-03T00:00:00Z"),
      card("d", 1, "2026-01-01T00:00:00Z"),
    ];
    expect([...list].sort(compareCards).map((c) => c.id)).toEqual([
      "c",
      "d",
      "a",
      "b",
    ]);
  });
});

describe("planMove", () => {
  it("cột rỗng: giữ position hiện tại", () => {
    expect(planMove([], 0, 7)).toEqual({
      position: 7,
      others: [],
      exact: true,
    });
  });

  it("đầu cột và cuối cột: lùi/tiến một bước, không sửa thẻ khác", () => {
    const col = [card("a", 2), card("b", 5)];
    expect(planMove(col, 0, 0)).toEqual({
      position: 1,
      others: [],
      exact: true,
    });
    expect(planMove(col, 2, 0)).toEqual({
      position: 6,
      others: [],
      exact: true,
    });
  });

  it("giữa hai thẻ: điểm giữa, chỉ sửa MỘT task", () => {
    const col = [card("a", 1), card("b", 2), card("c", 4)];
    const plan = planMove(col, 2, 0);
    expect(plan).toEqual({ position: 3, others: [], exact: true });
    expect(orderAfter(col, plan)).toEqual(["a", "b", "X", "c"]);
  });

  it("chèn nhiều lần liên tiếp vào cùng khe vẫn giữ đúng thứ tự", () => {
    const col = [card("a", 0), card("b", 1)];
    for (let n = 0; n < 60; n += 1) {
      const plan = planMove(col, 1, 0);
      expect(orderAfter(col, plan)).toEqual([
        "a",
        "X",
        ...col.slice(1).map((c) => c.id),
      ]);
      for (const u of plan.others) {
        const c = col.find((x) => x.id === u.id);
        if (c) c.position = u.position;
      }
      col.splice(1, 0, card(`n${n}`, plan.position));
      // Sau mỗi lần, các position liền kề vẫn tăng thật sự.
      for (let k = 1; k < col.length; k += 1) {
        expect(col[k].position).toBeGreaterThan(col[k - 1].position);
      }
    }
  });

  it("hai hàng xóm trùng position (mặc định 0): dãn đoạn ngắn nhất, đặt đúng chỗ", () => {
    const col = [
      card("a", 0, "2026-01-01T00:00:00Z"),
      card("b", 0, "2026-01-02T00:00:00Z"),
      card("c", 0, "2026-01-03T00:00:00Z"),
      card("d", 0, "2026-01-04T00:00:00Z"),
      card("e", 0, "2026-01-05T00:00:00Z"),
    ];
    // Chèn sau "d": phía phải chỉ có "e" (2 ghi) ngắn hơn phía trái (5 ghi).
    const plan = planMove(col, 4, 0);
    expect(plan.exact).toBe(true);
    expect(plan.others.map((u) => u.id)).toEqual(["e"]);
    expect(orderAfter(col, plan)).toEqual(["a", "b", "c", "d", "X", "e"]);

    // Chèn sau "a": phía trái chỉ có "a".
    const left = planMove(col, 1, 0);
    expect(left.others.map((u) => u.id)).toEqual(["a"]);
    expect(orderAfter(col, left, "2030-01-01T00:00:00Z")).toEqual([
      "a",
      "X",
      "b",
      "c",
      "d",
      "e",
    ]);
  });

  it("đoạn dính nhau ở giữa cột: dãn trong khoảng tới thẻ khác biệt kế tiếp", () => {
    const col = [
      card("a", 0),
      card("b", 5),
      card("c", 5),
      card("d", 5),
      card("e", 9),
    ];
    const plan = planMove(col, 2, 0); // giữa b và c
    expect(orderAfter(col, plan)).toEqual(["a", "b", "X", "c", "d", "e"]);
    for (const u of [...plan.others, { id: "X", position: plan.position }]) {
      expect(u.position).toBeGreaterThan(0);
      expect(u.position).toBeLessThan(9);
    }
  });

  it("khe nhỏ hơn MIN_GAP được coi là quá nhỏ", () => {
    const col = [card("a", 1), card("b", 1 + MIN_GAP / 2), card("c", 3)];
    const plan = planMove(col, 1, 0);
    expect(plan.others.length).toBeGreaterThan(0);
    expect(orderAfter(col, plan)).toEqual(["a", "X", "b", "c"]);
  });

  it("thiếu quyền sửa thẻ ở một phía: chọn phía còn lại dù dài hơn", () => {
    const col = [card("a", 0), card("b", 0), card("c", 0), card("d", 0)];
    const editable = new Set(["a", "b", "c"]);
    const plan = planMove(col, 3, 0, { canEdit: (id) => editable.has(id) });
    expect(plan.others.map((u) => u.id)).toEqual(["a", "b", "c"]);
    expect(orderAfter(col, plan)).toEqual(["a", "b", "c", "X", "d"]);
  });

  it("không phía nào sửa được: đặt gần đúng, exact = false, không sửa thẻ khác", () => {
    const col = [card("a", 0), card("b", 0), card("c", 0)];
    const plan = planMove(col, 1, 0, { canEdit: () => false });
    expect(plan).toEqual({ position: 0, others: [], exact: false });
  });

  it("phải sửa quá maxOthers thẻ: đặt gần đúng", () => {
    const col = Array.from({ length: 10 }, (_, k) => card(`c${k}`, 0));
    expect(planMove(col, 5, 0, { maxOthers: 4 }).exact).toBe(false);
    expect(planMove(col, 5, 0, { maxOthers: 5 }).others).toHaveLength(5);
  });
});

describe("fullIndexFor", () => {
  const full = ["a", "b", "c", "d", "e"].map((id) => ({ id }));

  it("bám thẻ hiển thị đứng trước chỗ thả", () => {
    // Đang lọc: chỉ thấy a, c, e. Thả giữa c và e → ngay sau c trong cột đầy đủ.
    expect(fullIndexFor(full, ["a", "c", "e"], 2)).toBe(3);
  });

  it("thả đầu danh sách hiển thị: bám thẻ đứng sau", () => {
    expect(fullIndexFor(full, ["c", "e"], 0)).toBe(2);
  });

  it("không thẻ nào hiển thị: thêm cuối cột", () => {
    expect(fullIndexFor(full, [], 0)).toBe(5);
    expect(fullIndexFor([], [], 0)).toBe(0);
  });
});
