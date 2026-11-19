/**
 * Kiểm tra khói sau triển khai (Story E0-2, QLDA-33). Gọi vài đường dẫn công khai của bản đã
 * triển khai và dừng với mã khác 0 nếu có kiểm tra đỏ. KHÔNG cần đăng nhập, KHÔNG cần khóa nhạy
 * cảm: chỉ dùng URL ứng dụng, (tùy chọn) URL và khóa anon/publishable của Supabase (vốn công khai
 * trong bundle trình duyệt) và (tùy chọn) mã vượt Deployment Protection của Vercel.
 *
 * Các kiểm tra:
 *   1. GET /login: 200, CSP có nonce + 'strict-dynamic', không 'unsafe-eval', mọi thẻ <script>
 *      mang đúng nonce của CSP, đủ header an toàn (HSTS khi https), không X-Powered-By.
 *   2. GET /api/v1/me không cookie: 401, lỗi `unauthenticated` (cổng đăng nhập của proxy chạy).
 *   3. GET /dev/ui: 404 (trang công cụ phát triển không có trên bản production).
 *   4. GET / không cookie: chuyển hướng về /login cùng origin.
 *   5. Supabase: origin trong CSP connect-src khớp URL mong đợi (biến môi trường trên Vercel đúng
 *      dự án), không trỏ về máy cục bộ khi ứng dụng ở xa, và gọi được GET /auth/v1/health.
 *
 * Cách chạy:
 *   make deploy-smoke URL=http://127.0.0.1:3100
 *   node scripts/deploy/smoke.ts https://<tên>.vercel.app
 *
 * Biến môi trường (đều tùy chọn):
 *   SMOKE_SUPABASE_URL (mặc định NEXT_PUBLIC_SUPABASE_URL): URL Supabase mong đợi.
 *   SMOKE_SUPABASE_ANON_KEY (mặc định NEXT_PUBLIC_SUPABASE_ANON_KEY): khóa anon/publishable để
 *     gọi /auth/v1/health. Thiếu khóa thì chỉ kiểm Supabase trả lời được (không 5xx).
 *   SMOKE_REQUIRE_SUPABASE=1: thiếu URL Supabase mong đợi thì ĐỎ thay vì bỏ qua (dùng trong CD).
 *   VERCEL_AUTOMATION_BYPASS_SECRET: mã "Protection Bypass for Automation" của Vercel, gửi trong
 *     header x-vercel-protection-bypass khi bản triển khai bật Deployment Protection.
 *   SMOKE_RETRIES (mặc định 3), SMOKE_RETRY_DELAY_MS (mặc định 5000), SMOKE_TIMEOUT_MS (15000).
 *   GITHUB_STEP_SUMMARY: có thì ghi bảng kết quả (GitHub Actions tự đặt).
 *
 * Không in khóa hay mã vượt bảo vệ. Viết bằng TypeScript chỉ dùng cú pháp xóa được kiểu để Node
 * chạy trực tiếp (như scripts/seed-local-users.ts).
 */
import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export type CheckStatus = "pass" | "fail" | "skip";

export interface CheckResult {
  name: string;
  status: CheckStatus;
  detail: string;
}

/** Phản hồi rút gọn: tên header viết thường. */
export interface SmokeResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export type Fetcher = (
  url: string,
  headers: Record<string, string>,
) => Promise<SmokeResponse>;

export interface SmokeOptions {
  baseUrl: string;
  supabaseUrl?: string;
  supabaseAnonKey?: string;
  requireSupabase?: boolean;
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

export function isLocalHost(hostname: string): boolean {
  return LOCAL_HOSTS.has(hostname);
}

/** Chuẩn hóa URL gốc của ứng dụng; chỉ http(s), http chỉ cho máy cục bộ. */
export function parseBaseUrl(raw: string | undefined): URL {
  if (!raw) {
    throw new Error(
      "Thiếu URL ứng dụng. Ví dụ: make deploy-smoke URL=http://127.0.0.1:3100",
    );
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`URL ứng dụng không hợp lệ: ${raw}`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`URL ứng dụng phải là http(s): ${raw}`);
  }
  if (url.protocol === "http:" && !isLocalHost(url.hostname)) {
    throw new Error(
      `Bản triển khai ở xa phải dùng https (nhận ${url.origin}). http chỉ dùng cho máy cục bộ.`,
    );
  }
  if (url.username || url.password) {
    throw new Error("URL ứng dụng không được chứa tên đăng nhập/mật khẩu.");
  }
  return new URL(url.origin);
}

