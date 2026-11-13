import { describe, expect, it } from "vitest";
import { decideAuthGate } from "./routes";

describe("decideAuthGate", () => {
  it("chưa đăng nhập vào trang cần bảo vệ thì chuyển về /login", () => {
    for (const path of ["/", "/projects", "/projects/1/kanban", "/loginx"]) {
      expect(decideAuthGate(path, false)).toEqual({
        action: "redirect",
        to: "/login",
      });
    }
  });

  it("chưa đăng nhập vẫn vào được /login và /auth/callback", () => {
    expect(decideAuthGate("/login", false)).toEqual({ action: "next" });
    expect(decideAuthGate("/auth/callback", false)).toEqual({ action: "next" });
  });

  it("chỉ đúng /auth/callback là công khai, đường dẫn gần giống vẫn bị chặn", () => {
    for (const path of ["/auth", "/auth/callbackx", "/auth/callback/x"]) {
      expect(decideAuthGate(path, false)).toEqual({
        action: "redirect",
        to: "/login",
      });
    }
  });

  it("chưa đăng nhập gọi API thì trả 401, không chuyển hướng", () => {
    expect(decideAuthGate("/api/v1/me", false)).toEqual({
      action: "unauthorized",
    });
    expect(decideAuthGate("/api", false)).toEqual({ action: "unauthorized" });
    expect(decideAuthGate("/apix", false)).toEqual({
      action: "redirect",
      to: "/login",
    });
  });

  it("đã đăng nhập vào /login hoặc /auth/callback thì chuyển về /", () => {
    expect(decideAuthGate("/login", true)).toEqual({
      action: "redirect",
      to: "/",
    });
    expect(decideAuthGate("/auth/callback", true)).toEqual({
      action: "redirect",
      to: "/",
    });
  });

  it("đã đăng nhập đi tiếp ở trang khác và API", () => {
    expect(decideAuthGate("/", true)).toEqual({ action: "next" });
    expect(decideAuthGate("/api/v1/me", true)).toEqual({ action: "next" });
  });
});
