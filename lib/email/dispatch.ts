import type { SupabaseClient } from "@supabase/supabase-js";
import { consoleEmailLogger, type EmailLogger } from "./log";
import { decideAfterFailure, EMAIL_MAX_ATTEMPTS } from "./retry";
import { isSafeEmailAddress } from "./sanitize";
import { renderTaskEmail, type EmailNotificationType } from "./templates";
import type { EmailSender, SendResult } from "./types";

/** Một dòng outbox đã nhận (public.email_outbox_claim), đủ dữ liệu dựng email. */
export interface ClaimedEmail {
  id: string;
  type: EmailNotificationType;
  task_id: string;
  project_id: string;
  attempts: number;
  recipient_email: string;
  recipient_locale: string | null;
  recipient_name: string | null;
  task_title: string;
  project_name: string;
  status_name: string | null;
  actor_name: string | null;
}

export interface DispatchSummary {
  claimed: number;
  sent: number;
  retried: number;
  failed: number;
  /** Gửi xong nhưng không ghi được kết quả (dòng sẽ được nhận lại sau 5 phút). */
  unrecorded: number;
}

export interface DispatchDeps {
  /** Client service_role (outbox chỉ service_role truy cập). */
  db: SupabaseClient;
  sender: EmailSender;
  appBaseUrl: string;
  /** Số dòng tối đa mỗi lần chạy (1..100). */
  limit?: number;
  /** Nghỉ giữa hai lần gửi (giới hạn tần suất của nhà cung cấp, ví dụ Resend 2 yêu cầu/giây). */
  sendIntervalMs?: number;
  now?: () => Date;
  log?: EmailLogger;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Worker gửi email theo lô (Story E4-2): nhận dòng đến hạn, dựng email theo ngôn ngữ người nhận,
 * gửi qua EmailSender, ghi kết quả (sent / thử lại có giãn cách / failed). Lỗi một email không
 * dừng cả lô. Log chỉ có id, loại, số lần, mã lỗi (lib/email/log.ts).
 */
export async function dispatchEmailBatch(
  deps: DispatchDeps,
): Promise<DispatchSummary> {
  const log = deps.log ?? consoleEmailLogger;
  const now = deps.now ?? (() => new Date());
  const sleep = deps.sleep ?? defaultSleep;
  const summary: DispatchSummary = {
    claimed: 0,
    sent: 0,
    retried: 0,
    failed: 0,
    unrecorded: 0,
  };

  const { data, error } = await deps.db.rpc("email_outbox_claim", {
    p_limit: deps.limit ?? 20,
    p_max_attempts: EMAIL_MAX_ATTEMPTS,
  });
  if (error) throw new Error(`email_outbox_claim: ${error.code ?? "error"}`);
  const rows = (data ?? []) as ClaimedEmail[];
  summary.claimed = rows.length;

  for (const [index, row] of rows.entries()) {
    if (index > 0 && deps.sendIntervalMs) await sleep(deps.sendIntervalMs);
    const result = await sendOne(row, deps);
    const base = {
      outbox_id: row.id,
      type: row.type,
      attempt: row.attempts,
      provider: deps.sender.name,
    };

    let finish: { ok: boolean; error?: string; retryAt?: Date | null };
    if (result.ok) {
      finish = { ok: true };
    } else {
      const decision = decideAfterFailure({
        attempt: row.attempts,
        retryable: result.retryable,
        now: now(),
      });
      finish = {
        ok: false,
        error: result.code,
        retryAt: decision.kind === "retry" ? decision.retryAt : null,
      };
    }

    const { data: changed, error: finishError } = await deps.db.rpc(
      "email_outbox_finish",
      {
        p_id: row.id,
        p_ok: finish.ok,
        p_error: finish.error ?? null,
        p_retry_at: finish.retryAt ? finish.retryAt.toISOString() : null,
      },
    );
    if (finishError || changed !== true) {
      summary.unrecorded += 1;
      log("error", "email.send.lost", {
        ...base,
        sent: result.ok,
        code: finishError?.code ?? "not_pending",
      });
      continue;
    }

    if (result.ok) {
      summary.sent += 1;
      log("info", "email.send.sent", base);
    } else if (finish.retryAt) {
      summary.retried += 1;
      log("warn", "email.send.retry", {
        ...base,
        code: result.code,
        retry_at: finish.retryAt.toISOString(),
      });
    } else {
      summary.failed += 1;
      log("error", "email.send.failed", {
        ...base,
        code: result.code,
        retryable: result.retryable,
      });
    }
  }

  return summary;
}

async function sendOne(
  row: ClaimedEmail,
  deps: DispatchDeps,
): Promise<SendResult> {
  const to = (row.recipient_email ?? "").trim();
  if (!isSafeEmailAddress(to)) {
    return { ok: false, retryable: false, code: "invalid_recipient" };
  }
  let rendered;
  try {
    rendered = renderTaskEmail({
      type: row.type,
      locale: row.recipient_locale,
      appBaseUrl: deps.appBaseUrl,
      projectId: row.project_id,
      taskId: row.task_id,
      taskTitle: row.task_title,
      projectName: row.project_name,
      statusName: row.status_name,
      actorName: row.actor_name,
    });
  } catch {
    return { ok: false, retryable: false, code: "render_error" };
  }
  try {
    return await deps.sender.send({
      to,
      ...rendered,
      idempotencyKey: `qlda-email-${row.id}`,
    });
  } catch {
    // Bộ gửi lẽ ra không ném lỗi; nếu có thì coi như lỗi tạm thời, không để lọt thông điệp gốc.
    return {
      ok: false,
      retryable: true,
      code: `${deps.sender.name}_exception`,
    };
  }
}
