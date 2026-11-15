/**
 * Test tích hợp Story E0-7 (QLDA-50): script seed hiệu năng trên Supabase cục bộ, bản nhỏ 60 task
 * với dataset ngẫu nhiên (dự án và tài khoản riêng, không đụng dự án perf chính hay persona).
 *
 * Kiểm tiêu chí 1 ("có dự án task phân cấp, quan hệ, nhãn") trên dữ liệu ĐÃ GHI vào CSDL: số
 * lượng, depth do trigger đặt, BR-04, không vòng, chỉ thành viên perf, trigger thật đã chạy
 * (activity_logs), chạy lại không nhân đôi, perf-clean xóa sạch.
 *
 * Chạy: make db-start && make test-integration (cần Supabase CLI: script đọc `supabase status` và
 * chạy psql, có sẵn hoặc trong container CSDL).
 */
import { randomBytes, randomInt } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  defaultConfig,
  hasDependencyCycle,
  openChildrenOfDone,
  perfUsers,
  treeErrors,
  type PerfDatasetConfig,
} from "@/scripts/perf/dataset";
import { readPerfStack, type PerfStack } from "@/scripts/perf/local";
import { cleanPerf, seedPerf, type SeedResult } from "@/scripts/perf/seed";
import { missingIntegrationEnv } from "./env";
import { SERVICE_ROLE_KEY, SUPABASE_URL, assertLocalSupabase } from "./helpers";

const enabled = missingIntegrationEnv().length === 0;

describe.skipIf(!enabled)("Seed hiệu năng E0-7 (Supabase cục bộ)", () => {
  let stack: PerfStack;
  let service: SupabaseClient;
  let config: PerfDatasetConfig;
  let first: SeedResult;
  let second: SeedResult;
  const password = randomBytes(18).toString("base64url");

  beforeAll(async () => {
    assertLocalSupabase();
    stack = readPerfStack();
    service = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    // Dataset 1..0xfffe ngẫu nhiên: hai lần chạy song song (worktree khác) không đụng nhau.
    config = defaultConfig({ dataset: randomInt(1, 0xffff), taskCount: 60 });
    first = await seedPerf(stack, password, config);
    second = await seedPerf(stack, password, config);
  }, 120_000);

  afterAll(async () => {
    if (stack && config) await cleanPerf(stack, config);
  }, 60_000);

  async function projectTasks() {
    const { data, error } = await service
      .from("tasks")
      .select(
        "id, parent_id, depth, completed_at, due_date, assignee_id, task_statuses!inner(category)",
      )
      .eq("project_id", first.dataset.projectId);
    expect(error).toBeNull();
    return (data ?? []) as unknown as {
      id: string;
      parent_id: string | null;
      depth: number;
      completed_at: string | null;
      due_date: string | null;
      assignee_id: string | null;
      task_statuses: { category: string };
    }[];
  }

  it("tạo đủ task 3 cấp, depth do trigger đặt khớp cây", async () => {
    const tasks = await projectTasks();
    expect(tasks).toHaveLength(60);
    expect(first.summary.tasks).toBe(60);
    expect(first.summary.depth).toEqual({ "1": 12, "2": 24, "3": 24 });
    expect(
      treeErrors(
        tasks.map((t) => ({ id: t.id, parentId: t.parent_id, depth: t.depth })),
      ),
    ).toEqual([]);
  });

  it("task done có completed_at, không còn con mở (BR-04); có task trễ hạn", async () => {
    const tasks = await projectTasks();
    for (const t of tasks) {
      expect(t.completed_at !== null).toBe(t.task_statuses.category === "done");
    }
    expect(
      openChildrenOfDone(
        tasks.map((t) => ({
          id: t.id,
          parentId: t.parent_id,
          done: t.task_statuses.category === "done",
        })),
      ),
    ).toEqual([]);
    expect(first.summary.done).toBeGreaterThan(0);
    expect(first.summary.overdue).toBeGreaterThan(0);
  });

  it("quan hệ đủ số lượng, cả 4 kiểu, blocks + precedes không vòng", async () => {
    const ids = (await projectTasks()).map((t) => t.id);
    const { data, error } = await service
      .from("task_relations")
      .select("from_task_id, to_task_id, kind")
      .in("from_task_id", ids);
    expect(error).toBeNull();
    const rels = data ?? [];
    expect(rels).toHaveLength(config.relationCount);
    expect(new Set(rels.map((r) => r.kind)).size).toBe(4);
    expect(
      hasDependencyCycle(
        rels.map((r) => ({
          from: r.from_task_id,
          to: r.to_task_id,
          kind: r.kind,
        })),
      ),
    ).toBe(false);
  });

  it("nhãn của dự án được gắn vào task", async () => {
    expect(first.summary.labels).toBe(config.labelCount);
    expect(first.summary.task_labels).toBe(first.dataset.taskLabels.length);
    expect(first.summary.task_labels).toBeGreaterThanOrEqual(30);
  });

  it("dự án cô lập: chỉ 12 tài khoản perf của bộ dữ liệu, đúng vai trò; người phụ trách thuộc dự án", async () => {
    const { data, error } = await service
      .from("project_members")
      .select("user_id, role")
      .eq("project_id", first.dataset.projectId);
    expect(error).toBeNull();
    const expected = perfUsers(config).map((u) => ({
      user_id: first.userIds[u.key],
      role: u.role,
    }));
    const byUser = (a: { user_id: string }, b: { user_id: string }) =>
      a.user_id.localeCompare(b.user_id);
    expect([...(data ?? [])].sort(byUser)).toEqual([...expected].sort(byUser));

    const memberIds = new Set(
      expected.filter((m) => m.role !== "viewer").map((m) => m.user_id),
    );
    const assignees = new Set(
      (await projectTasks()).map((t) => t.assignee_id).filter(Boolean),
    );
    expect(assignees.size).toBeGreaterThanOrEqual(5);
    for (const a of assignees) expect(memberIds.has(a as string)).toBe(true);
  });

  it("đi qua trigger thật: mỗi task có nhật ký tạo (activity_logs)", async () => {
    const { count, error } = await service
      .from("activity_logs")
      .select("id", { count: "exact", head: true })
      .eq("project_id", first.dataset.projectId)
      .eq("entity_type", "task")
      .eq("action", "create");
    expect(error).toBeNull();
    expect(count).toBe(60);
  });

  it("chạy lại không nhân đôi (idempotent), cùng tài khoản", () => {
    expect(second.summary).toEqual(first.summary);
    expect(second.userIds).toEqual(first.userIds);
  });

  it("perf-clean xóa dự án và tài khoản perf; chạy lại vô hại", async () => {
    const cfg = defaultConfig({
      dataset: randomInt(1, 0xffff),
      taskCount: 6,
      relationCount: 2,
    });
    const r = await seedPerf(stack, password, cfg);
    expect(r.summary.tasks).toBe(6);

    expect(await cleanPerf(stack, cfg)).toEqual({
      deletedUsers: cfg.memberCount + 2,
    });
    const { count } = await service
      .from("projects")
      .select("id", { count: "exact", head: true })
      .eq("id", r.dataset.projectId);
    expect(count).toBe(0);
    const { count: tasks } = await service
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .eq("project_id", r.dataset.projectId);
    expect(tasks).toBe(0);
    expect(await cleanPerf(stack, cfg)).toEqual({ deletedUsers: 0 });
  }, 60_000);
});
