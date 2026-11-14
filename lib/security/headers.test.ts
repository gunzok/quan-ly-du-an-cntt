import { describe, expect, it } from "vitest";
import {
  buildContentSecurityPolicy,
  createNonce,
  staticSecurityHeaders,
  supabaseOrigins,
} from "./headers";

function directives(csp: string): Map<string, string[]> {
  return new Map(
    csp.split(";").map((part) => {
      const [name, ...values] = part.trim().split(/\s+/);
      return [name, values];
    }),
  );
}

describe("createNonce", () => {
  it("mỗi lần một giá trị mới, base64 của 16 byte", () => {
    const a = createNonce();
    const b = createNonce();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9+/]{22}==$/);
  });
});

describe("supabaseOrigins", () => {
  it("lấy origin http(s) và ws(s) tương ứng", () => {
    expect(supabaseOrigins("https://abc.supabase.co/rest/v1")).toEqual([
      "https://abc.supabase.co",
      "wss://abc.supabase.co",
    ]);
    expect(supabaseOrigins("http://127.0.0.1:54321")).toEqual([
      "http://127.0.0.1:54321",
      "ws://127.0.0.1:54321",
    ]);
  });

  it("thiếu, hỏng hoặc giao thức lạ thì bỏ qua", () => {
    expect(supabaseOrigins(undefined)).toEqual([]);
    expect(supabaseOrigins("không phải url")).toEqual([]);
    expect(supabaseOrigins("javascript:alert(1)")).toEqual([]);
  });
});

describe("buildContentSecurityPolicy", () => {
  const nonce = "bm9uY2UtdmktZHUtMTIzNA==";
  const prod = directives(
    buildContentSecurityPolicy({
      nonce,
      supabaseUrl: "https://abc.supabase.co",
      isDev: false,
    }),
  );

  it("script chỉ chạy theo nonce + strict-dynamic, không unsafe-inline/eval ở production", () => {
    const script = prod.get("script-src");
    expect(script).toContain(`'nonce-${nonce}'`);
    expect(script).toContain("'strict-dynamic'");
    expect(script).not.toContain("'unsafe-inline'");
    expect(script).not.toContain("'unsafe-eval'");
  });

  it("chặn nhúng khung, plugin, base tag lạ; nâng cấp https", () => {
    expect(prod.get("frame-ancestors")).toEqual(["'none'"]);
    expect(prod.get("object-src")).toEqual(["'none'"]);
    expect(prod.get("base-uri")).toEqual(["'self'"]);
    expect(prod.get("default-src")).toEqual(["'self'"]);
    expect(prod.has("upgrade-insecure-requests")).toBe(true);
  });

  it("chỉ kết nối tới chính ứng dụng và Supabase từ biến môi trường", () => {
    expect(prod.get("connect-src")).toEqual([
      "'self'",
      "https://abc.supabase.co",
      "wss://abc.supabase.co",
    ]);
  });

  it("dev: thêm unsafe-eval (React debug), không upgrade-insecure-requests", () => {
    const dev = directives(buildContentSecurityPolicy({ nonce, isDev: true }));
    expect(dev.get("script-src")).toContain("'unsafe-eval'");
    expect(dev.has("upgrade-insecure-requests")).toBe(false);
    expect(dev.get("connect-src")).toEqual(["'self'"]);
  });
});

describe("staticSecurityHeaders", () => {
  it("luôn có nosniff, Referrer-Policy, Permissions-Policy, chống nhúng khung", () => {
    const headers = new Map(staticSecurityHeaders({ isProduction: false }));
    expect(headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(headers.get("Referrer-Policy")).toBe(
      "strict-origin-when-cross-origin",
    );
    expect(headers.get("Permissions-Policy")).toContain("camera=()");
    expect(headers.get("X-Frame-Options")).toBe("DENY");
  });

  it("HSTS chỉ ở production", () => {
    expect(
      new Map(staticSecurityHeaders({ isProduction: false })).has(
        "Strict-Transport-Security",
      ),
    ).toBe(false);
    expect(
      new Map(staticSecurityHeaders({ isProduction: true })).get(
        "Strict-Transport-Security",
      ),
    ).toMatch(/^max-age=\d{8,}; includeSubDomains$/);
  });
});
