import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { strings } from "@/lib/strings";
import {
  buildOAuthRedirectUrl,
  loginErrorMessage,
  loginErrorPath,
  mapOAuthError,
  resolveOAuthCallback,
  startGoogleSignIn,
} from "./oauth";

function params(query: string) {
  return new URLSearchParams(query);
}

describe("mapOAuthError", () => {
  it("signup_disabled (tài khoản chưa có, Auth tắt đăng ký) là chưa được mời", () => {
    expect(mapOAuthError({ code: "signup_disabled" })).toBe("not_invited");
    expect(
      mapOAuthError({ message: "Signups not allowed for this instance" }),
    ).toBe("not_invited");
  });

  it("giới hạn tần suất trả rate_limited", () => {
    expect(mapOAuthError({ status: 429 })).toBe("rate_limited");
    expect(mapOAuthError({ code: "over_request_rate_limit" })).toBe(
      "rate_limited",
    );
  });

  it("lỗi khác (mã sai, hết hạn, máy chủ, hủy) trả lỗi chung", () => {
    expect(mapOAuthError({})).toBe("oauth_failed");
    expect(mapOAuthError({ code: "flow_state_not_found", status: 404 })).toBe(
      "oauth_failed",
    );
    expect(mapOAuthError({ code: "unexpected_failure", status: 500 })).toBe(
      "oauth_failed",
    );
  });
});

describe("loginErrorMessage", () => {
  it("khóa đã biết trả thông báo trong lib/strings.ts", () => {
    expect(loginErrorMessage("not_invited")).toBe(
      strings.errors.oauth.not_invited,
    );
    expect(loginErrorMessage(["rate_limited", "x"])).toBe(
      strings.errors.oauth.rate_limited,
    );
    expect(strings.errors.oauth.not_invited).toMatch(/Liên hệ Admin/);
  });

  it("giá trị lạ hoặc văn bản tùy ý không hiển thị gì", () => {
    expect(loginErrorMessage(undefined)).toBeUndefined();
    expect(loginErrorMessage("")).toBeUndefined();
    expect(loginErrorMessage("Hãy gọi số 0900")).toBeUndefined();
    expect(loginErrorMessage("toString")).toBeUndefined();
  });
});

describe("buildOAuthRedirectUrl", () => {
  it("luôn trỏ về /auth/callback trên origin, bỏ đường dẫn và query", () => {
    expect(buildOAuthRedirectUrl("http://localhost:3000")).toBe(
      "http://localhost:3000/auth/callback",
    );
    expect(
      buildOAuthRedirectUrl("https://qlda.example.com/x?next=https://evil"),
    ).toBe("https://qlda.example.com/auth/callback");
  });

  it("từ chối origin thiếu hoặc không phải http(s)", () => {
    expect(buildOAuthRedirectUrl(null)).toBeNull();
    expect(buildOAuthRedirectUrl("")).toBeNull();
    expect(buildOAuthRedirectUrl("null")).toBeNull();
    expect(buildOAuthRedirectUrl("javascript:alert(1)")).toBeNull();
  });
});

describe("startGoogleSignIn", () => {
  function fakeClient(response: { data: unknown; error: unknown }) {
    const signInWithOAuth = vi.fn().mockResolvedValue(response);
    const client = { auth: { signInWithOAuth } } as unknown as SupabaseClient;
    return { client, signInWithOAuth };
  }

  it("gọi provider google, redirectTo cố định, không tự chuyển trang", async () => {
    const { client, signInWithOAuth } = fakeClient({
      data: { url: "http://127.0.0.1:54321/auth/v1/authorize?provider=google" },
      error: null,
    });
    const result = await startGoogleSignIn(client, "http://localhost:3000");
    expect(signInWithOAuth).toHaveBeenCalledWith({
      provider: "google",
      options: {
        redirectTo: "http://localhost:3000/auth/callback",
        skipBrowserRedirect: true,
        queryParams: { prompt: "select_account" },
      },
    });
    expect(result).toEqual({
      ok: true,
      url: "http://127.0.0.1:54321/auth/v1/authorize?provider=google",
    });
  });

  it("origin không hợp lệ thì không gọi Supabase", async () => {
    const { client, signInWithOAuth } = fakeClient({ data: {}, error: null });
    expect(await startGoogleSignIn(client, null)).toEqual({
      ok: false,
      error: "oauth_failed",
    });
    expect(signInWithOAuth).not.toHaveBeenCalled();
  });

  it("Supabase trả lỗi thì trả khóa lỗi", async () => {
    const { client } = fakeClient({
      data: { url: null },
      error: { status: 500, message: "x" },
    });
    expect(await startGoogleSignIn(client, "http://localhost:3000")).toEqual({
      ok: false,
      error: "oauth_failed",
    });
  });
});