const pass = (name: string, detail: string): CheckResult => ({
  name,
  status: "pass",
  detail,
});
const fail = (name: string, detail: string): CheckResult => ({
  name,
  status: "fail",
  detail,
});
const skip = (name: string, detail: string): CheckResult => ({
  name,
  status: "skip",
  detail,
});

/** Tách CSP thành map chỉ thị → danh sách nguồn. */
export function parseCsp(csp: string): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const part of csp.split(";")) {
    const tokens = part.trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) continue;
    const [name, ...values] = tokens;
    map.set(name.toLowerCase(), values);
  }
  return map;
}

/** Các giá trị nonce="..." trên thẻ <script> trong HTML (thẻ không có nonce trả chuỗi rỗng). */
export function scriptNonces(html: string): string[] {
  const nonces: string[] = [];
  for (const match of html.matchAll(/<script\b([^>]*)>/gi)) {
    const attr = /\snonce=(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(match[1]);
    nonces.push(attr ? (attr[1] ?? attr[2] ?? attr[3] ?? "") : "");
  }
  return nonces;
}

export const LOGIN_CHECK = "GET /login: 200, CSP nonce, header an toàn";

export function checkLogin(res: SmokeResponse, https: boolean): CheckResult {
  if (res.status !== 200) {
    return fail(LOGIN_CHECK, `mã ${res.status}, mong đợi 200`);
  }
  const problems: string[] = [];
  const csp = res.headers["content-security-policy"] ?? "";
  const directives = parseCsp(csp);
  const scriptSrc = directives.get("script-src") ?? [];
  const nonce = scriptSrc
    .map((v) => /^'nonce-([^']+)'$/.exec(v)?.[1])
    .find(Boolean);
  if (!csp) problems.push("thiếu Content-Security-Policy");
  if (!nonce) problems.push("script-src không có nonce");
  if (!scriptSrc.includes("'strict-dynamic'"))
    problems.push("script-src thiếu 'strict-dynamic'");
  if (scriptSrc.includes("'unsafe-eval'"))
    problems.push("script-src có 'unsafe-eval' (bản dev?)");
  if (scriptSrc.includes("'unsafe-inline'"))
    problems.push("script-src có 'unsafe-inline'");
  if (!(directives.get("frame-ancestors") ?? []).includes("'none'"))
    problems.push("thiếu frame-ancestors 'none'");
  if (nonce) {
    const nonces = scriptNonces(res.body);
    if (nonces.length === 0) {
      problems.push("HTML không có thẻ <script>");
    } else if (nonces.some((n) => n !== nonce)) {
      problems.push("có thẻ <script> không mang đúng nonce của CSP");
    }
  }
  const expected: [string, (v: string) => boolean, string][] = [
    ["x-content-type-options", (v) => v === "nosniff", "nosniff"],
    [
      "referrer-policy",
      (v) => v === "strict-origin-when-cross-origin",
      "strict-origin-when-cross-origin",
    ],
    ["x-frame-options", (v) => v.toUpperCase() === "DENY", "DENY"],
    ["permissions-policy", (v) => v.includes("camera=()"), "camera=()"],
  ];
  if (https) {
    expected.push([
      "strict-transport-security",
      (v) => /max-age=\d+/.test(v),
      "max-age=...",
    ]);
  }
  for (const [name, ok, hint] of expected) {
    const value = res.headers[name];
    if (value === undefined || !ok(value)) {
      problems.push(`${name} sai hoặc thiếu (mong đợi ${hint})`);
    }
  }
  if (res.headers["x-powered-by"] !== undefined) {
    problems.push("lộ header X-Powered-By");
  }
  return problems.length
    ? fail(LOGIN_CHECK, problems.join("; "))
    : pass(LOGIN_CHECK, "CSP có nonce khớp thẻ script, đủ header an toàn");
}

export const ME_CHECK = "GET /api/v1/me không đăng nhập: 401";

