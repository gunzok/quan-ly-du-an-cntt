/**
 * Header an toàn cho mọi phản hồi (Story E0-5, security.md mục 3 luồng F1).
 *
 * - CSP dùng nonce mới cho từng request (proxy.ts tạo), kèm 'strict-dynamic': chỉ script do
 *   Next.js gắn nonce (và script chúng nạp) được chạy. Không 'unsafe-inline' cho script; không
 *   'unsafe-eval' ở production (dev cần cho React debug).
 * - Header tĩnh (không phụ thuộc request) dùng chung cho next.config.ts (mọi đường dẫn, kể cả tệp
 *   tĩnh) và proxy.ts (phản hồi do proxy tự tạo: chuyển hướng, 401, 403, 429).
 */

export const CSP_HEADER = "Content-Security-Policy";
/** Header nội bộ mang nonce từ proxy tới phần render (Server Component đọc bằng headers()). */
export const NONCE_HEADER = "x-nonce";

export interface CspOptions {
  nonce: string;
  /** NEXT_PUBLIC_SUPABASE_URL; trình duyệt chỉ được kết nối tới origin này (và 'self'). */
  supabaseUrl?: string;
  isDev: boolean;
}

/** Nonce 128 bit ngẫu nhiên, base64 (đủ khó đoán, đúng cú pháp nonce-source của CSP). */
export function createNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

/** Origin http(s) và ws(s) tương ứng của URL Supabase; URL hỏng hoặc thiếu thì bỏ qua. */
export function supabaseOrigins(supabaseUrl: string | undefined): string[] {
  if (!supabaseUrl) {
    return [];
  }
  let url: URL;
  try {
    url = new URL(supabaseUrl);
  } catch {
    return [];
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return [];
  }
  const ws = url.protocol === "https:" ? "wss:" : "ws:";
  return [url.origin, `${ws}//${url.host}`];
}

export function buildContentSecurityPolicy({
  nonce,
  supabaseUrl,
  isDev,
}: CspOptions): string {
  const supabase = supabaseOrigins(supabaseUrl);
  const directives: [string, ...string[]][] = [
    ["default-src", "'self'"],
    [
      "script-src",
      "'self'",
      `'nonce-${nonce}'`,
      "'strict-dynamic'",
      ...(isDev ? ["'unsafe-eval'"] : []),
    ],
    // Thuộc tính style="" do React render phía máy chủ không mang được nonce, nên style vẫn cần
    // 'unsafe-inline' (rủi ro thấp hơn nhiều so với script; script vẫn chặt).
    ["style-src", "'self'", "'unsafe-inline'"],
    ["img-src", "'self'", "blob:", "data:"],
    ["font-src", "'self'"],
    ["connect-src", "'self'", ...supabase],
    ["object-src", "'none'"],
    ["base-uri", "'self'"],
    // Không có JavaScript, form đăng nhập Google là form POST thật và máy chủ chuyển hướng 303
    // sang Supabase Auth; trình duyệt áp form-action cho cả chuỗi chuyển hướng đó.
    [
      "form-action",
      "'self'",
      ...supabase.slice(0, 1),
      "https://accounts.google.com",
    ],
    ["frame-ancestors", "'none'"],
    ["frame-src", "'none'"],
    ["worker-src", "'self'", "blob:"],
    ["manifest-src", "'self'"],
  ];
  if (!isDev) {
    directives.push(["upgrade-insecure-requests"]);
  }
  return directives.map((d) => d.join(" ")).join("; ");
}

export interface StaticHeaderOptions {
  /** HSTS chỉ gửi ở production (NODE_ENV=production). */
  isProduction: boolean;
}

/** Header an toàn không phụ thuộc request. */
export function staticSecurityHeaders({
  isProduction,
}: StaticHeaderOptions): [string, string][] {
  const headers: [string, string][] = [
    ["X-Content-Type-Options", "nosniff"],
    ["Referrer-Policy", "strict-origin-when-cross-origin"],
    [
      "Permissions-Policy",
      "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
    ],
    // Trình duyệt cũ không hiểu frame-ancestors.
    ["X-Frame-Options", "DENY"],
    ["Cross-Origin-Opener-Policy", "same-origin"],
  ];
  if (isProduction) {
    // 2 năm, gồm tên miền con. Không thêm "preload" (cam kết khó gỡ, cần chủ dự án quyết).
    headers.push([
      "Strict-Transport-Security",
      "max-age=63072000; includeSubDomains",
    ]);
  }
  return headers;
}
