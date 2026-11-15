/**
 * Đo độ trễ các API chính trên dự án perf (Story E0-7, QLDA-50; NFR-02, NFR-16).
 *
 *   make perf-seed && make perf
 *
 * - Gọi API qua HTTP thật (proxy.ts, getUser, RLS, giới hạn tần suất) bằng phiên cookie của PM perf
 *   (perf-pm@example.com, mật khẩu SEED_PASSWORD), giống trình duyệt.
 * - Mỗi API: PERF_WARMUP lần khởi động (mặc định 10, không tính) rồi PERF_ITERATIONS lần đo
 *   (mặc định 100), tuần tự từng request. In bảng P50/P95/P99; thoát 1 nếu có API vượt ngưỡng P95
 *   (scripts/perf/stats.ts), 2 nếu lỗi chuẩn bị/gọi API.
 * - PERF_BASE_URL có thì đo ứng dụng đang chạy ở đó; không có thì tự bật `next start` (bản build
 *   của `make perf`) ở cổng PERF_PORT (mặc định 3200) rồi tắt khi xong.
 * - API giới hạn 300 request/phút/người dùng (E0-5). Gặp 429 thì chờ Retry-After rồi đo lại; lần
 *   429 không tính vào mẫu và được ghi trong bảng.
 * - PERF_JSON_OUT=<tệp> ghi thêm kết quả dạng JSON.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { createServerClient } from "@supabase/ssr";
import { readSeedPassword } from "../seed-local-users.ts";
import {
  SEARCH_QUERIES,
  defaultConfig,
  generateDataset,
  isoDate,
  perfUsers,
  projectId as perfProjectId,
} from "./dataset.ts";
import { readPerfStack } from "./local.ts";
import { readTaskCount } from "./seed.ts";
import {
  evaluate,
  exitCode,
  formatTable,
  readThresholds,
  type EndpointKey,
  type EndpointResult,
} from "./stats.ts";

export function readCount(
  env: Record<string, string | undefined>,
  name: string,
  fallback: number,
  min: number,
): number {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > 100_000) {
    throw new Error(`${name} phải là số nguyên ≥ ${min}.`);
  }
  return n;
}

/** Hũ cookie tối giản: nhận Set-Cookie của server, gửi lại header Cookie. */
class Jar {
  private readonly map = new Map<string, string>();
  set(name: string, value: string, remove = false) {
    if (remove || value === "") this.map.delete(name);
    else this.map.set(name, value);
  }
  getAll() {
    return [...this.map].map(([name, value]) => ({ name, value }));
  }
  absorb(res: Response) {
    for (const line of res.headers.getSetCookie()) {
      const [pair, ...attrs] = line.split(";");
      const eq = pair.indexOf("=");
      if (eq < 0) continue;
      const remove = attrs.some((a) => /^\s*max-age=0\s*$/i.test(a));
      this.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim(), remove);
    }
  }
  header() {
    return this.getAll()
      .map((c) => `${c.name}=${c.value}`)
      .join("; ");
  }
}

async function signIn(
  apiUrl: string,
  anonKey: string,
  email: string,
  password: string,
): Promise<Jar> {
  const jar = new Jar();
  const client = createServerClient(apiUrl, anonKey, {
    cookies: {
      getAll: () => jar.getAll(),
      setAll: (list) =>
        list.forEach((c) => jar.set(c.name, c.value, c.options?.maxAge === 0)),
    },
  });
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) {
    throw new Error(
      `Không đăng nhập được ${email} (${error.message}). Đã chạy make perf-seed với cùng SEED_PASSWORD chưa?`,
    );
  }
  return jar;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class Http {
  throttled = 0;
  private readonly base: string;
  private readonly jar: Jar;
  constructor(base: string, jar: Jar) {
    this.base = base;
    this.jar = jar;
  }

  /** GET và đo thời gian tới khi đọc xong thân phản hồi. 429: chờ rồi thử lại (không tính). */
  async get(
    path: string,
  ): Promise<{ ms: number; status: number; body: unknown }> {
    for (;;) {
      const t0 = performance.now();
      const res = await fetch(this.base + path, {
        headers: { cookie: this.jar.header(), accept: "application/json" },
        redirect: "manual",
      });
      const text = await res.text();
      const ms = performance.now() - t0;
      this.jar.absorb(res);
      if (res.status === 429) {
        this.throttled++;
        const wait = Number(res.headers.get("retry-after") ?? "5");
        await sleep(
          (Number.isFinite(wait) && wait > 0 ? wait : 5) * 1000 + 250,
        );
        continue;
      }
      let body: unknown = null;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        body = text.slice(0, 200);
      }
      return { ms, status: res.status, body };
    }
  }

  async json<T>(path: string): Promise<T> {
    const r = await this.get(path);
    if (r.status !== 200) {
      throw new Error(
        `GET ${path} trả ${r.status}: ${JSON.stringify(r.body).slice(0, 200)}`,
      );
    }
    return r.body as T;
  }
}

