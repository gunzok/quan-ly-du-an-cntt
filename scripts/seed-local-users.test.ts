import { describe, expect, it } from "vitest";
import {
  DEPARTMENTS,
  MIN_PASSWORD_LENGTH,
  PERSONAS,
  PERSONA_DEPARTMENT,
  PHONES,
  PROJECTS,
  buildMemberships,
  assertLocalUrl,
  buildUserPayload,
  parseStatus,
  readSeedPassword,
} from "./seed-local-users";

describe("PERSONAS", () => {
  it("có đúng 4 persona, email giả không trùng", () => {
    expect(PERSONAS.map((p) => p.key)).toEqual([
      "admin",
      "pm",
      "member",
      "viewer",
    ]);
    const emails = PERSONAS.map((p) => p.email);
    expect(new Set(emails).size).toBe(emails.length);
    // Chỉ tên miền dành riêng cho ví dụ, không dữ liệu thật (repo công khai).
    for (const email of emails) expect(email).toMatch(/@example\.com$/);
  });
});

describe("readSeedPassword", () => {
  it("dừng và hướng dẫn cách đặt khi thiếu SEED_PASSWORD", () => {
    expect(() => readSeedPassword({})).toThrow(
      /Thiếu biến môi trường SEED_PASSWORD[\s\S]*export/,
    );
    expect(() => readSeedPassword({ SEED_PASSWORD: "" })).toThrow(
      /SEED_PASSWORD/,
    );
  });

  it("từ chối mật khẩu quá ngắn", () => {
    expect(() =>
      readSeedPassword({ SEED_PASSWORD: "x".repeat(MIN_PASSWORD_LENGTH - 1) }),
    ).toThrow(/ít nhất/);
  });

  it("trả về đúng giá trị đã đặt", () => {
    const pw = "x".repeat(MIN_PASSWORD_LENGTH);
    expect(readSeedPassword({ SEED_PASSWORD: pw })).toBe(pw);
  });
});

describe("assertLocalUrl", () => {
  it("chấp nhận stack cục bộ", () => {
    expect(assertLocalUrl("http://127.0.0.1:54321").port).toBe("54321");
    expect(assertLocalUrl("http://localhost:54321").hostname).toBe("localhost");
  });

  it("từ chối URL không phải cục bộ", () => {
    expect(() => assertLocalUrl("https://abcd.supabase.co")).toThrow(/Từ chối/);
    expect(() => assertLocalUrl("http://127.0.0.1.evil.example:54321")).toThrow(
      /Từ chối/,
    );
    expect(() => assertLocalUrl("không phải url")).toThrow(/không hợp lệ/);
  });
});

describe("parseStatus", () => {
  it("ưu tiên SECRET_KEY, dự phòng SERVICE_ROLE_KEY", () => {
    expect(
      parseStatus(
        JSON.stringify({
          API_URL: "http://127.0.0.1:54321",
          SECRET_KEY: "s",
          SERVICE_ROLE_KEY: "r",
        }),
      ),
    ).toEqual({ apiUrl: "http://127.0.0.1:54321", serviceKey: "s" });
    expect(
      parseStatus(
        JSON.stringify({
          API_URL: "http://127.0.0.1:54321",
          SERVICE_ROLE_KEY: "r",
        }),
      ),
    ).toEqual({ apiUrl: "http://127.0.0.1:54321", serviceKey: "r" });
  });

  it("báo lỗi khi stack chưa chạy hoặc không phải cục bộ", () => {
    expect(() => parseStatus("")).toThrow(/db-start/);
    expect(() => parseStatus("{}")).toThrow(/thiếu API_URL/);
    expect(() =>
      parseStatus(
        JSON.stringify({ API_URL: "https://x.supabase.co", SECRET_KEY: "s" }),
      ),
    ).toThrow(/Từ chối/);
  });
});

describe("buildUserPayload", () => {
  it("xác nhận email sẵn, gắn nhãn persona vào app_metadata", () => {
    const payload = buildUserPayload(PERSONAS[1], "mat-khau-thu");
    expect(payload).toEqual({
      email: "pm@example.com",
      password: "mat-khau-thu",
      email_confirm: true,
      user_metadata: { full_name: "Quản lý Dự án Thử" },
      app_metadata: { seed_persona: "pm" },
    });
  });
});

describe("dữ liệu mẫu E1-3", () => {
  const ids = {
    admin: "id-admin",
    pm: "id-pm",
    member: "id-member",
    viewer: "id-viewer",
  } as const;

  it("pm có vai trò khác nhau ở hai dự án (PM ở A, Người xem ở B)", () => {
    const rows = buildMemberships(ids);
    const roleOf = (projectId: string, userId: string) =>
      rows.find((r) => r.project_id === projectId && r.user_id === userId)
        ?.role;
    const [a, b] = PROJECTS;
    expect(roleOf(a.id, ids.pm)).toBe("pm");
    expect(roleOf(b.id, ids.pm)).toBe("viewer");
    expect(roleOf(b.id, ids.member)).toBe("pm");
    expect(roleOf(b.id, ids.viewer)).toBeUndefined();
  });

  it("Admin không cần là thành viên dự án; mỗi dự án có PM là người tạo", () => {
    const rows = buildMemberships(ids);
    expect(rows.some((r) => r.user_id === ids.admin)).toBe(false);
    for (const project of PROJECTS) {
      expect(project.members[project.createdBy]).toBe("pm");
    }
  });

  it("khóa cố định, không trùng: chạy lại cho cùng kết quả", () => {
    expect(buildMemberships(ids)).toEqual(buildMemberships(ids));
    const projectIds = PROJECTS.map((p) => p.id);
    expect(new Set(projectIds).size).toBe(projectIds.length);
    for (const id of projectIds) expect(id).toMatch(/^[0-9a-f-]{36}$/);
    const rows = buildMemberships(ids);
    const keys = rows.map((r) => `${r.project_id}/${r.user_id}`);
    expect(new Set(keys).size).toBe(keys.length);
    const names = DEPARTMENTS.map((d) => d.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("mọi persona có phòng ban hợp lệ và số điện thoại giả", () => {
    const names = new Set(DEPARTMENTS.map((d) => d.name));
    for (const p of PERSONAS) {
      expect(names.has(PERSONA_DEPARTMENT[p.key])).toBe(true);
      expect(PHONES[p.key]).toMatch(/^0900000\d{3}$/);
    }
  });
});
