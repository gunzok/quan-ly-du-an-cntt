import { describe, expect, it } from "vitest";
import { isSameOrigin, readJsonBody } from "./request";

const URL_ = "http://localhost:3000/api/v1/tasks/x";

describe("isSameOrigin", () => {
  it("chỉ nhận Origin trùng ứng dụng", () => {
    const req = (origin?: string) =>
      new Request(URL_, {
        method: "POST",
        headers: origin ? { origin } : {},
      });
    expect(isSameOrigin(req("http://localhost:3000"))).toBe(true);
    expect(isSameOrigin(req("http://evil.example"))).toBe(false);
    expect(isSameOrigin(req())).toBe(false);
  });
});

describe("readJsonBody", () => {
  const req = (body: string, type = "application/json") =>
    new Request(URL_, {
      method: "POST",
      headers: { "content-type": type },
      body,
    });

  it("đọc JSON hợp lệ", async () => {
    expect(await readJsonBody(req('{"a":1}'), 100)).toEqual({
      ok: true,
      body: { a: 1 },
    });
  });
  it("sai content-type hoặc JSON hỏng: invalid_format", async () => {
    for (const r of [req('{"a":1}', "text/plain"), req("{")]) {
      const out = await readJsonBody(r, 100);
      expect(out.ok).toBe(false);
      if (!out.ok) {
        expect(out.error.details).toEqual([
          { field: "body", issue: "invalid_format" },
        ]);
      }
    }
  });
  it("quá giới hạn byte: too_long", async () => {
    const out = await readJsonBody(
      req(JSON.stringify({ a: "ầ".repeat(40) })),
      100,
    );
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.error.details).toEqual([{ field: "body", issue: "too_long" }]);
    }
  });
});
