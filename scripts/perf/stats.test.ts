import { describe, expect, it } from "vitest";
import {
  DEFAULT_P95_MS,
  ENDPOINT_KEYS,
  evaluate,
  exitCode,
  formatTable,
  percentile,
  readThresholds,
  summarize,
  type EndpointResult,
} from "./stats";

const range = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

describe("percentile (nearest-rank)", () => {
  it("1..100: P50 = 50, P95 = 95, P99 = 99, P100 = 100", () => {
    const s = range(100);
    expect(percentile(s, 50)).toBe(50);
    expect(percentile(s, 95)).toBe(95);
    expect(percentile(s, 99)).toBe(99);
    expect(percentile(s, 100)).toBe(100);
  });

  it("không phụ thuộc thứ tự mẫu, không sửa mảng gốc", () => {
    const s = [5, 1, 4, 2, 3];
    expect(percentile(s, 50)).toBe(3);
    expect(s).toEqual([5, 1, 4, 2, 3]);
  });

  it("ít mẫu: P95 của 10 mẫu là mẫu lớn nhất", () => {
    expect(percentile(range(10), 95)).toBe(10);
    expect(percentile([7], 99)).toBe(7);
  });

  it("từ chối mảng rỗng và phân vị sai", () => {
    expect(() => percentile([], 95)).toThrow();
    expect(() => percentile([1], 0)).toThrow();
    expect(() => percentile([1], 101)).toThrow();
  });

  it("summarize", () => {
    expect(summarize([10, 20, 30, 40])).toEqual({
      count: 4,
      p50: 20,
      p95: 40,
      p99: 40,
      max: 40,
      mean: 25,
    });
  });
});

describe("readThresholds", () => {
  it("mặc định: danh sách task 500 ms theo NFR-02", () => {
    const t = readThresholds({});
    expect(t).toEqual(DEFAULT_P95_MS);
    for (const k of ENDPOINT_KEYS.filter((k) => k.startsWith("tasks_"))) {
      expect(t[k]).toBe(500);
    }
  });

  it("PERF_P95_MS áp cho mọi API, PERF_THRESHOLDS ghi đè từng API", () => {
    const t = readThresholds({
      PERF_P95_MS: "200",
      PERF_THRESHOLDS: "task_detail=50, tasks_first_page=80",
    });
    expect(t.projects_list).toBe(200);
    expect(t.task_detail).toBe(50);
    expect(t.tasks_first_page).toBe(80);
  });

  it("báo lỗi khóa lạ hoặc giá trị sai, không lặng lẽ bỏ qua", () => {
    expect(() => readThresholds({ PERF_THRESHOLDS: "khong_co=1" })).toThrow(
      /PERF_THRESHOLDS/,
    );
    expect(() =>
      readThresholds({ PERF_THRESHOLDS: "task_detail=abc" }),
    ).toThrow();
    expect(() => readThresholds({ PERF_P95_MS: "-5" })).toThrow();
    expect(() => readThresholds({ PERF_P95_MS: "0" })).toThrow();
  });
});

describe("evaluate + exitCode: make perf đỏ khi vượt ngưỡng", () => {
  const result = (
    key: EndpointResult["key"],
    samples: number[],
  ): EndpointResult => ({
    key,
    label: key,
    samples,
    throttled: 0,
  });

  it("mọi P95 dưới ngưỡng: thoát 0", () => {
    const e = evaluate(
      [result("tasks_first_page", range(100))],
      DEFAULT_P95_MS,
    );
    expect(e.ok).toBe(true);
    expect(exitCode(e)).toBe(0);
  });

  it("danh sách task P95 = 500 ms (không dưới 500): thoát 1", () => {
    const samples = [...Array(94).fill(100), ...Array(6).fill(500)];
    const e = evaluate(
      [
        result("projects_list", range(100)),
        result("tasks_search_plain", samples),
      ],
      DEFAULT_P95_MS,
    );
    expect(e.rows.map((r) => r.ok)).toEqual([true, false]);
    expect(e.ok).toBe(false);
    expect(exitCode(e)).toBe(1);
  });

  it("chỉ vài mẫu chậm (dưới 5%) thì P95 vẫn đạt", () => {
    const samples = [...Array(96).fill(100), ...Array(4).fill(5000)];
    expect(
      evaluate([result("tasks_middle_page", samples)], DEFAULT_P95_MS).ok,
    ).toBe(true);
  });

  it("không có kết quả nào thì không coi là đạt", () => {
    expect(exitCode(evaluate([], DEFAULT_P95_MS))).toBe(1);
  });

  it("bảng Markdown ghi rõ VƯỢT và số lần 429", () => {
    const e = evaluate(
      [{ ...result("task_detail", [400, 400]), throttled: 2 }],
      DEFAULT_P95_MS,
    );
    const table = formatTable(e.rows);
    expect(table).toContain("| P95 (ms) |");
    expect(table).toContain("VƯỢT (2 lần 429)");
  });
});
