/**
 * Kết nối stack Supabase CỤC BỘ cho script hiệu năng (Story E0-7): đọc URL/khóa từ
 * `supabase status`, chạy SQL bằng psql, tạo/xóa tài khoản giả qua Auth Admin API.
 *
 * An toàn khi stack dùng chung giữa nhiều worktree:
 *   - Chỉ chấp nhận URL localhost (assertLocalUrl); không bao giờ reset CSDL.
 *   - Chỉ tạo/sửa/xóa tài khoản có email trong bộ perf (perf-...@example.com), không đụng persona
 *     của `make db-seed`.
 *   - Không in mật khẩu hay khóa.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { assertLocalUrl } from "../seed-local-users.ts";
import type { PerfUser } from "./dataset.ts";

export interface PerfStack {
  apiUrl: string;
  anonKey: string;
  serviceKey: string;
  dbUrl: string;
}

/** Lấy URL, khóa, DB_URL từ JSON của `supabase status -o json`. Chỉ chấp nhận máy cục bộ. */
export function parsePerfStatus(json: string): PerfStack {
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(json) as Record<string, unknown>;
  } catch {
    throw new Error(
      "Không đọc được kết quả `supabase status`. Đã chạy `make db-start` chưa?",
    );
  }
  const str = (...keys: string[]) => {
    for (const k of keys) {
      const v = data[k];
      if (typeof v === "string" && v) return v;
    }
    return "";
  };
  const stack = {
    apiUrl: str("API_URL"),
    // ANON_KEY (JWT) để supabase-js đăng nhập; bản CLI mới có thêm PUBLISHABLE_KEY.
    anonKey: str("ANON_KEY", "PUBLISHABLE_KEY"),
    serviceKey: str("SECRET_KEY", "SERVICE_ROLE_KEY"),
    dbUrl: str("DB_URL"),
  };
  if (!stack.apiUrl || !stack.anonKey || !stack.serviceKey || !stack.dbUrl) {
    throw new Error(
      "`supabase status` thiếu API_URL, khóa hoặc DB_URL. Stack đã chạy chưa?",
    );
  }
  assertLocalUrl(stack.apiUrl);
  assertLocalDbUrl(stack.dbUrl);
  return stack;
}

/** DB_URL phải trỏ vào máy cục bộ (chặn chạy nhầm vào staging/production). */
export function assertLocalDbUrl(dbUrl: string): void {
  let host: string;
  try {
    host = new URL(dbUrl).hostname;
  } catch {
    throw new Error("DB_URL không hợp lệ.");
  }
  if (!["localhost", "127.0.0.1", "[::1]"].includes(host)) {
    throw new Error(
      `Từ chối chạy: CSDL ${host} không phải Supabase cục bộ. Script hiệu năng chỉ dùng cho stack local.`,
    );
  }
}

