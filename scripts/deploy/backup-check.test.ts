import { describe, expect, it } from "vitest";
import { evaluateBackups } from "./backup-check";

const now = Date.parse("2026-11-18T10:00:00Z");
const opts = { now, maxAgeHours: 26 };

describe("evaluateBackups", () => {
  it("đạt khi có bản COMPLETED trong 26 giờ", () => {
    const json = JSON.stringify({
      pitr_enabled: false,
      backups: [
        { status: "COMPLETED", inserted_at: "2026-11-16T02:00:00Z" },
        { status: "COMPLETED", inserted_at: "2026-11-18T02:00:00Z" },
      ],
    });
    expect(evaluateBackups(json, opts)).toMatchObject({
      ok: true,
      message: expect.stringContaining("8.0 giờ"),
    });
  });

  it("đạt khi bật PITR", () => {
    expect(
      evaluateBackups(JSON.stringify({ pitr_enabled: true, backups: [] }), opts)
        .ok,
    ).toBe(true);
  });

  it("đỏ khi bản mới nhất quá cũ hoặc chưa hoàn tất", () => {
    const old = JSON.stringify({
      backups: [
        { status: "COMPLETED", inserted_at: "2026-11-16T02:00:00Z" },
        { status: "FAILED", inserted_at: "2026-11-18T02:00:00Z" },
      ],
    });
    expect(evaluateBackups(old, opts)).toMatchObject({
      ok: false,
      message: expect.stringContaining("vượt 26 giờ"),
    });
  });

  it("đỏ (không đoán) khi danh sách rỗng, JSON hỏng hoặc sai dạng", () => {
    expect(
      evaluateBackups(JSON.stringify({ backups: [] }), opts).message,
    ).toMatch(/BACKUP_STRATEGY=manual/);
    expect(evaluateBackups("not json", opts).ok).toBe(false);
    expect(evaluateBackups(JSON.stringify({ x: 1 }), opts).message).toMatch(
      /không có danh sách/,
    );
  });

  it("chấp nhận mảng trực tiếp và trường created_at", () => {
    const json = JSON.stringify([
      { status: "completed", created_at: "2026-11-18T09:00:00Z" },
    ]);
    expect(evaluateBackups(json, opts).ok).toBe(true);
  });
});
