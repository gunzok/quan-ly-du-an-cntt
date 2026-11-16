/**
 * Tính phân vị, ngưỡng và bảng kết quả cho `make perf` (Story E0-7). Hàm thuần để test được.
 *
 * Ngưỡng P95 mặc định (ms), cơ sở:
 *   - Danh sách task mọi biến thể (trang đầu, trang giữa, tìm kiếm, lọc kết hợp): 500 theo NFR-02
 *     ("P95 dưới 500 ms với dự án 2.000 task"). NFR-16 (lọc dưới 1 giây) lỏng hơn nên 500 bao luôn.
 *   - Danh sách dự án, chi tiết dự án (project_stats đếm trên 2.000 task): 500, cũng là "thao tác
 *     thường gặp" của NFR-02.
 *   - Chi tiết task, quan hệ của task: 300. Đọc theo khóa chính và chỉ mục, không quét dự án; đặt
 *     chặt hơn NFR-02 để sớm bắt hồi quy (đề xuất, sếp chỉnh được).
 * Ghi đè: PERF_P95_MS=<ms> cho mọi API, PERF_THRESHOLDS="tasks_first_page=400,task_detail=250".
 */

export const ENDPOINT_KEYS = [
  "projects_list",
  "project_detail",
  "project_dashboard",
  "tasks_first_page",
  "tasks_middle_page",
  "tasks_search_accented",
  "tasks_search_plain",
  "tasks_filter_combined",
  "task_detail",
  "task_relations",
] as const;

export type EndpointKey = (typeof ENDPOINT_KEYS)[number];

export const DEFAULT_P95_MS: Record<EndpointKey, number> = {
  projects_list: 500,
  project_detail: 500,
  project_dashboard: 500,
  tasks_first_page: 500,
  tasks_middle_page: 500,
  tasks_search_accented: 500,
  tasks_search_plain: 500,
  tasks_filter_combined: 500,
  task_detail: 300,
  task_relations: 300,
};

/** Phân vị theo hạng gần nhất (nearest-rank): giá trị nhỏ nhất mà ít nhất p% mẫu không vượt. */
export function percentile(samples: readonly number[], p: number): number {
  if (samples.length === 0) throw new Error("Không có mẫu để tính phân vị.");
  if (!(p > 0 && p <= 100)) throw new Error(`Phân vị không hợp lệ: ${p}`);
  const sorted = [...samples].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.max(0, rank - 1)];
}

export interface Summary {
  count: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
  mean: number;
}

export function summarize(samples: readonly number[]): Summary {
  return {
    count: samples.length,
    p50: percentile(samples, 50),
    p95: percentile(samples, 95),
    p99: percentile(samples, 99),
    max: Math.max(...samples),
    mean: samples.reduce((a, b) => a + b, 0) / samples.length,
  };
}

const positiveMs = (raw: string, name: string): number => {
  const n = Number(raw);
  if (!/^\d+(\.\d+)?$/.test(raw.trim()) || !(n > 0)) {
    throw new Error(`${name} phải là số mili giây dương (nhận "${raw}").`);
  }
  return n;
};

/** Ngưỡng P95 theo API từ biến môi trường (xem đầu tệp). Khóa lạ thì báo lỗi, không bỏ qua. */
export function readThresholds(
  env: Record<string, string | undefined>,
): Record<EndpointKey, number> {
  const out = { ...DEFAULT_P95_MS };
  if (env.PERF_P95_MS) {
    const all = positiveMs(env.PERF_P95_MS, "PERF_P95_MS");
    for (const k of ENDPOINT_KEYS) out[k] = all;
  }
  if (env.PERF_THRESHOLDS) {
    for (const pair of env.PERF_THRESHOLDS.split(",")) {
      if (!pair.trim()) continue;
      const [key, value, ...rest] = pair.split("=").map((s) => s.trim());
      if (
        !(ENDPOINT_KEYS as readonly string[]).includes(key) ||
        value === undefined ||
        rest.length
      ) {
        throw new Error(
          `PERF_THRESHOLDS sai ở "${pair}". Khóa hợp lệ: ${ENDPOINT_KEYS.join(", ")}.`,
        );
      }
      out[key as EndpointKey] = positiveMs(value, `PERF_THRESHOLDS.${key}`);
    }
  }
  return out;
}

export interface EndpointResult {
  key: EndpointKey;
  label: string;
  samples: number[];
  /** Số lần bị 429 (đã chờ Retry-After rồi đo lại, không tính vào mẫu). */
  throttled: number;
}

export interface Evaluated extends Summary {
  key: EndpointKey;
  label: string;
  thresholdMs: number;
  throttled: number;
  ok: boolean;
}

export function evaluate(
  results: readonly EndpointResult[],
  thresholds: Record<EndpointKey, number>,
): { rows: Evaluated[]; ok: boolean } {
  const rows = results.map((r) => {
    const s = summarize(r.samples);
    const thresholdMs = thresholds[r.key];
    return {
      ...s,
      key: r.key,
      label: r.label,
      thresholdMs,
      throttled: r.throttled,
      ok: s.p95 < thresholdMs,
    };
  });
  return { rows, ok: rows.length > 0 && rows.every((r) => r.ok) };
}

/** Mã thoát của `make perf`: 0 khi mọi API đạt ngưỡng P95, 1 khi có API vượt. */
export function exitCode(evaluation: { ok: boolean }): 0 | 1 {
  return evaluation.ok ? 0 : 1;
}

const ms = (v: number) => v.toFixed(1);

/** Bảng Markdown (dán thẳng vào mô tả PR). */
export function formatTable(rows: readonly Evaluated[]): string {
  const head =
    "| API | Số mẫu | P50 (ms) | P95 (ms) | P99 (ms) | Max (ms) | Ngưỡng P95 (ms) | Kết quả |\n" +
    "|---|---:|---:|---:|---:|---:|---:|---|";
  const lines = rows.map(
    (r) =>
      `| ${r.label} | ${r.count} | ${ms(r.p50)} | ${ms(r.p95)} | ${ms(r.p99)} | ${ms(r.max)} | < ${r.thresholdMs} | ${r.ok ? "Đạt" : "VƯỢT"}${r.throttled ? ` (${r.throttled} lần 429)` : ""} |`,
  );
  return [head, ...lines].join("\n");
}
