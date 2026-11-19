import { handleEmailDispatch } from "@/lib/email/dispatch-handler";

/**
 * Worker gửi email nội bộ (Story E4-2). Xác thực bằng `Authorization: Bearer <CRON_SECRET>`, không
 * dùng phiên người dùng. POST cho pg_cron + pg_net (ADR-003) và `make email-dispatch`; GET cho
 * Vercel Cron (chỉ gọi bằng GET). Xem lib/email/dispatch-handler.ts.
 */
export const maxDuration = 60;

export async function POST(request: Request) {
  return handleEmailDispatch(request);
}

export async function GET(request: Request) {
  return handleEmailDispatch(request);
}
