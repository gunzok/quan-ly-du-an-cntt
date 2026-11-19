import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  checkDevUiHidden,
  checkHomeRedirect,
  checkLogin,
  checkMeUnauthenticated,
  checkSupabaseCsp,
  checkSupabaseHealth,
  createFetcher,
  formatReport,
  formatSummary,
  parseBaseUrl,
  redact,
  runSmoke,
  scriptNonces,
  supabaseOriginFromCsp,
  type SmokeResponse,
} from "./smoke";

const NONCE = "bm9uY2UtMTIzNDU2Nzg=";
const SUPABASE = "https://abcdefgh.supabase.co";

function csp(nonce = NONCE, supabase = SUPABASE, extraScript = ""): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${extraScript}`,
    "style-src 'self' 'unsafe-inline'",
    `connect-src 'self' ${supabase} ${supabase.replace("https:", "wss:")}`,
    "frame-ancestors 'none'",
  ].join("; ");
}

function loginResponse(
  overrides: Partial<Omit<SmokeResponse, "headers">> & {
    headers?: Record<string, string | undefined>;
  } = {},
): SmokeResponse {
  const headers: Record<string, string | undefined> = {
    "content-security-policy": csp(),
    "x-content-type-options": "nosniff",
    "referrer-policy": "strict-origin-when-cross-origin",
    "x-frame-options": "DENY",
    "permissions-policy": "camera=(), microphone=()",
    "strict-transport-security": "max-age=63072000; includeSubDomains",
    ...overrides.headers,
  };
  return {
    status: overrides.status ?? 200,
    body:
      overrides.body ??
      `<html><script nonce="${NONCE}" src="/a.js"></script><script nonce="${NONCE}">x</script></html>`,
    headers: Object.fromEntries(
      Object.entries(headers).filter(
        (e): e is [string, string] => e[1] !== undefined,
      ),
    ),
  };
}

describe("parseBaseUrl", () => {
  it("nhận https ở xa và http cục bộ, bỏ đường dẫn", () => {
    expect(parseBaseUrl("https://qlda.vercel.app/abc?x=1").href).toBe(
      "https://qlda.vercel.app/",
    );
    expect(parseBaseUrl("http://127.0.0.1:3100").origin).toBe(
      "http://127.0.0.1:3100",
    );
    expect(parseBaseUrl("http://localhost:3000").origin).toBe(
      "http://localhost:3000",
    );
  });

  it("từ chối thiếu URL, http ở xa, giao thức lạ và URL có mật khẩu", () => {
    expect(() => parseBaseUrl(undefined)).toThrow(/make deploy-smoke URL=/);
    expect(() => parseBaseUrl("http://qlda.vercel.app")).toThrow(/https/);
    expect(() => parseBaseUrl("ftp://x")).toThrow(/http\(s\)/);
    expect(() => parseBaseUrl("không phải url")).toThrow(/không hợp lệ/);
    expect(() => parseBaseUrl("https://u:p@qlda.vercel.app")).toThrow(
      /mật khẩu/,
    );
  });
});

describe("scriptNonces", () => {
  it("đọc nonce của từng thẻ script, thẻ thiếu nonce là chuỗi rỗng", () => {
    expect(
      scriptNonces(
        `<script nonce="a"></script><SCRIPT src=x nonce='b'></SCRIPT><script>1</script><script nonce=c>`,
      ),
    ).toEqual(["a", "b", "", "c"]);
  });
});

describe("checkLogin", () => {
  it("xanh khi đủ CSP nonce, header an toàn, HSTS khi https", () => {
    expect(checkLogin(loginResponse(), true).status).toBe("pass");
  });

  it("không đòi HSTS khi chạy http cục bộ", () => {
    const res = loginResponse({
      headers: { "strict-transport-security": undefined },
    });
    expect(checkLogin(res, false).status).toBe("pass");
    expect(checkLogin(res, true)).toMatchObject({
      status: "fail",
      detail: expect.stringContaining("strict-transport-security"),
    });
  });

  it("đỏ khi mã khác 200", () => {
    expect(checkLogin(loginResponse({ status: 500 }), true).detail).toMatch(
      /500/,
    );
  });

  it("đỏ khi CSP thiếu nonce, có unsafe-eval/unsafe-inline hoặc thiếu frame-ancestors", () => {
    const noNonce = loginResponse({
      headers: {
        "content-security-policy":
          "script-src 'self' 'strict-dynamic'; frame-ancestors 'none'",
      },
    });
    expect(checkLogin(noNonce, true).detail).toMatch(/không có nonce/);
    const dev = loginResponse({
      headers: {
        "content-security-policy": csp(NONCE, SUPABASE, " 'unsafe-eval'"),
      },
    });
    expect(checkLogin(dev, true).detail).toMatch(/unsafe-eval/);
    const inline = loginResponse({
      headers: {
        "content-security-policy": csp(NONCE, SUPABASE, " 'unsafe-inline'"),
      },
    });
    expect(checkLogin(inline, true).detail).toMatch(/unsafe-inline/);
    const framed = loginResponse({
      headers: {
        "content-security-policy": csp().replace(
          "frame-ancestors 'none'",
          "frame-ancestors *",
        ),
      },
    });
    expect(checkLogin(framed, true).detail).toMatch(/frame-ancestors/);
  });

  it("đỏ khi thẻ script không mang đúng nonce hoặc không có script", () => {
    expect(
      checkLogin(
        loginResponse({ body: `<script nonce="khac"></script>` }),
        true,
      ).detail,
    ).toMatch(/không mang đúng nonce/);
    expect(
      checkLogin(loginResponse({ body: "<html></html>" }), true).detail,
    ).toMatch(/không có thẻ <script>/);
  });

  it("đỏ khi thiếu header an toàn hoặc lộ X-Powered-By", () => {
    const res = loginResponse({
      headers: {
        "x-content-type-options": undefined,
        "x-frame-options": "SAMEORIGIN",
        "x-powered-by": "Next.js",
      },
    });
    const { detail } = checkLogin(res, true);
    expect(detail).toMatch(/x-content-type-options/);
    expect(detail).toMatch(/x-frame-options/);
    expect(detail).toMatch(/X-Powered-By/);
  });
});

describe("checkMeUnauthenticated", () => {
  const body = JSON.stringify({ error: { code: "unauthenticated" } });
  it("xanh với 401 unauthenticated", () => {
    expect(
      checkMeUnauthenticated({ status: 401, headers: {}, body }).status,
    ).toBe("pass");
  });
  it("đỏ với 200, thân không JSON hoặc mã lỗi khác", () => {
    expect(
      checkMeUnauthenticated({ status: 200, headers: {}, body }).status,
    ).toBe("fail");
    expect(
      checkMeUnauthenticated({ status: 401, headers: {}, body: "<html>" })
        .detail,
    ).toMatch(/JSON/);
    expect(
      checkMeUnauthenticated({
        status: 401,
        headers: {},
        body: JSON.stringify({ error: { code: "forbidden" } }),
      }).detail,
    ).toMatch(/forbidden/);
  });
});

describe("checkDevUiHidden", () => {
  it("chỉ xanh với 404", () => {
    expect(
      checkDevUiHidden({ status: 404, headers: {}, body: "" }).status,
    ).toBe("pass");
    expect(
      checkDevUiHidden({ status: 200, headers: {}, body: "" }).status,
    ).toBe("fail");
  });
});

describe("checkHomeRedirect", () => {
  const base = new URL("https://qlda.vercel.app");
  it("xanh khi chuyển về /login cùng origin (tuyệt đối hoặc tương đối)", () => {
    for (const location of ["/login", "https://qlda.vercel.app/login"]) {
      expect(
        checkHomeRedirect(
          { status: 307, headers: { location }, body: "" },
          base,
        ).status,
      ).toBe("pass");
    }
  });
  it("đỏ khi không chuyển hướng, thiếu Location, sang origin khác hoặc đường khác", () => {
    expect(
      checkHomeRedirect({ status: 200, headers: {}, body: "" }, base).status,
    ).toBe("fail");
    expect(
      checkHomeRedirect({ status: 307, headers: {}, body: "" }, base).detail,
    ).toMatch(/Location/);
    expect(
      checkHomeRedirect(
        {
          status: 307,
          headers: { location: "https://evil.example/login" },
          body: "",
        },
        base,
      ).status,
    ).toBe("fail");
    expect(
      checkHomeRedirect(
        { status: 307, headers: { location: "/projects" }, body: "" },
        base,
      ).status,
    ).toBe("fail");
  });
});

describe("Supabase", () => {
  const remote = new URL("https://qlda.vercel.app");
  it("lấy origin Supabase từ connect-src, bỏ 'self' và wss", () => {
    expect(supabaseOriginFromCsp(csp(), remote.origin)).toBe(SUPABASE);
    expect(
      supabaseOriginFromCsp("connect-src 'self'", remote.origin),
    ).toBeNull();
  });

  it("xanh khi CSP khớp URL mong đợi; đỏ khi lệch dự án", () => {
    expect(
      checkSupabaseCsp(SUPABASE, {
        expectedUrl: `${SUPABASE}/`,
        base: remote,
        require: true,
      }).status,
    ).toBe("pass");
    expect(
      checkSupabaseCsp(SUPABASE, {
        expectedUrl: "https://khac.supabase.co",
        base: remote,
        require: true,
      }).detail,
    ).toMatch(/sai dự án/);
  });

  it("đỏ khi bản ở xa trỏ vào Supabase cục bộ hoặc Supabase không https", () => {
    expect(
      checkSupabaseCsp("http://127.0.0.1:54321", {
        base: remote,
        require: false,
      }).detail,
    ).toMatch(/cục bộ/);
    expect(
      checkSupabaseCsp("http://abc.supabase.co", {
        base: remote,
        require: false,
      }).detail,
    ).toMatch(/https/);
  });

  it("thiếu URL mong đợi: bỏ qua khi chạy tay, đỏ khi CD yêu cầu", () => {
    expect(
      checkSupabaseCsp(SUPABASE, { base: remote, require: false }).status,
    ).toBe("skip");
    expect(
      checkSupabaseCsp(SUPABASE, { base: remote, require: true }).status,
    ).toBe("fail");
    expect(
      checkSupabaseCsp(null, { base: remote, require: false }).status,
    ).toBe("fail");
  });

  it("health: có khóa thì đòi 200; không khóa chỉ cần không 5xx", () => {
    const res = (status: number) => ({ status, headers: {}, body: "" });
    expect(checkSupabaseHealth(res(200), true).status).toBe("pass");
    expect(checkSupabaseHealth(res(401), true).status).toBe("fail");
    expect(checkSupabaseHealth(res(401), false).status).toBe("pass");
    expect(checkSupabaseHealth(res(503), false).status).toBe("fail");
  });
});

describe("createFetcher", () => {
  const ok = () => new Response("ok", { status: 200 });

  it("thử lại khi 503 hoặc lỗi mạng rồi trả phản hồi cuối", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("", { status: 503 }))
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(ok());
    const sleep = vi.fn(async () => {});
    const fetcher = createFetcher({ fetchImpl, retries: 3, sleep });
    const res = await fetcher("https://a.example/login", {});
    expect(res.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("hết lượt thử thì trả mã 503 cuối cùng hoặc ném lỗi mạng", async () => {
    const sleep = async () => {};
    const always503 = vi.fn<typeof fetch>(
      async () => new Response("", { status: 503 }),
    );
    const res = await createFetcher({
      fetchImpl: always503,
      retries: 1,
      sleep,
    })("https://a.example/", {});
    expect(res.status).toBe(503);
    const down = vi.fn<typeof fetch>(async () => {
      throw new TypeError("fetch failed");
    });
    await expect(
      createFetcher({ fetchImpl: down, retries: 1, sleep })(
        "https://a.example/",
        {},
      ),
    ).rejects.toThrow(/fetch failed/);
  });

  it("không theo chuyển hướng; chỉ gửi mã vượt bảo vệ tới origin ứng dụng", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => ok());
    const fetcher = createFetcher({
      fetchImpl,
      bypassSecret: "bi-mat-bypass",
      appOrigin: "https://qlda.vercel.app",
    });
    await fetcher("https://qlda.vercel.app/login", {});
    await fetcher(`${SUPABASE}/auth/v1/health`, { apikey: "anon" });
    const [appCall, supaCall] = fetchImpl.mock.calls;
    expect(appCall[1]?.redirect).toBe("manual");
    expect(
      (appCall[1]?.headers as Record<string, string>)[
        "x-vercel-protection-bypass"
      ],
    ).toBe("bi-mat-bypass");
    expect(
      (supaCall[1]?.headers as Record<string, string>)[
        "x-vercel-protection-bypass"
      ],
    ).toBeUndefined();
  });
});

describe("báo cáo", () => {
  it("che bí mật và đếm số kiểm tra đỏ", () => {
    const results = [
      { name: "a", status: "pass" as const, detail: "khóa anon-key-123" },
      { name: "b|c", status: "fail" as const, detail: "x" },
    ];
    const text = redact(formatReport(results, "https://x"), [
      "anon-key-123",
      undefined,
    ]);
    expect(text).not.toContain("anon-key-123");
    expect(text).toMatch(/ĐỎ: 1\/2/);
    expect(formatSummary(results, "https://x")).toContain("b\\|c");
  });
});

/**
 * Chạy đủ luồng với máy chủ HTTP giả lập ứng dụng + Supabase (fetch thật, không mạng ngoài).
 */
describe("runSmoke với máy chủ giả", () => {
  let servers: Server[] = [];
  afterEach(async () => {
    await Promise.all(
      servers.map((s) => new Promise((r) => s.close(() => r(null)))),
    );
    servers = [];
  });

  async function listen(server: Server): Promise<string> {
    servers.push(server);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }

  async function startStack(opts: { devUiStatus?: number } = {}) {
    let healthKey: string | undefined;
    const supabaseUrl = await listen(
      createServer((req, res) => {
        healthKey = req.headers["apikey"] as string | undefined;
        res.statusCode = req.url === "/auth/v1/health" && healthKey ? 200 : 401;
        res.end();
      }),
    );
    const appUrl = await listen(
      createServer((req, res) => {
        res.setHeader("content-security-policy", csp(NONCE, supabaseUrl));
        res.setHeader("x-content-type-options", "nosniff");
        res.setHeader("referrer-policy", "strict-origin-when-cross-origin");
        res.setHeader("x-frame-options", "DENY");
        res.setHeader("permissions-policy", "camera=()");
        switch (req.url) {
          case "/login":
            res.end(`<script nonce="${NONCE}"></script>`);
            return;
          case "/api/v1/me":
            res.statusCode = 401;
            res.end(JSON.stringify({ error: { code: "unauthenticated" } }));
            return;
          case "/dev/ui":
            res.statusCode = opts.devUiStatus ?? 404;
            res.end();
            return;
          default:
            res.statusCode = 307;
            res.setHeader("location", "/login");
            res.end();
        }
      }),
    );
    return { appUrl, supabaseUrl, healthKey: () => healthKey };
  }

  it("xanh toàn bộ khi ứng dụng đúng, gửi khóa anon cho Supabase", async () => {
    const stack = await startStack();
    const results = await runSmoke(
      {
        baseUrl: stack.appUrl,
        supabaseUrl: stack.supabaseUrl,
        supabaseAnonKey: "anon-key",
        requireSupabase: true,
      },
      createFetcher({ retries: 0 }),
    );
    expect(results.map((r) => [r.name, r.status])).toEqual(
      results.map((r) => [r.name, "pass"]),
    );
    expect(results).toHaveLength(6);
    expect(stack.healthKey()).toBe("anon-key");
  });

  it("đỏ khi /dev/ui lộ ra (bản dev) và khi ứng dụng không chạy", async () => {
    const stack = await startStack({ devUiStatus: 200 });
    const results = await runSmoke(
      { baseUrl: stack.appUrl },
      createFetcher({ retries: 0 }),
    );
    expect(results.find((r) => r.name.includes("/dev/ui"))?.status).toBe(
      "fail",
    );

    const closed = createServer();
    const deadUrl = await listen(closed);
    await new Promise((r) => closed.close(() => r(null)));
    servers = servers.filter((s) => s !== closed);
    const down = await runSmoke(
      { baseUrl: deadUrl },
      createFetcher({ retries: 0, timeoutMs: 2000 }),
    );
    expect(down.filter((r) => r.status === "fail").length).toBeGreaterThan(3);
    expect(down[0].detail).toMatch(/lỗi kết nối/);
  });
});
