import { describe, expect, it } from "vitest";
import { categoryCounts, share, toDashboard, type DashboardRow } from "./model";

const row: DashboardRow = {
  project_id: "00000000-0000-4000-8000-000000000001",
  today: "2026-11-16",
  total: 3,
  done: 1,
  open: 2,
  todo: 1,
  in_progress: 1,
  overdue: 1,
  open_no_due: 0,
  blocked: 0,
  by_status: [],
  by_type: [],
  by_priority: [],
  by_assignee: [],
  overdue_tasks: [],
};

describe("toDashboard", () => {
  it("gắn % hoàn thành theo cùng công thức với danh sách dự án (làm tròn)", () => {
    expect(toDashboard(row).completion_percent).toBe(33);
    expect(toDashboard({ ...row, done: 2 }).completion_percent).toBe(67);
  });

  it("dự án chưa có task: 0%, giữ nguyên các số khác", () => {
    const empty = toDashboard({
      ...row,
      total: 0,
      done: 0,
      open: 0,
      todo: 0,
      in_progress: 0,
      overdue: 0,
    });
    expect(empty.completion_percent).toBe(0);
    expect(empty.total).toBe(0);
    expect(empty.today).toBe("2026-11-16");
  });
});

describe("categoryCounts", () => {
  it("lấy số theo nhóm trạng thái", () => {
    expect(categoryCounts(row)).toEqual({ todo: 1, in_progress: 1, done: 1 });
  });
});

describe("share", () => {
  it("tỉ lệ phần trăm làm tròn, tổng 0 thì 0", () => {
    expect(share(1, 3)).toBe(33);
    expect(share(3, 3)).toBe(100);
    expect(share(0, 0)).toBe(0);
  });
});