interface Endpoint {
  key: EndpointKey;
  label: string;
  path: string;
  /** Kiểm phản hồi lần đầu (dữ liệu đúng như mong đợi), để không đo nhầm một trang rỗng. */
  check?: (body: unknown) => string | null;
}

type ListBody = {
  data: { id: string; assignee_id: string | null }[];
  next_cursor: string | null;
};

const nonEmptyList = (body: unknown) =>
  Array.isArray((body as ListBody)?.data) && (body as ListBody).data.length > 0
    ? null
    : "danh sách rỗng";

async function prepareEndpoints(
  http: Http,
  pid: string,
  taskCount: number,
): Promise<Endpoint[]> {
  const tasksPath = `/api/v1/projects/${pid}/tasks`;
  // Dự án phải có đủ dữ liệu (đã chạy make perf-seed).
  const project = await http.json<{ data: { task_count: number } }>(
    `/api/v1/projects/${pid}`,
  );
  if (project.data.task_count < taskCount) {
    throw new Error(
      `Dự án perf chỉ có ${project.data.task_count} task (cần ${taskCount}). Chạy make perf-seed.`,
    );
  }

  // Duyệt hết danh sách (kiêm khởi động) để lấy con trỏ của trang giữa.
  const cursors: string[] = [];
  let cursor: string | null = null;
  const assigneeCount = new Map<string, number>();
  do {
    const page: ListBody = await http.json<ListBody>(
      `${tasksPath}?limit=50${cursor ? `&cursor=${cursor}` : ""}`,
    );
    for (const t of page.data) {
      if (t.assignee_id)
        assigneeCount.set(
          t.assignee_id,
          (assigneeCount.get(t.assignee_id) ?? 0) + 1,
        );
    }
    cursor = page.next_cursor;
    if (cursor) cursors.push(cursor);
  } while (cursor);
  if (cursors.length < 2)
    throw new Error("Dự án perf quá ít task để có trang giữa.");
  const middle = cursors[Math.floor(cursors.length / 2)];

  const statuses = await http.json<{
    data: { id: string; category: string }[];
  }>(`/api/v1/projects/${pid}/statuses`);
  const openStatusIds = statuses.data
    .filter((s) => s.category !== "done")
    .map((s) => s.id);
  const labels = await http.json<{ data: { id: string }[] }>(
    `/api/v1/projects/${pid}/labels`,
  );
  const assignee = [...assigneeCount].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (!assignee || labels.data.length === 0 || openStatusIds.length === 0) {
    throw new Error(
      "Thiếu người phụ trách, nhãn hoặc trạng thái mở để đo lọc kết hợp.",
    );
  }
  const dueBefore = isoDate(Date.now() + 60 * 86_400_000);
  const filter = new URLSearchParams({
    assignee_id: assignee,
    status_id: openStatusIds.join(","),
    label_id: labels.data[0].id,
    due_before: dueBefore,
  });

  // Task có nhiều quan hệ nhất theo bộ dữ liệu tất định (cùng cấu hình với perf-seed).
  const ds = generateDataset(
    defaultConfig({ taskCount, relationCount: Math.ceil(taskCount * 0.3) }),
  );
  const degree = new Map<number, number>();
  for (const r of ds.relations) {
    degree.set(r.from, (degree.get(r.from) ?? 0) + 1);
    degree.set(r.to, (degree.get(r.to) ?? 0) + 1);
  }
  const busiest = [...degree].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
  const taskIdValue = ds.tasks[busiest].id;

  const q = (s: string) => encodeURIComponent(s);
  return [
    {
      key: "projects_list",
      label: "GET /projects (danh sách dự án + project_stats)",
      path: "/api/v1/projects",
      check: nonEmptyList,
    },
    {
      key: "project_detail",
      label: "GET /projects/{id} (project_stats 2.000 task)",
      path: `/api/v1/projects/${pid}`,
    },
    {
      key: "tasks_first_page",
      label: "GET /projects/{id}/tasks trang đầu",
      path: tasksPath,
      check: nonEmptyList,
    },
    {
      key: "tasks_middle_page",
      label: "GET /projects/{id}/tasks trang giữa (cursor)",
      path: `${tasksPath}?cursor=${middle}`,
      check: nonEmptyList,
    },
    {
      key: "tasks_search_accented",
      label: `GET .../tasks?q=${SEARCH_QUERIES.accented}`,
      path: `${tasksPath}?q=${q(SEARCH_QUERIES.accented)}`,
      check: nonEmptyList,
    },
    {
      key: "tasks_search_plain",
      label: `GET .../tasks?q=${SEARCH_QUERIES.plain}`,
      path: `${tasksPath}?q=${q(SEARCH_QUERIES.plain)}`,
      check: nonEmptyList,
    },
    {
      key: "tasks_filter_combined",
      label: "GET .../tasks lọc người phụ trách + trạng thái + nhãn + hạn",
      path: `${tasksPath}?${filter}`,
    },
    {
      key: "task_detail",
      label: "GET /tasks/{id}",
      path: `/api/v1/tasks/${taskIdValue}`,
    },
    {
      key: "task_relations",
      label: "GET /tasks/{id}/relations",
      path: `/api/v1/tasks/${taskIdValue}/relations`,
      check: nonEmptyList,
    },
  ];
}