describe("resolveOAuthCallback", () => {
  it("đổi mã thành công thì về /", async () => {
    const exchange = vi.fn().mockResolvedValue({ error: null });
    expect(await resolveOAuthCallback(params("code=abc-123"), exchange)).toBe(
      "/",
    );
    expect(exchange).toHaveBeenCalledWith("abc-123");
  });

  it("bỏ qua next/redirect_to trên URL: vẫn về / (không open redirect)", async () => {
    const exchange = vi.fn().mockResolvedValue({ error: null });
    expect(
      await resolveOAuthCallback(
        params("code=abc&next=https://evil.example&redirect_to=//evil.example"),
        exchange,
      ),
    ).toBe("/");
  });

  it("tài khoản Google chưa được mời (signup_disabled) về /login báo chưa được mời", async () => {
    const exchange = vi.fn();
    const target = await resolveOAuthCallback(
      params(
        "error=access_denied&error_code=signup_disabled&error_description=Signups+not+allowed+for+this+instance",
      ),
      exchange,
    );
    expect(target).toBe(loginErrorPath("not_invited"));
    expect(target).toBe("/login?error=not_invited");
    expect(exchange).not.toHaveBeenCalled();
  });

  it("người dùng hủy ở Google hoặc Auth lỗi: về /login báo lỗi chung, không đổi mã", async () => {
    const exchange = vi.fn();
    expect(
      await resolveOAuthCallback(
        params("error=access_denied&error_description=user+cancelled&code=x"),
        exchange,
      ),
    ).toBe("/login?error=oauth_failed");
    expect(
      await resolveOAuthCallback(
        params(
          "error=server_error&error_code=unexpected_failure&error_description=Unable+to+exchange+external+code",
        ),
        exchange,
      ),
    ).toBe("/login?error=oauth_failed");
    expect(exchange).not.toHaveBeenCalled();
  });

  it("thiếu mã hoặc mã quá dài: về /login, không gọi Auth", async () => {
    const exchange = vi.fn();
    expect(await resolveOAuthCallback(params(""), exchange)).toBe(
      "/login?error=oauth_failed",
    );
    expect(
      await resolveOAuthCallback(params(`code=${"a".repeat(513)}`), exchange),
    ).toBe("/login?error=oauth_failed");
    expect(exchange).not.toHaveBeenCalled();
  });

  it("đổi mã thất bại hoặc ném lỗi: về /login theo loại lỗi", async () => {
    expect(
      await resolveOAuthCallback(params("code=x"), async () => ({
        error: { status: 404, code: "flow_state_not_found" },
      })),
    ).toBe("/login?error=oauth_failed");
    expect(
      await resolveOAuthCallback(params("code=x"), async () => ({
        error: { status: 422, code: "signup_disabled" },
      })),
    ).toBe("/login?error=not_invited");
    expect(
      await resolveOAuthCallback(params("code=x"), async () => ({
        error: { status: 429 },
      })),
    ).toBe("/login?error=rate_limited");
    expect(
      await resolveOAuthCallback(params("code=x"), async () => {
        throw new Error("mạng");
      }),
    ).toBe("/login?error=oauth_failed");
  });
});
