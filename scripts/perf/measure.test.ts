import { describe, expect, it } from "vitest";
import { walkAll } from "./measure";

/** API giả: n task, trang `limit` theo con trỏ là chỉ số bắt đầu. */
function fakeApi(n: number, limit: number, dupAt?: number) {
  const calls: string[] = [];
  const get = async (path: string) => {
    calls.push(path);
    const m = /cursor=(\d+)/.exec(path);
    const start = m ? Number(m[1]) : 0;
    const ids = Array.from(
      { length: Math.min(limit, n - start) },
      (_, i) => `t${start + i}`,
    );
    if (dupAt !== undefined && start > 0) ids[0] = `t${dupAt}`;
    const next = start + limit < n ? String(start + limit) : null;
    return {
      ms: 10,
      status: 200,
      body: {
        data: ids.map((id) => ({ id, assignee_id: null })),
        next_cursor: next,
      },
    };
  };
  return { get, calls };
}

describe("walkAll (E3-4: đo tải cả bảng)", () => {
  it("đi hết con trỏ, cộng thời gian các lượt, giữ tham số limit", async () => {
    const { get, calls } = fakeApi(2000, 500);
    const r = await walkAll(get, "/api/v1/projects/p/tasks?limit=500");
    expect(r).toEqual({ ms: 40, count: 2000, pages: 4 });
    expect(calls[1]).toBe("/api/v1/projects/p/tasks?limit=500&cursor=500");
  });

  it("báo lỗi khi có task lặp (con trỏ hỏng) hoặc lượt không phải 200", async () => {
    await expect(walkAll(fakeApi(10, 4, 0).get, "/x?limit=4")).rejects.toThrow(
      /lặp lại/,
    );
    const failing = async () => ({ ms: 1, status: 500, body: null });
    await expect(walkAll(failing, "/x")).rejects.toThrow(/500/);
  });

  it("chặn vòng lặp vô hạn bằng maxPages", async () => {
    const loop = async () => ({
      ms: 1,
      status: 200,
      body: { data: [], next_cursor: "0" },
    });
    await expect(walkAll(loop, "/x", 3)).rejects.toThrow(/Quá 3 trang/);
  });
});
