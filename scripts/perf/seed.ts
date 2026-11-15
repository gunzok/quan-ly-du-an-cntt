/**
 * Seed dữ liệu hiệu năng (Story E0-7, QLDA-50) vào Supabase CHẠY CỤC BỘ.
 *
 *   make perf-seed    # tạo "[PERF] Dự án 2000 task" (idempotent: chạy lại không nhân đôi)
 *   make perf-clean   # xóa dự án perf và tài khoản perf
 *
 * Biến môi trường:
 *   SEED_PASSWORD  mật khẩu cho tài khoản perf (giống `make db-seed`; không in, không commit).
 *   PERF_TASKS     số task (mặc định 2000).
 *
 * Không reset CSDL, không đụng persona của `make db-seed`: chỉ dự án perf (UUID cố định
 * 9e7f0000-...) và tài khoản perf-...@example.com. Ghi bằng SQL hàng loạt qua psql nhưng đi qua
 * mọi trigger thật. Nhật ký activity_logs của các lần seed/xóa vẫn còn (bảng chỉ thêm, BR-09).
 */
import { pathToFileURL } from "node:url";
import { readSeedPassword } from "../seed-local-users.ts";
import {
  defaultConfig,
  generateDataset,
  hasDependencyCycle,
  openChildrenOfDone,
  perfUsers,
  projectId,
  statusCategory,
  treeErrors,
  type PerfDataset,
  type PerfDatasetConfig,
} from "./dataset.ts";
import {
  deletePerfUsers,
  ensurePerfUsers,
  readPerfStack,
  runSql,
  type PerfStack,
} from "./local.ts";
import { buildCleanSql, buildSeedSql } from "./sql.ts";

export interface SeedSummary {
  tasks: number;
  depth: Record<string, number>;
  members: number;
  labels: number;
  task_labels: number;
  relations: number;
  done: number;
  overdue: number;
}

/** Kiểm bộ dữ liệu sinh ra trước khi ghi (cây 3 cấp, BR-04, không vòng). Lỗi thì ném. */
export function assertDatasetValid(ds: PerfDataset): void {
  const tree = treeErrors(
    ds.tasks.map((t) => ({
      id: t.id,
      parentId: t.parentIndex === null ? null : ds.tasks[t.parentIndex].id,
      depth: t.depth,
    })),
  );
  if (tree.length > 0)
    throw new Error(`Cây task sai: ${tree.slice(0, 3).join("; ")}`);
  const open = openChildrenOfDone(
    ds.tasks.map((t) => ({
      id: t.id,
      parentId: t.parentIndex === null ? null : ds.tasks[t.parentIndex].id,
      done: statusCategory(t.status) === "done",
    })),
  );
  if (open.length > 0)
    throw new Error(`Task done còn con mở: ${open.slice(0, 3).join(", ")}`);
  const edges = ds.relations.map((r) => ({
    from: ds.tasks[r.from].id,
    to: ds.tasks[r.to].id,
    kind: r.kind,
  }));
  if (hasDependencyCycle(edges))
    throw new Error("Quan hệ blocks/precedes có vòng.");
}

export interface SeedResult {
  dataset: PerfDataset;
  userIds: Record<string, string>;
  summary: SeedSummary;
  timings: { usersMs: number; sqlMs: number; totalMs: number };
}

export async function seedPerf(
  stack: PerfStack,
  password: string,
  config: PerfDatasetConfig,
): Promise<SeedResult> {
  const t0 = performance.now();
  const ds = generateDataset(config);
  assertDatasetValid(ds);
  const userIds = await ensurePerfUsers(
    stack,
    ds.users,
    password,
    config.dataset,
  );
  const t1 = performance.now();
  const out = runSql(stack, buildSeedSql(ds, userIds));
  const t2 = performance.now();
  const line = out.trim().split("\n").pop() ?? "";
  let summary: SeedSummary;
  try {
    summary = JSON.parse(line) as SeedSummary;
  } catch {
    throw new Error(
      `Không đọc được số liệu sau khi seed: ${line.slice(0, 200)}`,
    );
  }
  return {
    dataset: ds,
    userIds,
    summary,
    timings: { usersMs: t1 - t0, sqlMs: t2 - t1, totalMs: t2 - t0 },
  };
}

/** Xóa dự án perf rồi tài khoản perf của bộ dữ liệu. */
export async function cleanPerf(
  stack: PerfStack,
  config: Pick<PerfDatasetConfig, "dataset" | "memberCount">,
): Promise<{ deletedUsers: number }> {
  runSql(stack, buildCleanSql(projectId(config.dataset)));
  const deletedUsers = await deletePerfUsers(stack, perfUsers(config));
  return { deletedUsers };
}

export function readTaskCount(env: Record<string, string | undefined>): number {
  const raw = env.PERF_TASKS;
  if (raw === undefined || raw === "") return 2000;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 6 || n > 100_000) {
    throw new Error("PERF_TASKS phải là số nguyên trong [6, 100000].");
  }
  return n;
}

const fmtMs = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

async function main(): Promise<void> {
  const clean = process.argv.includes("--clean");
  const stack = readPerfStack();
  const config = defaultConfig({ taskCount: readTaskCount(process.env) });
  if (clean) {
    const t0 = performance.now();
    const { deletedUsers } = await cleanPerf(stack, config);
    console.log(
      `Đã xóa dự án perf và ${deletedUsers} tài khoản perf (${fmtMs(performance.now() - t0)}).`,
    );
    return;
  }
  const password = readSeedPassword(process.env);
  console.log(
    `Seed dữ liệu hiệu năng vào ${stack.apiUrl} (${config.taskCount} task)...`,
  );
  const r = await seedPerf(stack, password, config);
  const s = r.summary;
  console.log(`Dự án:       ${r.dataset.projectName} (${r.dataset.projectId})`);
  console.log(
    `Thành viên:  ${s.members} (1 PM, ${config.memberCount} Thành viên, 1 Người xem)`,
  );
  console.log(
    `Task:        ${s.tasks} (cấp 1/2/3: ${s.depth["1"] ?? 0}/${s.depth["2"] ?? 0}/${s.depth["3"] ?? 0}; done ${s.done}; trễ hạn ${s.overdue})`,
  );
  console.log(`Nhãn:        ${s.labels} nhãn, ${s.task_labels} lượt gắn`);
  console.log(`Quan hệ:     ${s.relations}`);
  console.log(
    `Thời gian:   tài khoản ${fmtMs(r.timings.usersMs)}, SQL ${fmtMs(r.timings.sqlMs)}, tổng ${fmtMs(r.timings.totalMs)}`,
  );
  console.log(
    `Đăng nhập đo: ${r.dataset.users[0].email} (mật khẩu SEED_PASSWORD).`,
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
