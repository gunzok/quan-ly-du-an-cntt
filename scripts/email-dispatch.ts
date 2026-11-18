/**
 * Chạy tay worker email cục bộ (Story E4-2): `make email-dispatch`.
 * Gọi POST /api/internal/email/dispatch của ứng dụng đang chạy (mặc định `pnpm dev` ở cổng 3000)
 * kèm `Authorization: Bearer $CRON_SECRET` (shell hoặc .env.local). Ứng dụng cần cùng CRON_SECRET.
 * Không in bí mật. Email cục bộ vào Mailpit: http://127.0.0.1:54324.
 */
const url =
  process.env.EMAIL_DISPATCH_URL ??
  "http://localhost:3000/api/internal/email/dispatch";
const secret = process.env.CRON_SECRET;

if (!secret) {
  console.error(
    "Thiếu CRON_SECRET (đặt trong shell hoặc .env.local, ví dụ: openssl rand -hex 32). Ứng dụng phải chạy với cùng giá trị.",
  );
  process.exit(1);
}

const response = await fetch(url, {
  method: "POST",
  headers: { authorization: `Bearer ${secret}` },
}).catch((error: unknown) => {
  console.error(
    `Không gọi được ${url}: ${String((error as Error)?.message ?? error)}. Ứng dụng đã chạy chưa (pnpm dev)?`,
  );
  process.exit(1);
});
const body = await response.text();
console.log(`${response.status} ${body}`);
process.exit(response.ok ? 0 : 1);
