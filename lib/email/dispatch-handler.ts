import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import { resolveEmailConfig, type EmailConfig } from "./config";
import { verifyCronSecret } from "./cron-auth";
import { dispatchEmailBatch } from "./dispatch";
import { consoleEmailLogger, type EmailLogger } from "./log";

/**
 * Lõi Route Handler nội bộ /api/internal/email/dispatch (Story E4-2). Người gọi: pg_cron + pg_net
 * (ADR-003, POST), Vercel Cron (GET) hoặc `make email-dispatch` cục bộ.
 *
 * Thứ tự: CRON_SECRET chưa cấu hình → 503; header Authorization sai → 401 (so khớp thời gian hằng,
 * không dùng phiên người dùng, proxy không kiểm Origin/phiên cho /api/internal/*); chưa cấu hình
 * gửi email → 200 `{status: "disabled"}` + log cảnh báo (không đụng outbox); còn lại gửi một lô và
 * trả số đếm. Không bao giờ trả địa chỉ, nội dung hay lỗi gốc.
 */
export interface DispatchHandlerDeps {
  env?: Record<string, string | undefined>;
  config?: EmailConfig;
  createDb?: () => SupabaseClient;
  log?: EmailLogger;
  limit?: number;
}

function json(body: unknown, status: number) {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

export async function handleEmailDispatch(
  request: Request,
  deps: DispatchHandlerDeps = {},
): Promise<Response> {
  const env = deps.env ?? process.env;
  const log = deps.log ?? consoleEmailLogger;

  const auth = verifyCronSecret(
    request.headers.get("authorization"),
    env.CRON_SECRET,
  );
  if (!auth.ok) {
    log("warn", "email.dispatch.rejected", { reason: auth.reason });
    return auth.reason === "not_configured"
      ? json({ error: { code: "not_configured" } }, 503)
      : json({ error: { code: "unauthenticated" } }, 401);
  }

  const config = deps.config ?? resolveEmailConfig(env);
  if (!config.enabled) {
    log("warn", "email.dispatch.disabled", { reason: config.reason });
    return json({ data: { status: "disabled", reason: config.reason } }, 200);
  }

  let db: SupabaseClient;
  try {
    db = (deps.createDb ?? createServiceRoleClient)();
  } catch {
    log("error", "email.dispatch.error", { stage: "db_config" });
    return json({ error: { code: "not_configured" } }, 503);
  }

  try {
    const summary = await dispatchEmailBatch({
      db,
      sender: config.sender,
      appBaseUrl: config.appBaseUrl,
      limit: deps.limit,
      sendIntervalMs: config.provider === "resend" ? 600 : 0,
      log,
    });
    log("info", "email.dispatch.summary", {
      provider: config.provider,
      ...summary,
    });
    return json({ data: { status: "ok", ...summary } }, 200);
  } catch (error) {
    log("error", "email.dispatch.error", {
      stage: "dispatch",
      message: String((error as Error)?.message ?? "").slice(0, 120),
    });
    return json({ error: { code: "internal_error" } }, 500);
  }
}