export function checkMeUnauthenticated(res: SmokeResponse): CheckResult {
  if (res.status !== 401) {
    return fail(ME_CHECK, `mã ${res.status}, mong đợi 401`);
  }
  let code: unknown;
  try {
    code = (JSON.parse(res.body) as { error?: { code?: unknown } }).error?.code;
  } catch {
    return fail(ME_CHECK, "thân phản hồi không phải JSON");
  }
  return code === "unauthenticated"
    ? pass(ME_CHECK, "401 unauthenticated")
    : fail(ME_CHECK, `mã lỗi ${String(code)}, mong đợi unauthenticated`);
}

export const DEV_CHECK = "GET /dev/ui: 404 trên bản production";

export function checkDevUiHidden(res: SmokeResponse): CheckResult {
  return res.status === 404
    ? pass(DEV_CHECK, "404")
    : fail(
        DEV_CHECK,
        `mã ${res.status}, mong đợi 404 (bản dựng không phải production?)`,
      );
}

export const HOME_CHECK = "GET / chưa đăng nhập: chuyển về /login";

export function checkHomeRedirect(res: SmokeResponse, base: URL): CheckResult {
  if (res.status < 300 || res.status > 399) {
    return fail(HOME_CHECK, `mã ${res.status}, mong đợi chuyển hướng 3xx`);
  }
  const location = res.headers["location"];
  if (!location) {
    return fail(HOME_CHECK, "thiếu header Location");
  }
  const target = new URL(location, base);
  if (target.origin !== base.origin || target.pathname !== "/login") {
    return fail(HOME_CHECK, `chuyển tới ${target.href}, mong đợi /login`);
  }
  return pass(HOME_CHECK, `${res.status} → /login`);
}

export const SUPABASE_CSP_CHECK = "Supabase: CSP connect-src đúng dự án";

