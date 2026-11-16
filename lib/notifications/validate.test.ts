import { describe, expect, it } from "vitest";
import {
  encodeNotificationCursor,
  validateEmptyBody,
  validateNoParams,
  validateNotificationListQuery,
} from "./validate";
import { notificationHref } from "./model";

const q = (s: string) => validateNotificationListQuery(new URLSearchParams(s));

describe("validateNotificationListQuery", () => {
  it("mặc định: 20 dòng, tất cả, không con trỏ", () => {
    expect(q("")).toEqual({
      ok: true,
      data: { limit: 20, cursor: null, unread: false },
    });
  });

  it("nhận unread=true|false, limit 1..50, con trỏ hợp lệ", () => {
    const cursor = encodeNotificationCursor({
      created_at: "2026-11-16T01:02:03.123456+00:00",
      id: "00000000-0000-0000-0000-0000000000AA",
    });
    expect(q(`unread=true&limit=50&cursor=${cursor}`)).toEqual({
      ok: true,
      data: {
        limit: 50,
        unread: true,
        cursor: {
          created_at: "2026-11-16T01:02:03.123456+00:00",
          id: "00000000-0000-0000-0000-0000000000aa",
        },
      },
    });
    expect(q("unread=false")).toMatchObject({
      ok: true,
      data: { unread: false },
    });
  });

  it("từ chối giá trị sai, tham số lặp và trường lạ", () => {
    for (const bad of [
      "limit=0",
      "limit=51",
      "limit=abc",
      "unread=1",
      "cursor=!!",
      "unread=true&unread=false",
    ]) {
      expect(q(bad).ok, bad).toBe(false);
    }
    expect(q("user_id=x")).toEqual({
      ok: false,
      details: [{ field: "user_id", issue: "unknown_field" }],
    });
  });
});

describe("validateNoParams / validateEmptyBody", () => {
  it("không nhận tham số nào", () => {
    expect(validateNoParams(new URLSearchParams("")).ok).toBe(true);
    expect(validateNoParams(new URLSearchParams("a=1")).ok).toBe(false);
  });

  it("thân rỗng hoặc {} hợp lệ; trường lạ, JSON hỏng, sai kiểu nội dung: lỗi", () => {
    expect(validateEmptyBody("", null).ok).toBe(true);
    expect(validateEmptyBody("{}", "application/json").ok).toBe(true);
    expect(validateEmptyBody('{"read":true}', "application/json")).toEqual({
      ok: false,
      details: [{ field: "read", issue: "unknown_field" }],
    });
    expect(validateEmptyBody("{", "application/json").ok).toBe(false);
    expect(validateEmptyBody("[]", "application/json").ok).toBe(false);
    expect(validateEmptyBody("{}", "text/plain").ok).toBe(false);
  });
});

describe("notificationHref", () => {
  it("dẫn tới ngăn chi tiết task", () => {
    expect(notificationHref({ project_id: "p1", task_id: "t1" })).toBe(
      "/projects/p1/tasks/t1",
    );
  });
});
