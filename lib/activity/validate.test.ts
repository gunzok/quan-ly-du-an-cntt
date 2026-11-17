import { describe, expect, it } from "vitest";
import {
  ACTIVITY_LIMIT_DEFAULT,
  decodeActivityCursor,
  encodeActivityCursor,
  validateProjectActivityQuery,
  validateTaskActivityQuery,
} from "./validate";

const UUID = "6C1E2A9B-1D2E-4F00-8A00-0123456789AB";
const q = (s: string) => new URLSearchParams(s);

function fieldsOf(result: ReturnType<typeof validateProjectActivityQuery>) {
  return result.ok ? [] : result.details.map((d) => `${d.field}:${d.issue}`);
}

describe("validateProjectActivityQuery", () => {
  it("không tham số: mặc định limit 50, không lọc", () => {
    const r = validateProjectActivityQuery(q(""));
    expect(r).toEqual({
      ok: true,
      data: {
        limit: ACTIVITY_LIMIT_DEFAULT,
        cursor: null,
        actor_id: null,
        from: null,
        to: null,
        entity_type: null,
        action: null,
      },
    });
  });

  it("nhận đủ bộ lọc, uuid về chữ thường", () => {
    const r = validateProjectActivityQuery(
      q(
        `limit=100&actor_id=${UUID}&from=2026-11-01&to=2026-11-01&entity_type=project_member&action=delete`,
      ),
    );
    expect(r.ok && r.data).toMatchObject({
      limit: 100,
      actor_id: UUID.toLowerCase(),
      from: "2026-11-01",
      to: "2026-11-01",
      entity_type: "project_member",
      action: "delete",
    });
  });

  it("từ chối tham số lạ, lặp tham số, sai định dạng", () => {
    expect(fieldsOf(validateProjectActivityQuery(q("sort=asc")))).toEqual([
      "sort:unknown_field",
    ]);
    expect(
      fieldsOf(validateProjectActivityQuery(q("action=create&action=delete"))),
    ).toEqual(["action:invalid_value"]);
    expect(
      fieldsOf(
        validateProjectActivityQuery(
          q(
            "limit=0&actor_id=me&from=2026-02-30&to=17/11/2026&entity_type=label&action=restore&cursor=@@",
          ),
        ),
      ).sort(),
    ).toEqual(
      [
        "limit:invalid_value",
        "cursor:invalid_format",
        "actor_id:invalid_format",
        "from:invalid_format",
        "to:invalid_format",
        "entity_type:invalid_value",
        "action:invalid_value",
      ].sort(),
    );
    for (const limit of ["101", "1000", "-1", "1.5", "abc", ""]) {
      expect(
        fieldsOf(validateProjectActivityQuery(q(`limit=${limit}`))),
      ).toEqual(["limit:invalid_value"]);
    }
  });

  it("from sau to: 400 ở trường to", () => {
    expect(
      fieldsOf(
        validateProjectActivityQuery(q("from=2026-11-18&to=2026-11-17")),
      ),
    ).toEqual(["to:invalid_value"]);
  });
});

describe("validateTaskActivityQuery", () => {
  it("chỉ nhận limit và cursor", () => {
    expect(validateTaskActivityQuery(q("limit=10")).ok).toBe(true);
    const r = validateTaskActivityQuery(q(`actor_id=${UUID}&from=2026-11-01`));
    expect(fieldsOf(r).sort()).toEqual(
      ["actor_id:unknown_field", "from:unknown_field"].sort(),
    );
  });
});

describe("con trỏ nhật ký", () => {
  it("mã hóa rồi giải mã giữ nguyên thời điểm micro giây", () => {
    const cursor = { created_at: "2026-11-17T03:10:00.123456+00:00", id: 42 };
    const raw = encodeActivityCursor(cursor);
    expect(raw).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeActivityCursor(raw)).toEqual(cursor);
  });

  it("từ chối con trỏ giả, chèn bộ lọc", () => {
    const enc = (v: unknown) =>
      Buffer.from(JSON.stringify(v)).toString("base64url");
    for (const raw of [
      enc(["2026-11-17T03:10:00Z"]),
      enc(["2026-11-17T03:10:00Z", "42"]),
      enc(["2026-11-17T03:10:00Z", 0]),
      enc(["2026-11-17T03:10:00Z", 1.5]),
      enc(['2026-11-17T03:10:00Z",id.gt.0', 1]),
      enc(["x", 1]),
      enc({ created_at: "2026-11-17T03:10:00Z", id: 1 }),
      "not base64!",
      "a".repeat(300),
    ]) {
      expect(decodeActivityCursor(raw)).toBeNull();
    }
  });
});
