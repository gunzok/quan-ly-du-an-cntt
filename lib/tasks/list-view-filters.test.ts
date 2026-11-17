import { describe, expect, it } from "vitest";
import {
  decodeTaskCursor,
  encodeTaskCursor,
  validateTaskListQuery,
} from "./validate";

/** E13-2: bộ lọc và sắp xếp mới của GET /api/v1/projects/{id}/tasks (chế độ xem mặc định). */
const UUID = "0b3a3c1e-6f0e-4b7a-9a51-0f6b2f3c4d5e";
const parse = (qs: string) => validateTaskListQuery(new URLSearchParams(qs));

describe("validateTaskListQuery: me, created_by, open, overdue, sort", () => {
  it("nhận me cho assignee_id, created_by; uuid chuẩn hóa chữ thường", () => {
    const r = parse(`assignee_id=me&created_by=${UUID.toUpperCase()}`);
    expect(r.ok && r.data.assignee_id).toBe("me");
    expect(r.ok && r.data.created_by).toBe(UUID);
    const m = parse("created_by=me");
    expect(m.ok && m.data.created_by).toBe("me");
  });

  it("open, overdue chỉ nhận true", () => {
    const r = parse("open=true&overdue=true");
    expect(r.ok && [r.data.open, r.data.overdue]).toEqual([true, true]);
    for (const qs of ["open=false", "open=1", "overdue=", "overdue=TRUE"]) {
      expect(parse(qs).ok, qs).toBe(false);
    }
  });

  it("sort: bốn giá trị; còn lại 400", () => {
    for (const s of [
      "created_at",
      "-created_at",
      "updated_at",
      "-updated_at",
    ]) {
      const r = parse(`sort=${s}`);
      expect(r.ok && r.data.sort).toBe(s);
    }
    for (const s of ["due_date", "-title", "updated_at,id", ""]) {
      expect(parse(`sort=${encodeURIComponent(s)}`).ok, s).toBe(false);
    }
  });

  it("từ chối giá trị sai, tham số lặp", () => {
    const bad = parse("assignee_id=Me&created_by=abc&open=true&open=true");
    expect(bad.ok).toBe(false);
    expect(!bad.ok && bad.details).toEqual(
      expect.arrayContaining([
        { field: "assignee_id", issue: "invalid_format" },
        { field: "created_by", issue: "invalid_format" },
        { field: "open", issue: "invalid_value" },
      ]),
    );
  });

  it("không gửi: kết quả giữ dạng cũ (không có khóa mới)", () => {
    const r = parse("");
    expect(r.ok && Object.keys(r.data)).not.toContain("sort");
    expect(r.ok && Object.keys(r.data)).not.toContain("open");
  });

  it("con trỏ ghi trường sắp xếp; dùng với sort khác trường thì 400", () => {
    const ts = "2026-11-17T01:02:03.456789+00:00";
    const upd = encodeTaskCursor({
      created_at: ts,
      id: UUID,
      field: "updated_at",
    });
    expect(decodeTaskCursor(upd)).toEqual({
      created_at: ts,
      id: UUID,
      field: "updated_at",
    });
    expect(parse(`sort=-updated_at&cursor=${upd}`).ok).toBe(true);
    expect(parse(`sort=updated_at&cursor=${upd}`).ok).toBe(true);
    expect(parse(`cursor=${upd}`).ok).toBe(false);
    const cre = encodeTaskCursor({ created_at: ts, id: UUID });
    expect(parse(`cursor=${cre}`).ok).toBe(true);
    expect(parse(`sort=created_at&cursor=${cre}`).ok).toBe(true);
    expect(parse(`sort=-updated_at&cursor=${cre}`).ok).toBe(false);
    const bogus = Buffer.from(JSON.stringify([ts, UUID, "title"])).toString(
      "base64url",
    );
    expect(decodeTaskCursor(bogus)).toBeNull();
  });
});
