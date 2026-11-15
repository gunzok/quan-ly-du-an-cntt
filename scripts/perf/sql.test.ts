import { describe, expect, it } from "vitest";
import { defaultConfig, generateDataset } from "./dataset";
import { buildCleanSql, buildSeedSql, lit } from "./sql";

const ds = generateDataset(
  defaultConfig({
    anchor: new Date("2026-11-15T00:00:00Z"),
    taskCount: 60,
    dataset: 3,
  }),
);
const ids = Object.fromEntries(
  ds.users.map((u, i) => [
    u.key,
    `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
  ]),
);
const sql = buildSeedSql(ds, ids);

describe("lit", () => {
  it("thoát dấu nháy, giữ tiếng Việt, null thành NULL", () => {
    expect(lit("O'Brien")).toBe("'O''Brien'");
    expect(lit("Đồng bộ")).toBe("'Đồng bộ'");
    expect(lit(null)).toBe("null");
    expect(lit(3)).toBe("3");
    expect(() => lit(Number.NaN)).toThrow();
    expect(() => lit("a\0b")).toThrow();
  });
});

describe("buildSeedSql", () => {
  it("một giao dịch, dừng khi lỗi", () => {
    expect(sql).toMatch(/^\\set ON_ERROR_STOP on/);
    expect(sql).toContain("begin;");
    expect(sql).toContain("commit;");
  });

  it("không tắt trigger, không xóa hay reset dữ liệu ngoài dự án perf", () => {
    expect(sql).not.toMatch(
      /disable\s+trigger|session_replication_role|truncate|drop\s+table\s+public/i,
    );
    expect(sql).not.toMatch(/\bdelete\b/i);
  });

  it("idempotent: mọi INSERT vào bảng thật có ON CONFLICT DO NOTHING", () => {
    const inserts = sql.match(/insert into public\.[a-z_]+[\s\S]*?;/g) ?? [];
    expect(inserts.length).toBeGreaterThanOrEqual(7);
    for (const stmt of inserts)
      expect(stmt).toMatch(/on conflict[\s\S]*do nothing;$/);
  });

  it("chèn task theo từng cấp 1 → 2 → 3", () => {
    const pos = [1, 2, 3].map((d) => sql.indexOf(`where p.depth = ${d}`));
    expect(pos.every((p) => p > 0)).toBe(true);
    expect(pos).toEqual([...pos].sort((a, b) => a - b));
  });

  it("thành viên dự án chỉ là tài khoản perf (kiểm cô lập trong SQL)", () => {
    expect(sql).toContain("dự án perf có thành viên ngoài bộ tài khoản perf");
    for (const id of Object.values(ids)) expect(sql).toContain(id);
  });

  it("thiếu id tài khoản thì báo lỗi", () => {
    expect(() => buildSeedSql(ds, { pm: ids.pm })).toThrow(/Thiếu id/);
  });
});

describe("buildCleanSql", () => {
  it("chỉ xóa đúng dự án perf, từ chối id lạ", () => {
    const clean = buildCleanSql(ds.projectId);
    expect(clean).toContain(
      `delete from public.projects where id = '${ds.projectId}'::uuid;`,
    );
    expect(clean.match(/delete/g)).toHaveLength(1);
    expect(() => buildCleanSql("x'; drop table public.tasks; --")).toThrow();
  });
});
