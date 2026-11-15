import { describe, expect, it } from "vitest";
import { perfUsers } from "./dataset";
import {
  assertLocalDbUrl,
  assertPerfEmail,
  parsePerfStatus,
  perfUserPayload,
  supabaseProjectId,
} from "./local";
import { readTaskCount } from "./seed";

const status = (over: Record<string, string> = {}) =>
  JSON.stringify({
    API_URL: "http://127.0.0.1:54321",
    ANON_KEY: "anon",
    SERVICE_ROLE_KEY: "service",
    DB_URL: "postgresql://u:p@127.0.0.1:54322/postgres",
    ...over,
  });

describe("parsePerfStatus: chỉ stack cục bộ", () => {
  it("đọc URL, khóa, DB_URL", () => {
    expect(parsePerfStatus(status())).toMatchObject({
      apiUrl: "http://127.0.0.1:54321",
      anonKey: "anon",
      serviceKey: "service",
    });
  });

  it("từ chối API hoặc CSDL không phải localhost", () => {
    expect(() =>
      parsePerfStatus(status({ API_URL: "https://x.supabase.co" })),
    ).toThrow(/cục bộ/);
    expect(() =>
      parsePerfStatus(
        status({ DB_URL: "postgresql://u:p@db.example.com:5432/postgres" }),
      ),
    ).toThrow(/cục bộ/);
    expect(() => assertLocalDbUrl("không phải url")).toThrow();
  });

  it("thiếu khóa thì báo lỗi", () => {
    expect(() => parsePerfStatus(status({ ANON_KEY: "" }))).toThrow();
    expect(() => parsePerfStatus("{")).toThrow();
  });
});

describe("tài khoản perf", () => {
  it("chỉ chấp nhận email perf, không đụng persona db-seed", () => {
    expect(() => assertPerfEmail("perf-pm@example.com")).not.toThrow();
    expect(() =>
      assertPerfEmail("perf-00ab-member01@example.com"),
    ).not.toThrow();
    for (const email of [
      "pm@example.com",
      "admin@example.com",
      "perf-pm@gmail.com",
    ]) {
      expect(() => assertPerfEmail(email)).toThrow();
    }
  });

  it("payload đánh dấu app_metadata.seed_perf, không có quyền admin", () => {
    const [pm] = perfUsers({ dataset: 0, memberCount: 1 });
    const p = perfUserPayload(pm, "x".repeat(12), 0);
    expect(p.app_metadata).toEqual({ seed_perf: 0 });
    expect(p.email_confirm).toBe(true);
    expect(JSON.stringify(p)).not.toMatch(/is_admin/);
  });
});

describe("cấu hình", () => {
  it("supabaseProjectId đọc project_id trong config.toml", () => {
    expect(supabaseProjectId('# x\nproject_id = "quan-ly-du-an-cntt"\n')).toBe(
      "quan-ly-du-an-cntt",
    );
    expect(() => supabaseProjectId("x = 1")).toThrow();
  });

  it("PERF_TASKS mặc định 2000, kiểm giới hạn", () => {
    expect(readTaskCount({})).toBe(2000);
    expect(readTaskCount({ PERF_TASKS: "60" })).toBe(60);
    expect(() => readTaskCount({ PERF_TASKS: "5" })).toThrow();
    expect(() => readTaskCount({ PERF_TASKS: "abc" })).toThrow();
  });
});