/** Origin http(s) của Supabase lấy từ connect-src (bỏ 'self' và ws/wss). */
export function supabaseOriginFromCsp(
  csp: string,
  appOrigin: string,
): string | null {
  const sources = parseCsp(csp).get("connect-src") ?? [];
  for (const source of sources) {
    if (!/^https?:\/\//.test(source)) continue;
    try {
      const origin = new URL(source).origin;
      if (origin !== appOrigin) return origin;
    } catch {
      // nguồn không phải URL: bỏ qua
    }
  }
  return null;
}

export function checkSupabaseCsp(
  cspOrigin: string | null,
  options: { expectedUrl?: string; base: URL; require: boolean },
): CheckResult {
  if (!cspOrigin) {
    return fail(
      SUPABASE_CSP_CHECK,
      "connect-src không có origin Supabase (thiếu NEXT_PUBLIC_SUPABASE_URL khi build?)",
    );
  }
  const cspUrl = new URL(cspOrigin);
  if (!isLocalHost(options.base.hostname) && isLocalHost(cspUrl.hostname)) {
    return fail(
      SUPABASE_CSP_CHECK,
      `bản triển khai trỏ vào Supabase cục bộ ${cspOrigin}`,
    );
  }
  if (!isLocalHost(cspUrl.hostname) && cspUrl.protocol !== "https:") {
    return fail(SUPABASE_CSP_CHECK, `Supabase ở xa phải dùng https`);
  }
  if (!options.expectedUrl) {
    return options.require
      ? fail(
          SUPABASE_CSP_CHECK,
          "thiếu SMOKE_SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL để đối chiếu",
        )
      : skip(
          SUPABASE_CSP_CHECK,
          `không có URL mong đợi để đối chiếu (CSP trỏ ${cspOrigin})`,
        );
  }
  let expected: string;
  try {
    expected = new URL(options.expectedUrl).origin;
  } catch {
    return fail(SUPABASE_CSP_CHECK, "URL Supabase mong đợi không hợp lệ");
  }
  return expected === cspOrigin
    ? pass(SUPABASE_CSP_CHECK, cspOrigin)
    : fail(
        SUPABASE_CSP_CHECK,
        `CSP trỏ ${cspOrigin}, mong đợi ${expected} (biến môi trường Vercel sai dự án?)`,
      );
}

export const SUPABASE_HEALTH_CHECK = "Supabase: GET /auth/v1/health";

export function checkSupabaseHealth(
  res: SmokeResponse,
  withKey: boolean,
): CheckResult {
  if (withKey) {
    return res.status === 200
      ? pass(SUPABASE_HEALTH_CHECK, "200 (khóa anon hợp lệ)")
      : fail(
          SUPABASE_HEALTH_CHECK,
          `mã ${res.status}, mong đợi 200 (dự án tạm dừng hoặc khóa anon sai?)`,
        );
  }
  return res.status < 500
    ? pass(
        SUPABASE_HEALTH_CHECK,
        `trả lời ${res.status} (không có khóa anon nên không kiểm khóa)`,
      )
    : fail(SUPABASE_HEALTH_CHECK, `mã ${res.status} (Supabase lỗi/tạm dừng?)`);
}

/** Chạy toàn bộ kiểm tra. Lỗi mạng của từng kiểm tra thành "fail", không dừng giữa chừng. */
export async function runSmoke(
  options: SmokeOptions,
  fetcher: Fetcher,
): Promise<CheckResult[]> {
  const base = parseBaseUrl(options.baseUrl);
  const https = base.protocol === "https:";
  const results: CheckResult[] = [];
  const get = (path: string, headers: Record<string, string> = {}) =>
    fetcher(new URL(path, base).href, headers);
  const attempt = async (
    name: string,
    run: () => Promise<CheckResult>,
  ): Promise<CheckResult> => {
    try {
      return await run();
    } catch (err) {
      return fail(name, `lỗi kết nối: ${errorMessage(err)}`);
    }
  };

  let csp = "";
  results.push(
    await attempt(LOGIN_CHECK, async () => {
      const res = await get("/login");
      csp = res.headers["content-security-policy"] ?? "";
      return checkLogin(res, https);
    }),
  );
  results.push(
    await attempt(ME_CHECK, async () =>
      checkMeUnauthenticated(
        await get("/api/v1/me", { accept: "application/json" }),
      ),
    ),
  );
  results.push(
    await attempt(DEV_CHECK, async () =>
      checkDevUiHidden(await get("/dev/ui")),
    ),
  );
  results.push(
    await attempt(HOME_CHECK, async () =>
      checkHomeRedirect(await get("/"), base),
    ),
  );

  const cspOrigin = csp ? supabaseOriginFromCsp(csp, base.origin) : null;
  if (!csp) {
    results.push(
      fail(SUPABASE_CSP_CHECK, "không đọc được CSP từ /login"),
      skip(SUPABASE_HEALTH_CHECK, "không biết URL Supabase"),
    );
    return results;
  }
  const cspResult = checkSupabaseCsp(cspOrigin, {
    expectedUrl: options.supabaseUrl,
    base,
    require: options.requireSupabase ?? false,
  });
  results.push(cspResult);
  const healthOrigin =
    cspResult.status === "pass" || cspResult.status === "skip"
      ? cspOrigin
      : null;
  if (!healthOrigin) {
    results.push(
      skip(SUPABASE_HEALTH_CHECK, "bỏ qua vì URL Supabase trong CSP sai"),
    );
    return results;
  }
  const key = options.supabaseAnonKey;
  results.push(
    await attempt(SUPABASE_HEALTH_CHECK, async () =>
      checkSupabaseHealth(
        await fetcher(
          `${healthOrigin}/auth/v1/health`,
          key ? { apikey: key } : {},
        ),
        Boolean(key),
      ),
    ),
  );
  return results;
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) {
    const cause = (err as { cause?: unknown }).cause;
    const causeText = cause instanceof Error ? ` (${cause.message})` : "";
    return `${err.message}${causeText}`;
  }
  return String(err);
}

export interface FetcherOptions {
  bypassSecret?: string;
  appOrigin?: string;
  timeoutMs?: number;
  retries?: number;
  retryDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  fetchImpl?: typeof fetch;
}

/** Mã đáng thử lại: bản triển khai đang khởi động hoặc biên Vercel tạm lỗi. */
const RETRY_STATUS = new Set([502, 503, 504]);

/**
 * Fetcher thật: không theo chuyển hướng, có thời hạn và thử lại khi lỗi mạng/502/503/504.
 * Mã vượt bảo vệ Vercel chỉ gửi tới origin của ứng dụng, không gửi sang Supabase.
 */
