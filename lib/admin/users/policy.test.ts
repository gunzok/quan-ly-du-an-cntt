import { describe, expect, it } from "vitest";
import { strings } from "@/lib/strings";
import {
  BAN_DURATION_LOCKED,
  banDurationFor,
  checkSelfAction,
  decideAdminGate,
  isSameOrigin,
  mapAdminUpdateError,
} from "./policy";

describe("decideAdminGate", () => {
  const user = { id: "u1" };

  it("chưa đăng nhập: 401 unauthenticated", () => {
    expect(decideAdminGate(null, null)).toMatchObject({
      ok: false,
      error: { code: "unauthenticated" },
    });
  });

  it("không phải Admin, Admin bị khóa, hồ sơ không đọc được: 403 forbidden", () => {
    for (const profile of [
      { is_admin: false, is_active: true },
      { is_admin: true, is_active: false },
      null,
    ]) {
      expect(decideAdminGate(user, profile)).toMatchObject({
        ok: false,
        error: { code: "forbidden", message: strings.api.forbidden },
      });
    }
  });

  it("Admin đang hoạt động: cho qua", () => {
    expect(decideAdminGate(user, { is_admin: true, is_active: true })).toEqual({
      ok: true,
      userId: "u1",
    });
  });
});

describe("checkSelfAction", () => {
  it("chặn tự khóa và tự thu quyền Admin (409)", () => {
    expect(checkSelfAction("a", "a", { is_active: false })).toMatchObject({
      code: "conflict",
      message: strings.adminUsers.errors.selfLock,
    });
    expect(checkSelfAction("a", "a", { is_admin: false })).toMatchObject({
      code: "conflict",
      message: strings.adminUsers.errors.selfRevokeAdmin,
    });
  });

  it("cho phép thao tác vô hại lên chính mình và mọi thao tác lên người khác", () => {
    expect(checkSelfAction("a", "a", { is_active: true })).toBeNull();
    expect(checkSelfAction("a", "a", { is_admin: true })).toBeNull();
    expect(checkSelfAction("a", "a", {})).toBeNull();
    expect(
      checkSelfAction("a", "b", { is_active: false, is_admin: false }),
    ).toBeNull();
  });
});

describe("mapAdminUpdateError", () => {
  it("ánh xạ lỗi nghiệp vụ của admin_update_user", () => {
    const cases: [string, string, number | undefined][] = [
      ["actor_not_admin", "forbidden", undefined],
      ["user_not_found", "not_found", undefined],
      ["self_lock", "conflict", undefined],
      ["self_revoke_admin", "conflict", undefined],
      ["last_admin", "conflict", undefined],
      ["department_not_found", "validation_failed", undefined],
    ];
    for (const [message, code] of cases) {
      expect(mapAdminUpdateError({ code: "P0001", message })).toMatchObject({
        code,
      });
    }
    expect(
      mapAdminUpdateError({ code: "P0001", message: "last_admin" })?.message,
    ).toBe(strings.adminUsers.errors.lastAdmin);
  });

  it("lỗi khác (mã khác hoặc thông điệp lạ) trả null để coi là lỗi hệ thống", () => {
    expect(
      mapAdminUpdateError({ code: "42501", message: "self_lock" }),
    ).toBeNull();
    expect(mapAdminUpdateError({ code: "P0001", message: "khac" })).toBeNull();
    expect(mapAdminUpdateError({})).toBeNull();
  });
});

describe("isSameOrigin", () => {
  const url = "http://localhost:3000/api/v1/users/invitations";

  it("chỉ nhận Origin trùng ứng dụng", () => {
    expect(
      isSameOrigin(
        new Request(url, { headers: { origin: "http://localhost:3000" } }),
      ),
    ).toBe(true);
    expect(
      isSameOrigin(
        new Request(url, { headers: { origin: "https://evil.example" } }),
      ),
    ).toBe(false);
    expect(
      isSameOrigin(
        new Request(url, { headers: { origin: "http://localhost:3001" } }),
      ),
    ).toBe(false);
    expect(isSameOrigin(new Request(url))).toBe(false);
  });
});

describe("banDurationFor", () => {
  it("khóa: cấm dài hạn; mở: gỡ cấm", () => {
    expect(banDurationFor(false)).toBe(BAN_DURATION_LOCKED);
    expect(banDurationFor(true)).toBe("none");
  });
});
