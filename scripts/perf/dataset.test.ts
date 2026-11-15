import { describe, expect, it } from "vitest";
import {
  DEFAULT_STATUSES,
  LABEL_NAMES,
  SEARCH_QUERIES,
  assertConfig,
  createRng,
  defaultConfig,
  generateDataset,
  hasDependencyCycle,
  levelSizes,
  openChildrenOfDone,
  perfUsers,
  perfUuid,
  projectId,
  statusCategory,
  treeErrors,
  type PerfDataset,
} from "./dataset";
import { assertDatasetValid } from "./seed";

const anchor = new Date("2026-11-15T03:00:00Z");
const big = generateDataset(defaultConfig({ anchor }));
const small = generateDataset(
  defaultConfig({ anchor, taskCount: 60, dataset: 7 }),
);

const nodes = (ds: PerfDataset) =>
  ds.tasks.map((t) => ({
    id: t.id,
    parentId: t.parentIndex === null ? null : ds.tasks[t.parentIndex].id,
    depth: t.depth,
  }));

describe("generateDataset: số lượng theo E0-7", () => {
  it("mặc định 2.000 task, 3 cấp 400/800/800", () => {
    expect(big.tasks).toHaveLength(2000);
    const byDepth = [1, 2, 3].map(
      (d) => big.tasks.filter((t) => t.depth === d).length,
    );
    expect(byDepth).toEqual([400, 800, 800]);
    expect(levelSizes(60)).toEqual([12, 24, 24]);
  });

  it("≥ 500 quan hệ đủ 4 kiểu, ≥ 1.000 lượt gắn nhãn, ≥ 10 người phụ trách", () => {
    expect(big.relations.length).toBeGreaterThanOrEqual(500);
    expect(new Set(big.relations.map((r) => r.kind))).toEqual(
      new Set(["blocks", "precedes", "relates", "duplicates"]),
    );
    expect(big.taskLabels.length).toBeGreaterThanOrEqual(1000);
    expect(big.labels).toHaveLength(LABEL_NAMES.length);
    const assignees = new Set(big.tasks.map((t) => t.assignee).filter(Boolean));
    expect(assignees.size).toBeGreaterThanOrEqual(10);
  });

  it("có task trễ hạn, task done có completed_at trong quá khứ, task chưa done không có", () => {
    const today = "2026-11-15";
    const done = big.tasks.filter((t) => statusCategory(t.status) === "done");
    const overdue = big.tasks.filter(
      (t) =>
        statusCategory(t.status) !== "done" &&
        t.dueDate !== null &&
        t.dueDate < today,
    );
    expect(done.length).toBeGreaterThan(100);
    expect(overdue.length).toBeGreaterThan(100);
    for (const t of big.tasks) {
      if (statusCategory(t.status) === "done") {
        expect(t.completedAt).not.toBeNull();
        expect(Date.parse(t.completedAt as string)).toBeLessThan(
          anchor.getTime(),
        );
        expect(Date.parse(t.completedAt as string)).toBeGreaterThan(
          Date.parse(t.createdAt),
        );
      } else {
        expect(t.completedAt).toBeNull();
      }
    }
  });

  it("tiêu đề tiếng Việt có dấu, đa dạng; từ khóa đo tìm kiếm có kết quả", () => {
    expect(new Set(big.tasks.map((t) => t.title)).size).toBe(2000);
    const verbs = new Set(big.tasks.map((t) => t.title.split(" ")[0]));
    expect(verbs.size).toBeGreaterThan(8);
    expect(
      big.tasks.filter((t) => /[đươăâêô]/.test(t.title)).length,
    ).toBeGreaterThan(1500);
    expect(
      big.tasks.some((t) => t.title.includes(SEARCH_QUERIES.accented)),
    ).toBe(true);
  });

  it("ngày hợp lệ (BR-13) và người phụ trách không phải Người xem", () => {
    for (const t of big.tasks) {
      if (t.startDate && t.dueDate) expect(t.startDate <= t.dueDate).toBe(true);
      expect(t.assignee).not.toBe("viewer");
    }
  });

  it("tất định: cùng cấu hình thì cùng dữ liệu; dataset khác thì id khác", () => {
    const again = generateDataset(defaultConfig({ anchor }));
    expect(again).toEqual(big);
    expect(small.projectId).not.toBe(big.projectId);
    expect(small.tasks[0].id).not.toBe(big.tasks[0].id);
  });
});