async function measure(
  http: Http,
  endpoints: readonly Endpoint[],
  warmup: number,
  iterations: number,
): Promise<EndpointResult[]> {
  const results: EndpointResult[] = [];
  for (const ep of endpoints) {
    const before = http.throttled;
    const first = await http.get(ep.path);
    if (first.status !== 200) {
      throw new Error(
        `${ep.label}: trả ${first.status} ${JSON.stringify(first.body).slice(0, 200)}`,
      );
    }
    const problem = ep.check?.(first.body);
    if (problem) throw new Error(`${ep.label}: ${problem}`);
    for (let i = 1; i < warmup; i++) await http.get(ep.path);
    const samples: number[] = [];
    for (let i = 0; i < iterations; i++) {
      const r = await http.get(ep.path);
      if (r.status !== 200)
        throw new Error(`${ep.label}: lần ${i + 1} trả ${r.status}`);
      samples.push(r.ms);
    }
    results.push({
      key: ep.key,
      label: ep.label,
      samples,
      throttled: http.throttled - before,
    });
    process.stdout.write(".");
  }
  process.stdout.write("\n");
  return results;
}

async function startServer(port: number): Promise<ChildProcess> {
  const child = spawn("pnpm", ["exec", "next", "start", "-p", String(port)], {
    stdio: ["ignore", "ignore", "inherit"],
    env: process.env,
    detached: true,
  });
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null)
      throw new Error("next start thoát sớm. Đã chạy `pnpm build`?");
    try {
      await fetch(`http://127.0.0.1:${port}/login`, { redirect: "manual" });
      return child;
    } catch {
      await sleep(500);
    }
  }
  stopServer(child);
  throw new Error(`next start không sẵn sàng sau 60 giây ở cổng ${port}.`);
}

function stopServer(child: ChildProcess) {
  if (child.pid && child.exitCode === null) {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      child.kill("SIGTERM");
    }
  }
}

async function main(): Promise<number> {
  const env = process.env;
  const thresholds = readThresholds(env);
  const warmup = readCount(env, "PERF_WARMUP", 10, 1);
  const iterations = readCount(env, "PERF_ITERATIONS", 100, 1);
  const taskCount = readTaskCount(env);
  const password = readSeedPassword(env);
  const stack = readPerfStack();
  const pm = perfUsers({ dataset: 0, memberCount: 10 })[0];
  const pid = perfProjectId(0);

  let server: ChildProcess | null = null;
  let base = env.PERF_BASE_URL?.replace(/\/$/, "");
  if (!base) {
    const port = readCount(env, "PERF_PORT", 3200, 1);
    console.log(`Bật next start ở cổng ${port}...`);
    server = await startServer(port);
    base = `http://127.0.0.1:${port}`;
  }
  try {
    const jar = await signIn(stack.apiUrl, stack.anonKey, pm.email, password);
    const http = new Http(base, jar);
    const endpoints = await prepareEndpoints(http, pid, taskCount);
    console.log(
      `Đo ${endpoints.length} API trên ${base} (dự án ${taskCount} task), khởi động ${warmup}, đo ${iterations} lần mỗi API, tuần tự...`,
    );
    const t0 = performance.now();
    const results = await measure(http, endpoints, warmup, iterations);
    const evaluation = evaluate(results, thresholds);
    console.log(formatTable(evaluation.rows));
    console.log(
      `\nThời gian đo: ${((performance.now() - t0) / 1000).toFixed(1)} s; 429 do giới hạn tần suất: ${http.throttled}.`,
    );
    if (env.PERF_JSON_OUT) {
      writeFileSync(
        env.PERF_JSON_OUT,
        JSON.stringify(
          { base, taskCount, warmup, iterations, rows: evaluation.rows },
          null,
          2,
        ),
      );
    }
    if (!evaluation.ok) {
      const bad = evaluation.rows.filter((r) => !r.ok).map((r) => r.key);
      console.error(`VƯỢT ngưỡng P95: ${bad.join(", ")}`);
    } else {
      console.log("Mọi API đạt ngưỡng P95.");
    }
    return exitCode(evaluation);
  } finally {
    if (server) stopServer(server);
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().then(
    (code) => process.exit(code),
    (err: unknown) => {
      console.error(err instanceof Error ? err.message : err);
      process.exit(2);
    },
  );
}