export function createFetcher(options: FetcherOptions = {}): Fetcher {
  const fetchImpl = options.fetchImpl ?? fetch;
  const retries = options.retries ?? 3;
  const delay = options.retryDelayMs ?? 5000;
  const timeoutMs = options.timeoutMs ?? 15000;
  const sleep =
    options.sleep ??
    ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  return async (url, headers) => {
    const sendBypass =
      options.bypassSecret &&
      options.appOrigin &&
      new URL(url).origin === options.appOrigin;
    const finalHeaders: Record<string, string> = {
      "user-agent": "qlda-smoke/1",
      ...headers,
      ...(sendBypass
        ? { "x-vercel-protection-bypass": options.bypassSecret as string }
        : {}),
    };
    let lastError: unknown;
    for (let i = 0; i <= retries; i++) {
      if (i > 0) await sleep(delay);
      try {
        const res = await fetchImpl(url, {
          method: "GET",
          headers: finalHeaders,
          redirect: "manual",
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (RETRY_STATUS.has(res.status) && i < retries) {
          await res.body?.cancel();
          lastError = new Error(`mã ${res.status}`);
          continue;
        }
        const out: Record<string, string> = {};
        res.headers.forEach((value, name) => {
          out[name.toLowerCase()] = value;
        });
        return { status: res.status, headers: out, body: await res.text() };
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  };
}

const ICON: Record<CheckStatus, string> = {
  pass: "✓",
  fail: "✗",
  skip: "–",
};

/** Ẩn mọi bí mật đã biết khỏi chuỗi trước khi in (phòng khi máy chủ phản chiếu header). */
export function redact(text: string, secrets: (string | undefined)[]): string {
  let out = text;
  for (const secret of secrets) {
    if (secret && secret.length >= 6) out = out.split(secret).join("***");
  }
  return out;
}

export function formatReport(results: CheckResult[], baseUrl: string): string {
  const lines = [`Kiểm tra khói ${baseUrl}`];
  for (const r of results) {
    lines.push(`  ${ICON[r.status]} ${r.name}: ${r.detail}`);
  }
  const failed = results.filter((r) => r.status === "fail").length;
  lines.push(
    failed
      ? `ĐỎ: ${failed}/${results.length} kiểm tra không đạt.`
      : `XANH: ${results.length} kiểm tra (bỏ qua ${results.filter((r) => r.status === "skip").length}).`,
  );
  return lines.join("\n");
}

export function formatSummary(results: CheckResult[], baseUrl: string): string {
  const escape = (s: string) => s.replace(/\|/g, "\\|");
  return [
    `### Kiểm tra khói ${baseUrl}`,
    "",
    "| | Kiểm tra | Chi tiết |",
    "|---|---|---|",
    ...results.map(
      (r) => `| ${ICON[r.status]} | ${escape(r.name)} | ${escape(r.detail)} |`,
    ),
    "",
  ].join("\n");
}

async function main(): Promise<void> {
  const env = process.env;
  const baseUrl = process.argv[2] ?? env.SMOKE_URL;
  const base = parseBaseUrl(baseUrl);
  const supabaseAnonKey =
    env.SMOKE_SUPABASE_ANON_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const bypassSecret = env.VERCEL_AUTOMATION_BYPASS_SECRET || undefined;
  const numberEnv = (name: string, fallback: number) => {
    const n = Number(env[name]);
    return env[name] && Number.isFinite(n) && n >= 0 ? n : fallback;
  };
  const fetcher = createFetcher({
    bypassSecret,
    appOrigin: base.origin,
    retries: numberEnv("SMOKE_RETRIES", 3),
    retryDelayMs: numberEnv("SMOKE_RETRY_DELAY_MS", 5000),
    timeoutMs: numberEnv("SMOKE_TIMEOUT_MS", 15000),
  });
  const results = await runSmoke(
    {
      baseUrl: base.href,
      supabaseUrl: env.SMOKE_SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL,
      supabaseAnonKey,
      requireSupabase: env.SMOKE_REQUIRE_SUPABASE === "1",
    },
    fetcher,
  );
  const secrets = [supabaseAnonKey, bypassSecret];
  console.log(redact(formatReport(results, base.origin), secrets));
  if (env.GITHUB_STEP_SUMMARY) {
    appendFileSync(
      env.GITHUB_STEP_SUMMARY,
      redact(formatSummary(results, base.origin), secrets),
    );
  }
  if (results.some((r) => r.status === "fail")) {
    process.exit(1);
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
