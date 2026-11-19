import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { contentDisposition, handleExportReport } from "./handlers";

/**
 * Lõi handler với client giả (không CSDL): ca thiếu template luôn được kiểm dù CSDL cục bộ dùng chung
 * đang có template của phiên khác (tests/integration/reports.test.ts kiểm phần còn lại).
 */

const PROJECT = "00000000-0000-4000-8000-00000000e530";
const USER = "00000000-0000-4000-8000-0000000000a1";

function fakeSession(tables: Record<string, unknown>): SupabaseClient {
  const builder = (table: string) => {
    const b = {
      select: () => b,
      eq: () => b,
      maybeSingle: async () => ({ data: tables[table] ?? null, error: null }),
    };
    return b;
  };
  return {
    auth: {
      getUser: async () => ({ data: { user: { id: USER } }, error: null }),
    },
    from: builder,
  } as unknown as SupabaseClient;
}

function request(body: unknown) {
  return new Request(
    `http://localhost:3000/api/v1/projects/${PROJECT}/reports`,
    {
      method: "POST",
      headers: {
        origin: "http://localhost:3000",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );
}

const base = {
  projects: {
    id: PROJECT,
    name: "Dự án",
    description: null,
    start_date: null,
    end_date: null,
    status: "active",
  },
  project_members: { role: "pm" },
  profiles: {
    full_name: "PM",
    email: "pm@example.com",
    is_admin: false,
    is_active: true,
  },
};

describe("handleExportReport", () => {
  it("không có template xlsx đang dùng: 422 report_template_missing", async () => {
    const res = await handleExportReport(
      request({
        format: "xlsx",
        period_start: "2026-11-01",
        period_end: "2026-11-30",
      }),
      PROJECT,
      { session: fakeSession(base), rateLimit: async () => ({ ok: true }) },
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("report_template_missing");
  });

  it("PM bị khóa: 403 dù còn là PM", async () => {
    const res = await handleExportReport(
      request({
        format: "xlsx",
        period_start: "2026-11-01",
        period_end: "2026-11-30",
      }),
      PROJECT,
      {
        session: fakeSession({
          ...base,
          profiles: { ...base.profiles, is_active: false },
        }),
        rateLimit: async () => ({ ok: true }),
      },
    );
    expect(res.status).toBe(403);
  });
});

describe("contentDisposition", () => {
  it("có tên ASCII dự phòng và tên UTF-8", () => {
    expect(contentDisposition("báo cáo.xlsx")).toBe(
      "attachment; filename=\"b_o_c_o.xlsx\"; filename*=UTF-8''b%C3%A1o%20c%C3%A1o.xlsx",
    );
  });
});
