import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TaskRelationView } from "@/lib/task-relations/model";
import {
  BLOCKED_BY_MAX,
  attachBlocked,
  blockedCompletionWarning,
  loadOpenBlockers,
  withBlocked,
} from "./blocked";
import {
  applyCompletionChange,
  blockedWarningIds,
  blockerItems,
  completionChange,
} from "./blocked-view";
import type { Task } from "./model";

const task = (id: string, over: Partial<Task> = {}): Task =>
  ({
    id,
    title: id.toUpperCase(),
    status_id: "todo",
    completed_at: null,
    label_ids: [],
    ...over,
  }) as Task;

const info = (ids: string[]) => ({ ids, count: ids.length });

describe("withBlocked", () => {
  it("task chưa xong có task chặn mở: blocked + blocked_by", () => {
    const out = withBlocked(task("a"), new Map([["a", info(["b", "c"])]]));
    expect(out.blocked).toBe(true);
    expect(out.blocked_by).toEqual(["b", "c"]);
  });
  it("không có task chặn mở: không bị chặn", () => {
    expect(withBlocked(task("a"), new Map())).toMatchObject({
      blocked: false,
      blocked_by: [],
    });
  });
  it("task tự đã xong: không còn bị chặn dù task chặn chưa xong", () => {
    const out = withBlocked(
      task("a", { completed_at: "2026-11-17T00:00:00Z" }),
      new Map([["a", info(["b"])]]),
    );
    expect(out).toMatchObject({ blocked: false, blocked_by: [] });
  });
  it("blocked_by cắt ở BLOCKED_BY_MAX", () => {
    const ids = Array.from({ length: 8 }, (_, i) => `b${i}`);
    const out = withBlocked(task("a"), new Map([["a", { ids, count: 8 }]]));
    expect(out.blocked_by).toHaveLength(BLOCKED_BY_MAX);
  });
});

describe("blockedCompletionWarning (BR-06)", () => {
  const open = { completed_at: null };
  const done = { completed_at: "2026-11-17T00:00:00Z" };
  it("vừa hoàn thành mà còn task chặn mở: cảnh báo kèm id", () => {
    expect(blockedCompletionWarning(open, done, info(["b"]))).toEqual({
      code: "blocked_by_open_task",
      task_ids: ["b"],
    });
  });
  it("không đổi trạng thái hoàn thành, hoặc không còn task chặn: không cảnh báo", () => {
    expect(blockedCompletionWarning(open, open, info(["b"]))).toBeNull();
    expect(blockedCompletionWarning(done, done, info(["b"]))).toBeNull();
    expect(blockedCompletionWarning(open, done, undefined)).toBeNull();
    expect(blockedCompletionWarning(open, done, info([]))).toBeNull();
  });
});

describe("loadOpenBlockers, attachBlocked", () => {
  it("một lời gọi RPC cho cả trang, dựng Map theo task", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{ task_id: "a", blocker_ids: ["b"], blocker_count: 1 }],
      error: null,
    });
    const session = { rpc } as unknown as SupabaseClient;
    const out = await attachBlocked(session, [task("a"), task("c")]);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("task_open_blockers", {
      p_task_ids: ["a", "c"],
      p_limit: BLOCKED_BY_MAX,
    });
    expect(out.map((t) => [t.blocked, t.blocked_by_count])).toEqual([
      [true, 1],
      [false, 0],
    ]);
  });
  it("danh sách rỗng: không gọi CSDL", async () => {
    const rpc = vi.fn();
    const session = { rpc } as unknown as SupabaseClient;
    expect(await attachBlocked(session, [])).toEqual([]);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("lỗi CSDL được ném lên (handler trả 500)", async () => {
    const session = {
      rpc: vi.fn().mockResolvedValue({ data: null, error: { code: "x" } }),
    } as unknown as SupabaseClient;
    await expect(loadOpenBlockers(session, ["a"])).rejects.toEqual({
      code: "x",
    });
  });
});

describe("blockerItems (banner chi tiết task)", () => {
  const cat = (id: string | null) =>
    id === "done" ? ("done" as const) : id ? ("todo" as const) : undefined;
  const rel = (relation: string, id: string, status_id: string) =>
    ({
      relation,
      task: { id, title: `T-${id}`, status_id },
    }) as unknown as TaskRelationView;

  it("dùng danh sách quan hệ: chỉ bị chặn bởi task chưa xong, có tiêu đề", () => {
    expect(
      blockerItems(
        task("a"),
        [
          rel("blocked_by", "b", "todo"),
          rel("blocked_by", "c", "done"),
          rel("blocks", "d", "todo"),
          rel("follows", "e", "todo"),
        ],
        cat,
      ),
    ).toEqual([{ id: "b", title: "T-b" }]);
  });
  it("quan hệ chưa tải: dùng blocked_by của API (chỉ id)", () => {
    expect(
      blockerItems(task("a", { blocked: true, blocked_by: ["b"] }), null, cat),
    ).toEqual([{ id: "b", title: null }]);
    expect(blockerItems(task("a"), null, cat)).toEqual([]);
  });
  it("task tự đã xong (theo nhóm trạng thái): không hiện banner", () => {
    expect(
      blockerItems(
        task("a", { status_id: "done" }),
        [rel("blocked_by", "b", "todo")],
        cat,
      ),
    ).toEqual([]);
  });
});

describe("blockedWarningIds, completionChange, applyCompletionChange", () => {
  it("đọc id từ warnings", () => {
    expect(blockedWarningIds(undefined)).toEqual([]);
    expect(
      blockedWarningIds([
        { code: "other" },
        { code: "blocked_by_open_task", task_ids: ["b"] },
      ]),
    ).toEqual(["b"]);
  });
  it("completionChange", () => {
    const o = { completed_at: null };
    const d = { completed_at: "x" };
    expect(completionChange(o, d)).toBe("completed");
    expect(completionChange(d, o)).toBe("reopened");
    expect(completionChange(o, o)).toBe("none");
  });
  it("task chặn vừa xong: giảm số task chặn, hết thì hết bị chặn", () => {
    const tasks = [
      task("b"),
      task("x", { blocked: true, blocked_by: ["b"], blocked_by_count: 1 }),
      task("y", { blocked: true, blocked_by: ["b", "c"], blocked_by_count: 2 }),
      task("z", { blocked: true, blocked_by: ["c"], blocked_by_count: 1 }),
    ];
    const out = applyCompletionChange(tasks, "b", "completed");
    expect(out.map((t) => [t.id, t.blocked, t.blocked_by_count])).toEqual([
      ["b", undefined, undefined],
      ["x", false, 0],
      ["y", true, 1],
      ["z", true, 1],
    ]);
    expect(out[1]?.blocked_by).toEqual([]);
    expect(out[3]).toBe(tasks[3]);
  });
  it("danh sách bị cắt (count > số id): vẫn bị chặn khi hết id hiển thị", () => {
    let tasks: readonly Task[] = [
      task("x", { blocked: true, blocked_by: ["a", "b"], blocked_by_count: 7 }),
    ];
    tasks = applyCompletionChange(tasks, "a", "completed");
    tasks = applyCompletionChange(tasks, "b", "completed");
    expect(tasks[0]).toMatchObject({
      blocked: true,
      blocked_by: [],
      blocked_by_count: 5,
    });
  });
  it("không đổi hoặc mở lại: giữ nguyên mảng", () => {
    const tasks = [task("x", { blocked: true, blocked_by: ["b"] })];
    expect(applyCompletionChange(tasks, "b", "none")).toBe(tasks);
    expect(applyCompletionChange(tasks, "b", "reopened")).toBe(tasks);
  });
});
