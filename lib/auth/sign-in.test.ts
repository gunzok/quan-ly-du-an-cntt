import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { strings } from "@/lib/strings";
import { mapSignInError, signInWithPassword } from "./sign-in";

function fakeClient(response: { data: unknown; error: unknown }) {
  const signIn = vi.fn().mockResolvedValue(response);
  const client = {
    auth: { signInWithPassword: signIn },
  } as unknown as SupabaseClient;
  return { client, signIn };
}

describe("mapSignInError", () => {
  it.each([
    { status: 400, code: "invalid_credentials" },
    { status: 400, code: "email_not_confirmed" },
    { status: 400, code: "user_banned" },
    { status: 422, code: "user_not_found" },
  ])("lỗi phía tài khoản %o trả cùng một lỗi chung", (err) => {
    expect(mapSignInError(err)).toEqual({
      code: "unauthenticated",
      message: strings.errors.invalidCredentials,
    });
  });

  it("vượt giới hạn tần suất trả rate_limited", () => {
    expect(mapSignInError({ status: 429 }).code).toBe("rate_limited");
    expect(
      mapSignInError({ status: 400, code: "over_request_rate_limit" }).code,
    ).toBe("rate_limited");
  });

  it("lỗi mạng hoặc máy chủ trả internal_error, không lộ chi tiết", () => {
    expect(mapSignInError({ name: "AuthRetryableFetchError" })).toEqual({
      code: "internal_error",
      message: strings.errors.internal,
    });
    expect(mapSignInError({ status: 500 }).code).toBe("internal_error");
    expect(mapSignInError({}).code).toBe("internal_error");
  });
});

describe("signInWithPassword", () => {
  it("đầu vào sai thì không gọi Supabase", async () => {
    const { client, signIn } = fakeClient({ data: {}, error: null });
    const result = await signInWithPassword(client, {
      email: "khong-hop-le",
      password: "",
    });
    expect(signIn).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      ok: false,
      email: "khong-hop-le",
      error: { code: "validation_failed" },
    });
  });

  it("đúng thông tin thì trả ok với email đã chuẩn hóa", async () => {
    const { client, signIn } = fakeClient({
      data: { session: { access_token: "t" }, user: {} },
      error: null,
    });
    const result = await signInWithPassword(client, {
      email: " PM@example.com",
      password: "secret",
    });
    expect(signIn).toHaveBeenCalledWith({
      email: "pm@example.com",
      password: "secret",
    });
    expect(result).toEqual({ ok: true, email: "pm@example.com" });
  });

  it("sai thông tin thì trả lỗi chung và không trả mật khẩu", async () => {
    const { client } = fakeClient({
      data: { session: null, user: null },
      error: { status: 400, code: "invalid_credentials", message: "x" },
    });
    const result = await signInWithPassword(client, {
      email: "pm@example.com",
      password: "sai",
    });
    expect(result).toEqual({
      ok: false,
      email: "pm@example.com",
      error: {
        code: "unauthenticated",
        message: strings.errors.invalidCredentials,
      },
    });
    expect(JSON.stringify(result)).not.toContain("sai");
  });
});
