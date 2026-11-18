import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { dispatchEmailBatch, type ClaimedEmail } from "./dispatch";
import type { EmailLogger } from "./log";
import type { EmailSender, SendResult } from "./types";

const PROJECT = "0e91a3b2-1111-4222-8333-444455556666";
const row = (over: Partial<ClaimedEmail> = {}): ClaimedEmail => ({
  id: "11111111-1111-4111-8111-111111111111",
  type: "task_assigned",
  task_id: "b7d4c1e0-aaaa-4bbb-8ccc-ddddeeeeffff",
  project_id: PROJECT,
  attempts: 1,
  recipient_email: "an@cong-ty.vn",
  recipient_locale: "vi",
  recipient_name: "An",
  task_title: "Việc bí mật",
  project_name: "Dự án X",
  status_name: "Mới",
  actor_name: "Bình",
  ...over,
});

function fakeDb(rows: ClaimedEmail[]) {
  const finishes: Record<string, unknown>[] = [];
  const rpc = vi.fn(async (fn: string, args: Record<string, unknown>) => {
    if (fn === "email_outbox_claim") return { data: rows, error: null };
    finishes.push(args);
    return { data: true, error: null };
  });
  return { db: { rpc } as unknown as SupabaseClient, rpc, finishes };
}

function sender(
  results: SendResult[],
): EmailSender & { send: ReturnType<typeof vi.fn> } {
  const send = vi.fn(async () => results.shift() ?? { ok: true });
  return { name: "fake", send };
}

const NOW = new Date("2026-11-18T01:00:00Z");

describe("dispatchEmailBatch", () => {
  it("gửi thành công: finish ok, log không có địa chỉ hay tên task", async () => {
    const { db, rpc, finishes } = fakeDb([row()]);
    const s = sender([{ ok: true }]);
    const lines: string[] = [];
    const log: EmailLogger = (level, event, fields) =>
      lines.push(JSON.stringify({ level, event, ...fields }));
    const summary = await dispatchEmailBatch({
      db,
      sender: s,
      appBaseUrl: "https://qlda.example.com",
      now: () => NOW,
      log,
    });
    expect(summary).toEqual({
      claimed: 1,
      sent: 1,
      retried: 0,
      failed: 0,
      unrecorded: 0,
    });
    expect(rpc).toHaveBeenCalledWith("email_outbox_claim", {
      p_limit: 20,
      p_max_attempts: 4,
    });
    expect(finishes).toEqual([
      {
        p_id: row().id,
        p_ok: true,
        p_error: null,
        p_retry_at: null,
      },
    ]);
    const sent = s.send.mock.calls[0][0];
    expect(sent.to).toBe("an@cong-ty.vn");
    expect(sent.subject).toContain("Việc bí mật");
    expect(sent.idempotencyKey).toBe(`qlda-email-${row().id}`);
    const all = lines.join("\n");
    expect(all).not.toContain("an@cong-ty.vn");
    expect(all).not.toContain("Việc bí mật");
  });

  it("lỗi tạm thời ở lần 1: lên lịch thử lại sau 1 phút", async () => {
    const { db, finishes } = fakeDb([row({ attempts: 1 })]);
    const summary = await dispatchEmailBatch({
      db,
      sender: sender([{ ok: false, retryable: true, code: "fake_http_503" }]),
      appBaseUrl: "https://qlda.example.com",
      now: () => NOW,
      log: () => {},
    });
    expect(summary.retried).toBe(1);
    expect(finishes[0]).toEqual({
      p_id: row().id,
      p_ok: false,
      p_error: "fake_http_503",
      p_retry_at: "2026-11-18T01:01:00.000Z",
    });
  });

  it("lần thứ 4 vẫn lỗi: failed (không còn thử lại)", async () => {
    const { db, finishes } = fakeDb([row({ attempts: 4 })]);
    const summary = await dispatchEmailBatch({
      db,
      sender: sender([{ ok: false, retryable: true, code: "fake_http_503" }]),
      appBaseUrl: "https://qlda.example.com",
      now: () => NOW,
      log: () => {},
    });
    expect(summary.failed).toBe(1);
    expect(finishes[0]).toMatchObject({ p_ok: false, p_retry_at: null });
  });

  it("địa chỉ không hợp lệ: failed ngay, không gọi bộ gửi", async () => {
    const { db, finishes } = fakeDb([
      row({ recipient_email: "a@b.vn\r\nBcc: x@y.z" }),
    ]);
    const s = sender([]);
    await dispatchEmailBatch({
      db,
      sender: s,
      appBaseUrl: "https://qlda.example.com",
      log: () => {},
    });
    expect(s.send).not.toHaveBeenCalled();
    expect(finishes[0]).toMatchObject({
      p_ok: false,
      p_error: "invalid_recipient",
      p_retry_at: null,
    });
  });

  it("bộ gửi ném lỗi: không dừng cả lô, coi như lỗi tạm thời", async () => {
    const { db, finishes } = fakeDb([
      row(),
      row({ id: "22222222-2222-4222-8222-222222222222" }),
    ]);
    const send = vi
      .fn()
      .mockRejectedValueOnce(new Error("boom an@cong-ty.vn"))
      .mockResolvedValueOnce({ ok: true });
    const sleep = vi.fn(async () => {});
    const summary = await dispatchEmailBatch({
      db,
      sender: { name: "fake", send },
      appBaseUrl: "https://qlda.example.com",
      sendIntervalMs: 600,
      sleep,
      now: () => NOW,
      log: () => {},
    });
    expect(summary).toMatchObject({ claimed: 2, sent: 1, retried: 1 });
    expect(finishes[0]).toMatchObject({ p_error: "fake_exception" });
    expect(sleep).toHaveBeenCalledWith(600);
  });

  it("lỗi nhận việc: ném (handler trả 500)", async () => {
    const db = {
      rpc: vi.fn(async () => ({ data: null, error: { code: "42501" } })),
    } as unknown as SupabaseClient;
    await expect(
      dispatchEmailBatch({
        db,
        sender: sender([]),
        appBaseUrl: "https://qlda.example.com",
        log: () => {},
      }),
    ).rejects.toThrow("email_outbox_claim: 42501");
  });
});
