import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import {
  acceptInvite,
  isTokenHashShape,
  mapVerifyError,
  passwordIssue,
  readTokenHashParam,
  validateAcceptInviteForm,
} from "./accept-invite";

const HASH = "db42fef98d3af64edfa98b8146ba0868ae7b3181910a0cb87cc6d441";

function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [k, v] of Object.entries(values)) data.set(k, v);
  return data;
}

describe("isTokenHashShape / readTokenHashParam", () => {
  it("nhận token hex của GoTrue và dạng có tiền tố pkce_", () => {
    expect(isTokenHashShape(HASH)).toBe(true);
    expect(isTokenHashShape(`pkce_${HASH}`)).toBe(true);
  });

  it("từ chối rỗng, quá ngắn, quá dài, ký tự lạ, giá trị lặp", () => {
    expect(isTokenHashShape("")).toBe(false);
    expect(isTokenHashShape("abc")).toBe(false);
    expect(isTokenHashShape("a".repeat(129))).toBe(false);
    expect(isTokenHashShape(`${HASH}&type=recovery`)).toBe(false);
    expect(isTokenHashShape("<script>alert(1)</script>xx")).toBe(false);
    expect(readTokenHashParam(undefined)).toBeNull();
    expect(readTokenHashParam([HASH, HASH])).toBeNull();
    expect(readTokenHashParam(HASH)).toBe(HASH);
  });
});

describe("passwordIssue", () => {
  it("bắt buộc, tối thiểu 12 ký tự, tối đa 72 byte", () => {
    expect(passwordIssue("")).toBe("required");
    expect(passwordIssue("a".repeat(11))).toBe("too_short");
    expect(passwordIssue("a".repeat(12))).toBeUndefined();
    expect(passwordIssue("a".repeat(72))).toBeUndefined();
    expect(passwordIssue("a".repeat(73))).toBe("too_long");
  });

  it("đếm ký tự theo điểm mã, giới hạn trên theo byte UTF-8", () => {
    // 12 ký tự có dấu: đủ dài (mỗi ký tự 2–3 byte).
    expect(passwordIssue("mậtkhẩuđủdài")).toBeUndefined();
    // 25 ký tự 3 byte = 75 byte: quá giới hạn bcrypt dù chỉ 25 ký tự.
    expect(passwordIssue("ệ".repeat(25))).toBe("too_long");
    // 11 emoji (ngoài BMP) vẫn là 11 ký tự.
    expect(passwordIssue("🙂".repeat(11))).toBe("too_short");
  });
});

describe("validateAcceptInviteForm", () => {
  const good = "mot-cum-tu-du-dai";

  it("hợp lệ trả token và mật khẩu (giữ nguyên, không cắt khoảng trắng)", () => {
    expect(
      validateAcceptInviteForm(
        form({
          token_hash: HASH,
          password: ` ${good} `,
          confirm_password: ` ${good} `,
        }),
      ),
    ).toEqual({ ok: true, data: { tokenHash: HASH, password: ` ${good} ` } });
  });

  it("thiếu hoặc sai token: linkInvalid, không báo lỗi trường", () => {
    expect(
      validateAcceptInviteForm(
        form({ password: good, confirm_password: good }),
      ),
    ).toEqual({ ok: false, linkInvalid: true });
    expect(
      validateAcceptInviteForm(
        form({ token_hash: "x", password: good, confirm_password: good }),
      ),
    ).toEqual({ ok: false, linkInvalid: true });
  });

  it("lỗi trường: thiếu, quá ngắn, không khớp", () => {
    expect(validateAcceptInviteForm(form({ token_hash: HASH }))).toEqual({
      ok: false,
      fieldErrors: { password: "required", confirm: "required" },
    });
    expect(
      validateAcceptInviteForm(
        form({ token_hash: HASH, password: "ngan", confirm_password: "ngan" }),
      ),
    ).toEqual({ ok: false, fieldErrors: { password: "too_short" } });
    expect(
      validateAcceptInviteForm(
        form({
          token_hash: HASH,
          password: good,
          confirm_password: `${good}x`,
        }),
      ),
    ).toEqual({ ok: false, fieldErrors: { confirm: "mismatch" } });
  });
});

describe("mapVerifyError", () => {
  it("mọi lỗi 4xx của token (hết hạn, đã dùng, giả) là link_invalid", () => {
    expect(mapVerifyError({ status: 403, code: "otp_expired" })).toBe(
      "link_invalid",
    );
    expect(mapVerifyError({ status: 400, code: "validation_failed" })).toBe(
      "link_invalid",
    );
    expect(mapVerifyError({ status: 404 })).toBe("link_invalid");
  });

  it("429 là rate_limited; 5xx/mạng là unavailable", () => {
    expect(mapVerifyError({ status: 429 })).toBe("rate_limited");
    expect(mapVerifyError({ code: "over_request_rate_limit" })).toBe(
      "rate_limited",
    );
    expect(mapVerifyError({ status: 500 })).toBe("unavailable");
    expect(mapVerifyError({ name: "AuthRetryableFetchError" })).toBe(
      "unavailable",
    );
    expect(mapVerifyError({})).toBe("unavailable");
  });
});

describe("acceptInvite", () => {
  function fakeClient(opts: {
    verify: unknown;
    update?: unknown;
    verifyThrows?: boolean;
  }) {
    const verifyOtp = opts.verifyThrows
      ? vi.fn().mockRejectedValue(new Error("network"))
      : vi.fn().mockResolvedValue(opts.verify);
    const updateUser = vi
      .fn()
      .mockResolvedValue(opts.update ?? { error: null });
    const signOut = vi.fn().mockResolvedValue({ error: null });
    const client = {
      auth: { verifyOtp, updateUser, signOut },
    } as unknown as SupabaseClient;
    return { client, verifyOtp, updateUser, signOut };
  }
  const input = { tokenHash: HASH, password: "mot-cum-tu-du-dai" };

  it("tiêu token với type cố định 'invite' rồi đặt mật khẩu", async () => {
    const { client, verifyOtp, updateUser, signOut } = fakeClient({
      verify: { data: { session: { access_token: "t" } }, error: null },
    });
    expect(await acceptInvite(client, input)).toEqual({ ok: true });
    expect(verifyOtp).toHaveBeenCalledWith({
      token_hash: HASH,
      type: "invite",
    });
    expect(updateUser).toHaveBeenCalledWith({ password: input.password });
    expect(signOut).not.toHaveBeenCalled();
  });

  it("token bị từ chối: link_invalid, không đặt mật khẩu", async () => {
    const { client, updateUser } = fakeClient({
      verify: {
        data: { session: null },
        error: { status: 403, code: "otp_expired" },
      },
    });
    expect(await acceptInvite(client, input)).toEqual({
      ok: false,
      reason: "link_invalid",
    });
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("verifyOtp ném lỗi mạng: unavailable", async () => {
    const { client } = fakeClient({ verify: null, verifyThrows: true });
    expect(await acceptInvite(client, input)).toEqual({
      ok: false,
      reason: "unavailable",
    });
  });

  it("đặt mật khẩu lỗi sau khi đã có phiên: đăng xuất cục bộ, password_not_set", async () => {
    const { client, signOut } = fakeClient({
      verify: { data: { session: { access_token: "t" } }, error: null },
      update: { error: { status: 422, code: "weak_password" } },
    });
    expect(await acceptInvite(client, input)).toEqual({
      ok: false,
      reason: "password_not_set",
    });
    expect(signOut).toHaveBeenCalledWith({ scope: "local" });
  });
});
