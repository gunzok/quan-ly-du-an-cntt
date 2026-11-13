import { describe, expect, it } from "vitest";
import { sessionCookieOptions } from "./cookie-options";
import { isServiceRoleKey, resolveSupabasePublicEnv } from "./env";

// JWT giả (chữ ký vô nghĩa), chỉ để thử phần payload.
function fakeJwt(payload: object): string {
  const encode = (o: object) =>
    Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${encode({ alg: "HS256" })}.${encode(payload)}.chu-ky-gia`;
}

describe("isServiceRoleKey", () => {
  it("nhận ra khóa service_role và khóa secret", () => {
    expect(isServiceRoleKey(fakeJwt({ role: "service_role" }))).toBe(true);
    expect(isServiceRoleKey("sb_secret_abc")).toBe(true);
  });

  it("chấp nhận khóa anon và publishable", () => {
    expect(isServiceRoleKey(fakeJwt({ role: "anon" }))).toBe(false);
    expect(isServiceRoleKey("sb_publishable_abc")).toBe(false);
    expect(isServiceRoleKey("a.khong-phai-base64!.c")).toBe(false);
  });
});

describe("resolveSupabasePublicEnv", () => {
  it("báo lỗi rõ khi thiếu biến", () => {
    expect(() => resolveSupabasePublicEnv(undefined, "k")).toThrow(
      /NEXT_PUBLIC_SUPABASE_URL/,
    );
    expect(() => resolveSupabasePublicEnv("http://x", "")).toThrow();
  });

  it("từ chối khóa service_role trong biến công khai", () => {
    expect(() =>
      resolveSupabasePublicEnv(
        "http://127.0.0.1:54321",
        fakeJwt({ role: "service_role" }),
      ),
    ).toThrow(/service_role/);
  });

  it("trả URL và khóa hợp lệ", () => {
    expect(
      resolveSupabasePublicEnv("http://127.0.0.1:54321", "sb_publishable_x"),
    ).toEqual({ url: "http://127.0.0.1:54321", anonKey: "sb_publishable_x" });
  });
});

describe("sessionCookieOptions", () => {
  it("luôn httpOnly, SameSite=Lax; Secure khi production", () => {
    expect(sessionCookieOptions("production")).toEqual({
      path: "/",
      sameSite: "lax",
      httpOnly: true,
      secure: true,
    });
    expect(sessionCookieOptions("development")).toMatchObject({
      httpOnly: true,
      secure: false,
    });
  });
});
