/**
 * Tạo (hoặc cập nhật) tài khoản thử cho 4 persona trên Supabase CHẠY CỤC BỘ.
 *
 * Cách chạy: `make db-seed` (cần `make db-start` trước và biến SEED_PASSWORD).
 *
 * - Chỉ chạy với stack cục bộ: URL và khóa service lấy từ `supabase status`,
 *   và script từ chối mọi URL không phải localhost/127.0.0.1.
 * - Idempotent: tài khoản đã có thì cập nhật lại mật khẩu và metadata, không tạo trùng.
 * - Dữ liệu giả hoàn toàn (tên miền example.com dành riêng cho ví dụ, RFC 2606).
 * - Vai trò theo từng dự án (project_members) KHÔNG làm ở đây, Story E1-3 seed sau.
 *
 * Viết bằng TypeScript chỉ dùng cú pháp xóa được kiểu để Node chạy trực tiếp.
 */
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export type PersonaKey = "admin" | "pm" | "member" | "viewer";

export interface Persona {
  key: PersonaKey;
  email: string;
  fullName: string;
}

/** 4 persona trong test-strategy.md mục 3. */
export const PERSONAS: readonly Persona[] = [
  { key: "admin", email: "admin@example.com", fullName: "Quản trị viên Thử" },
  { key: "pm", email: "pm@example.com", fullName: "Quản lý Dự án Thử" },
  { key: "member", email: "member@example.com", fullName: "Thành viên Thử" },
  { key: "viewer", email: "viewer@example.com", fullName: "Người xem Thử" },
];

export const MIN_PASSWORD_LENGTH = 8;

const PASSWORD_HELP = [
  "Đặt mật khẩu cho tài khoản thử rồi chạy lại, ví dụ:",
  "  export SEED_PASSWORD='<mật khẩu tự chọn>'   # chỉ trong phiên shell",
  "hoặc ghi SEED_PASSWORD=<mật khẩu> vào .env.local (không commit, đã có trong .gitignore).",
].join("\n");

/** Đọc SEED_PASSWORD; thiếu hoặc quá ngắn thì báo lỗi kèm cách đặt. Không có mặc định. */
export function readSeedPassword(
  env: Record<string, string | undefined>,
): string {
  const value = env.SEED_PASSWORD;
  if (!value) {
    throw new Error(`Thiếu biến môi trường SEED_PASSWORD.\n${PASSWORD_HELP}`);
  }
  if (value.length < MIN_PASSWORD_LENGTH) {
    throw new Error(
      `SEED_PASSWORD phải có ít nhất ${MIN_PASSWORD_LENGTH} ký tự.\n${PASSWORD_HELP}`,
    );
  }
  return value;
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** Chặn chạy nhầm vào staging/production: chỉ chấp nhận URL http(s) tới máy cục bộ. */
export function assertLocalUrl(url: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`URL Supabase không hợp lệ: ${url}`);
  }
  if (
    !["http:", "https:"].includes(parsed.protocol) ||
    !LOCAL_HOSTS.has(parsed.hostname)
  ) {
    throw new Error(
      `Từ chối chạy: ${parsed.origin} không phải Supabase cục bộ. Script này chỉ dùng cho stack local.`,
    );
  }
  return parsed;
}

export interface LocalStack {
  apiUrl: string;
  serviceKey: string;
}

/** Lấy URL API và khóa service từ kết quả JSON của `supabase status -o json`. */
export function parseStatus(json: string): LocalStack {
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(json) as Record<string, unknown>;
  } catch {
    throw new Error(
      "Không đọc được kết quả `supabase status`. Đã chạy `make db-start` chưa?",
    );
  }
  const apiUrl = data.API_URL;
  // Bản CLI mới có SECRET_KEY (sb_secret_...), bản cũ chỉ có SERVICE_ROLE_KEY (JWT).
  const serviceKey = data.SECRET_KEY ?? data.SERVICE_ROLE_KEY;
  if (
    typeof apiUrl !== "string" ||
    typeof serviceKey !== "string" ||
    !apiUrl ||
    !serviceKey
  ) {
    throw new Error(
      "`supabase status` thiếu API_URL hoặc khóa service. Stack đã chạy chưa?",
    );
  }
  assertLocalUrl(apiUrl);
  return { apiUrl, serviceKey };
}

/** Thân yêu cầu tạo/cập nhật người dùng cho một persona. */
export function buildUserPayload(persona: Persona, password: string) {
  return {
    email: persona.email,
    password,
    email_confirm: true,
    user_metadata: { full_name: persona.fullName },
    // app_metadata chỉ khóa service mới sửa được; E1-3 dùng nhãn này để gán vai trò.
    app_metadata: { seed_persona: persona.key },
  };
}

interface AdminUser {
  id: string;
  email?: string;
}

async function adminRequest<T>(
  stack: LocalStack,
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
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${method} ${path} lỗi ${res.status}: ${text}`);
  }
  return (await res.json()) as T;
}

async function findUserByEmail(
  stack: LocalStack,
  email: string,
): Promise<AdminUser | undefined> {
  // Stack cục bộ chỉ có vài tài khoản thử; một trang 1000 là đủ.
  const data = await adminRequest<{ users: AdminUser[] }>(
    stack,
    "GET",
    "/users?page=1&per_page=1000",
  );
  return data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
}

export async function seedUsers(
  stack: LocalStack,
  password: string,
): Promise<void> {
  for (const persona of PERSONAS) {
    const payload = buildUserPayload(persona, password);
    const existing = await findUserByEmail(stack, persona.email);
    if (existing) {
      await adminRequest(stack, "PUT", `/users/${existing.id}`, payload);
      console.log(`Đã cập nhật ${persona.key.padEnd(6)} ${persona.email}`);
    } else {
      await adminRequest(stack, "POST", "/users", payload);
      console.log(`Đã tạo      ${persona.key.padEnd(6)} ${persona.email}`);
    }
  }
}

function readLocalStack(): LocalStack {
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
  return parseStatus(out);
}

async function main(): Promise<void> {
  const password = readSeedPassword(process.env);
  const stack = readLocalStack();
  console.log(`Seed tài khoản thử vào ${stack.apiUrl}`);
  await seedUsers(stack, password);
  console.log(
    `Xong: ${PERSONAS.length} tài khoản, cùng mật khẩu SEED_PASSWORD.`,
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