describe("generateDataset: hợp lệ theo trigger", () => {
  it("cây đúng 3 cấp, depth khớp cha (E2-4)", () => {
    expect(treeErrors(nodes(big))).toEqual([]);
    expect(treeErrors(nodes(small))).toEqual([]);
  });

  it("task done không còn con mở (BR-04)", () => {
    const rows = big.tasks.map((t) => ({
      id: t.id,
      parentId: t.parentIndex === null ? null : big.tasks[t.parentIndex].id,
      done: statusCategory(t.status) === "done",
    }));
    expect(openChildrenOfDone(rows)).toEqual([]);
  });

  it("blocks + precedes không vòng (BR-05), không trùng quan hệ", () => {
    const edges = big.relations.map((r) => ({
      from: big.tasks[r.from].id,
      to: big.tasks[r.to].id,
      kind: r.kind,
    }));
    expect(hasDependencyCycle(edges)).toBe(false);
    const keys = big.relations.map((r) =>
      r.kind === "relates"
        ? `r:${r.from}:${r.to}`
        : `${r.kind}:${r.from}:${r.to}`,
    );
    expect(new Set(keys).size).toBe(keys.length);
    for (const r of big.relations) {
      expect(r.from).not.toBe(r.to);
      if (r.kind !== "precedes") expect(r.lagDays).toBe(0);
    }
  });

  it("assertDatasetValid chấp nhận dữ liệu sinh ra", () => {
    expect(() => assertDatasetValid(big)).not.toThrow();
  });

  it("trạng thái và loại thuộc danh sách mặc định E2-3", () => {
    const names = new Set(DEFAULT_STATUSES.map((s) => s.name));
    for (const t of big.tasks) expect(names.has(t.status)).toBe(true);
  });
});

describe("hàm kiểm (phải bắt được lỗi)", () => {
  it("treeErrors bắt depth sai, cha thiếu, vượt 3 cấp", () => {
    expect(treeErrors([{ id: "a", parentId: null, depth: 2 }])).toHaveLength(1);
    expect(
      treeErrors([
        { id: "a", parentId: null, depth: 1 },
        { id: "b", parentId: "a", depth: 3 },
      ]),
    ).toHaveLength(1);
    expect(treeErrors([{ id: "b", parentId: "x", depth: 2 }])).toHaveLength(1);
    expect(
      treeErrors([{ id: "a", parentId: null, depth: 4 }]).length,
    ).toBeGreaterThan(0);
  });

  it("hasDependencyCycle bắt vòng qua blocks + precedes, bỏ qua relates/duplicates", () => {
    expect(
      hasDependencyCycle([
        { from: "a", to: "b", kind: "blocks" },
        { from: "b", to: "c", kind: "precedes" },
        { from: "c", to: "a", kind: "blocks" },
      ]),
    ).toBe(true);
    expect(
      hasDependencyCycle([
        { from: "a", to: "b", kind: "blocks" },
        { from: "b", to: "a", kind: "relates" },
        { from: "b", to: "a", kind: "duplicates" },
      ]),
    ).toBe(false);
  });

  it("openChildrenOfDone bắt cha done có con mở", () => {
    expect(
      openChildrenOfDone([
        { id: "p", parentId: null, done: true },
        { id: "c", parentId: "p", done: false },
      ]),
    ).toEqual(["p"]);
  });

  it("assertDatasetValid từ chối dữ liệu có vòng", () => {
    const bad: PerfDataset = {
      ...small,
      relations: [
        { from: 1, to: 2, kind: "blocks", lagDays: 0 },
        { from: 2, to: 1, kind: "precedes", lagDays: 0 },
      ],
    };
    expect(() => assertDatasetValid(bad)).toThrow(/vòng/);
  });
});

describe("định danh và tài khoản giả", () => {
  it("UUID cố định đúng định dạng, dự án chính khác dự án thử", () => {
    expect(perfUuid(0, 1, 255)).toBe("9e7f0000-0001-4000-8000-0000000000ff");
    expect(projectId(0)).toBe("9e7f0000-0000-4000-8000-000000000000");
    expect(projectId(0xabcd)).toBe("9e7fabcd-0000-4000-8000-000000000000");
  });

  it("1 PM, 10 Thành viên, 1 Người xem; email @example.com, không trùng persona db-seed", () => {
    const users = perfUsers({ dataset: 0, memberCount: 10 });
    expect(users.map((u) => u.role)).toEqual([
      "pm",
      ...Array(10).fill("member"),
      "viewer",
    ]);
    for (const u of users)
      expect(u.email).toMatch(/^perf-[a-z0-9]+@example\.com$/);
    expect(users.map((u) => u.email)).not.toContain("pm@example.com");
    expect(perfUsers({ dataset: 0xab, memberCount: 1 })[0].email).toBe(
      "perf-00ab-pm@example.com",
    );
  });

  it("assertConfig từ chối cấu hình sai", () => {
    expect(() => assertConfig(defaultConfig({ taskCount: 3 }))).toThrow();
    expect(() => assertConfig(defaultConfig({ dataset: -1 }))).toThrow();
    expect(() => assertConfig(defaultConfig({ labelCount: 99 }))).toThrow();
  });

  it("PRNG tất định", () => {
    const a = createRng(1);
    const b = createRng(1);
    expect([a.next(), a.next()]).toEqual([b.next(), b.next()]);
  });
});