export function readPerfStack(): PerfStack {
  let out: string;
  try {
    out = execFileSync("supabase", ["status", "-o", "json"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    throw new Error(
      "Không chạy được `supabase status`. Cài Supabase CLI và chạy `make db-start`.",
    );
  }
  return parsePerfStatus(out);
}

/** Lấy project_id trong supabase/config.toml (tên container supabase_db_<project_id>). */
export function supabaseProjectId(toml: string): string {
  const m = /^\s*project_id\s*=\s*"([A-Za-z0-9_.-]+)"/m.exec(toml);
  if (!m) throw new Error("Không thấy project_id trong supabase/config.toml.");
  return m[1];
}

function hasPsql(): boolean {
  try {
    execFileSync("psql", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Chạy SQL bằng psql và trả về stdout. Có psql trên máy thì nối DB_URL; không có thì chạy psql
 * trong container CSDL của Supabase CLI (docker exec), nên không phải cài thêm gì.
 */
export function runSql(stack: PerfStack, sql: string): string {
  const psqlArgs = ["-X", "-q", "-At", "-v", "ON_ERROR_STOP=1"];
  const opts = {
    input: sql,
    encoding: "utf8" as const,
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["pipe", "pipe", "pipe"] as ["pipe", "pipe", "pipe"],
  };
  try {
    if (hasPsql()) {
      return execFileSync("psql", [...psqlArgs, stack.dbUrl], opts);
    }
    const toml = readFileSync(
      fileURLToPath(new URL("../../supabase/config.toml", import.meta.url)),
      "utf8",
    );
    const container = `supabase_db_${supabaseProjectId(toml)}`;
    return execFileSync(
      "docker",
      [
        "exec",
        "-i",
        container,
        "psql",
        ...psqlArgs,
        "-U",
        "postgres",
        "-d",
        "postgres",
      ],
      opts,
    );
  } catch (error) {
    const e = error as { stderr?: string; message?: string };
    // stderr của psql chỉ có thông điệp lỗi SQL (không có mật khẩu: kết nối qua DB_URL cục bộ).
    throw new Error(
      `psql lỗi: ${(e.stderr || e.message || String(error)).trim()}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Tài khoản giả qua Auth Admin API (khóa service của stack cục bộ)
// ---------------------------------------------------------------------------
interface AdminUser {
  id: string;
  email?: string;
}

async function adminRequest<T>(
  stack: PerfStack,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(`${stack.apiUrl}/auth/v1/admin${path}`, {
    method,
    headers: {
      apikey: stack.serviceKey,
      Authorization: `Bearer ${stack.serviceKey}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(
      `${method} /auth/v1/admin${path} lỗi ${res.status}: ${text.slice(0, 200)}`,
    );
  }
  return (text ? JSON.parse(text) : undefined) as T;
}

async function listUsersByEmail(
  stack: PerfStack,
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (let page = 1; page <= 50; page++) {
    const data = await adminRequest<{ users: AdminUser[] }>(
      stack,
      "GET",
      `/users?page=${page}&per_page=1000`,
    );
    for (const u of data.users) {
      if (u.email) map.set(u.email.toLowerCase(), u.id);
    }
    if (data.users.length < 1000) break;
  }
  return map;
}

/** Bảo đảm chỉ email trong bộ perf mới bị tạo/sửa/xóa. */
export function assertPerfEmail(email: string): void {
  if (!/^perf(-[0-9a-f]{4})?-[a-z0-9]+@example\.com$/.test(email)) {
    throw new Error(
      `Từ chối thao tác trên tài khoản không thuộc bộ perf: ${email}`,
    );
  }
}

export function perfUserPayload(
  u: PerfUser,
  password: string,
  dataset: number,
) {
  assertPerfEmail(u.email);
  return {
    email: u.email,
    password,
    email_confirm: true,
    user_metadata: { full_name: u.fullName },
    // app_metadata chỉ khóa service sửa được; nhãn để nhận ra tài khoản giả của script này.
    app_metadata: { seed_perf: dataset },
  };
}

/** Tạo (hoặc cập nhật mật khẩu) tài khoản perf; trả về key → id. */
export async function ensurePerfUsers(
  stack: PerfStack,
  users: readonly PerfUser[],
  password: string,
  dataset: number,
): Promise<Record<string, string>> {
  const existing = await listUsersByEmail(stack);
  const ids: Record<string, string> = {};
  for (const u of users) {
    const payload = perfUserPayload(u, password, dataset);
    const id = existing.get(u.email.toLowerCase());
    if (id) {
      await adminRequest(stack, "PUT", `/users/${id}`, payload);
      ids[u.key] = id;
    } else {
      const created = await adminRequest<AdminUser>(
        stack,
        "POST",
        "/users",
        payload,
      );
      ids[u.key] = created.id;
    }
  }
  return ids;
}

/** Xóa tài khoản perf (nếu có). Trả về số tài khoản đã xóa. */
export async function deletePerfUsers(
  stack: PerfStack,
  users: readonly PerfUser[],
): Promise<number> {
  const existing = await listUsersByEmail(stack);
  let n = 0;
  for (const u of users) {
    assertPerfEmail(u.email);
    const id = existing.get(u.email.toLowerCase());
    if (!id) continue;
    await adminRequest(stack, "DELETE", `/users/${id}`);
    n++;
  }
  return n;
}
