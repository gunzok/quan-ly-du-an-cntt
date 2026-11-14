import type { NextConfig } from "next";
import { staticSecurityHeaders } from "./lib/security/headers";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  // Không tiết lộ framework qua header X-Powered-By.
  poweredByHeader: false,
  async headers() {
    // Header an toàn tĩnh cho MỌI đường dẫn, kể cả tệp tĩnh mà proxy.ts bỏ qua. CSP (cần nonce
    // theo request) do proxy.ts đặt. Story E0-5.
    return [
      {
        source: "/:path*",
        headers: staticSecurityHeaders({
          isProduction: process.env.NODE_ENV === "production",
        }).map(([key, value]) => ({ key, value })),
      },
    ];
  },
};

export default nextConfig;
