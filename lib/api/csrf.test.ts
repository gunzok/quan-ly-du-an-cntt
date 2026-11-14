import { describe, expect, it } from "vitest";
import { isSameOrigin, isUnsafeMethod, rejectCrossOrigin } from "./csrf";

const url = "http://localhost:3000/api/v1/users/invitations";

function req(method: string, origin?: string) {
  return new Request(url, {
    method,
    headers: origin ? { origin } : {},
  });
}

describe("isSameOrigin", () => {
  // Giữ nguyên hành vi của bản cũ trong lib/admin/users/policy.ts (PR QLDA-36).
  it("chỉ nhận Origin trùng ứng dụng", () => {
    expect(isSameOrigin(req("POST", "http://localhost:3000"))).toBe(true);
    expect(isSameOrigin(req("POST", "https://evil.example"))).toBe(false);
    expect(isSameOrigin(req("POST", "http://localhost:3001"))).toBe(false);
    expect(isSameOrigin(req("POST", "https://localhost:3000"))).toBe(false);
    expect(isSameOrigin(req("POST", "null"))).toBe(false);
    expect(isSameOrigin(req("POST"))).toBe(false);
  });
});

describe("isUnsafeMethod", () => {
  it("POST, PUT, PATCH, DELETE là ghi dữ liệu; GET, HEAD, OPTIONS thì không", () => {
    for (const m of ["POST", "PUT", "PATCH", "DELETE", "post"]) {
      expect(isUnsafeMethod(m)).toBe(true);
    }
    for (const m of ["GET", "HEAD", "OPTIONS"]) {
      expect(isUnsafeMethod(m)).toBe(false);
    }
  });
});

describe("rejectCrossOrigin", () => {
  it("cho qua GET kể cả khác origin, và ghi dữ liệu cùng origin", () => {
    expect(rejectCrossOrigin(req("GET", "https://evil.example"))).toBeNull();
    expect(rejectCrossOrigin(req("GET"))).toBeNull();
    expect(
      rejectCrossOrigin(req("DELETE", "http://localhost:3000")),
    ).toBeNull();
  });

  it("ghi dữ liệu khác origin hoặc thiếu Origin: 403 forbidden đúng cấu trúc lỗi", async () => {
    for (const r of [
      req("POST", "https://evil.example"),
      req("PATCH"),
      req("PUT", "http://localhost:3001"),
      req("DELETE", "null"),
    ]) {
      const res = rejectCrossOrigin(r);
      expect(res?.status).toBe(403);
      expect(res?.headers.get("cache-control")).toBe("no-store");
      const body = await res!.json();
      expect(body.error.code).toBe("forbidden");
      expect(typeof body.error.message).toBe("string");
      expect(body.error.request_id).toMatch(/^[0-9a-f-]{36}$/);
    }
  });
});
