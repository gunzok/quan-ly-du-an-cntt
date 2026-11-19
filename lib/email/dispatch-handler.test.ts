import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { handleEmailDispatch } from "./dispatch-handler";

const SECRET = "c".repeat(40);
const req = (auth?: string) =>
  new Request("http://localhost:3000/api/internal/email/dispatch", {
    method: "POST",
    headers: auth ? { authorization: auth } : {},
  });

const db = () =>
  ({
    rpc: vi.fn(async () => ({ data: [], error: null })),
  }) as unknown as SupabaseClient;

describe("handleEmailDispatch", () => {
  it("thiếu CRON_SECRET: 503, không đụng CSDL", async () => {
    const createDb = vi.fn(db);
    const res = await handleEmailDispatch(req(`Bearer ${SECRET}`), {
      env: {},
      createDb,
      log: () => {},
    });
    expect(res.status).toBe(503);
    expect(createDb).not.toHaveBeenCalled();
  });

  it("sai bí mật: 401, không đụng CSDL", async () => {
    const createDb = vi.fn(db);
    const res = await handleEmailDispatch(req("Bearer sai"), {
      env: { CRON_SECRET: SECRET },
      createDb,
      log: () => {},
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: { code: "unauthenticated" } });
    expect(createDb).not.toHaveBeenCalled();
  });

  it("chưa cấu hình gửi (production): 200 disabled, ghi log, không đụng outbox", async () => {
    const createDb = vi.fn(db);
    const log = vi.fn();
    const res = await handleEmailDispatch(req(`Bearer ${SECRET}`), {
      env: { CRON_SECRET: SECRET, VERCEL_ENV: "production" },
      createDb,
      log,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      data: { status: "disabled", reason: "provider_not_configured" },
    });
    expect(createDb).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith("warn", "email.dispatch.disabled", {
      reason: "provider_not_configured",
    });
  });

  it("đúng bí mật, có cấu hình: chạy một lô, trả số đếm", async () => {
    const res = await handleEmailDispatch(req(`Bearer ${SECRET}`), {
      env: { CRON_SECRET: SECRET, EMAIL_PROVIDER: "mailpit" },
      createDb: db,
      log: () => {},
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      data: {
        status: "ok",
        claimed: 0,
        sent: 0,
        retried: 0,
        failed: 0,
        unrecorded: 0,
      },
    });
  });

  it("thiếu khóa service_role: 503", async () => {
    const res = await handleEmailDispatch(req(`Bearer ${SECRET}`), {
      env: { CRON_SECRET: SECRET, EMAIL_PROVIDER: "mailpit" },
      createDb: () => {
        throw new Error("Thiếu SUPABASE_SERVICE_ROLE_KEY");
      },
      log: () => {},
    });
    expect(res.status).toBe(503);
  });
});
