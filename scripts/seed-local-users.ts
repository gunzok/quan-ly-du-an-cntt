/**
 * Tạo (hoặc cập nhật) tài khoản thử cho 4 persona trên Supabase CHẠY CỤC BỘ, rồi seed dữ liệu
 * mẫu của Story E1-3 (QLDA-32): Admin, phòng ban, hai dự án với vai trò theo từng dự án,
 * số điện thoại giả.
 *
 * Cách chạy: `make db-seed` (cần `make db-start` trước và biến SEED_PASSWORD).
 *
 * - Chỉ chạy với stack cục bộ: URL và khóa service lấy từ `supabase status`,
 *   và script từ chối mọi URL không phải localhost/127.0.0.1.
 * - Idempotent: tài khoản đã có thì cập nhật lại mật khẩu và metadata, không tạo trùng; dữ liệu
 *   bảng ghi bằng upsert theo khóa cố định (UUID dự án cố định, tên phòng ban duy nhất).
 * - Dữ liệu giả hoàn toàn (tên miền example.com dành riêng cho ví dụ, RFC 2606; số điện thoại
 *   dạng 0900 000 00x không gán cho ai).
 * - Ghi bảng qua PostgREST bằng khóa service (bỏ qua RLS), giống API máy chủ của Admin.
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
    // app_metadata chỉ khóa service mới sửa được; nhãn để nhận ra tài khoản thử.
    app_metadata: { seed_persona: persona.key },
  };
}

interface AdminUser {
  id: string;
  email?: string;
}

function serviceHeaders(stack: LocalStack): Record<string, string> {
  return {
    apikey: stack.serviceKey,
    Authorization: `Bearer ${stack.serviceKey}`,
    "Content-Type": "application/json",
  };
}

async function adminRequest<T>(
  stack: LocalStack,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(`${stack.apiUrl}/auth/v1/admin${path}`, {
    method,
    headers: serviceHeaders(stack),
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

export type UserIds = Record<PersonaKey, string>;

export async function seedUsers(
  stack: LocalStack,
  password: string,
): Promise<UserIds> {
  const ids = {} as UserIds;
  for (const persona of PERSONAS) {
    const payload = buildUserPayload(persona, password);
    const existing = await findUserByEmail(stack, persona.email);
    if (existing) {
      await adminRequest(stack, "PUT", `/users/${existing.id}`, payload);
      ids[persona.key] = existing.id;
      console.log(`Đã cập nhật ${persona.key.padEnd(6)} ${persona.email}`);
    } else {
      const created = await adminRequest<AdminUser>(
        stack,
        "POST",
        "/users",
        payload,
      );
      ids[persona.key] = created.id;
      console.log(`Đã tạo      ${persona.key.padEnd(6)} ${persona.email}`);
    }
  }
  return ids;
}

// ---------------------------------------------------------------------------
// Dữ liệu mẫu E1-3: phòng ban, dự án, vai trò theo dự án, số điện thoại giả
// ---------------------------------------------------------------------------

export type ProjectRole = "pm" | "member" | "viewer";

export interface SeedDepartment {
  name: string;
  position: number;
}

export interface SeedProject {
  id: string;
  name: string;
  description: string;
  startDate: string;
  endDate: string;
  /** Người tạo; trigger add_creator_as_pm biến người này thành PM. */
  createdBy: PersonaKey;
  members: Partial<Record<PersonaKey, ProjectRole>>;
}

export const DEPARTMENTS: readonly SeedDepartment[] = [
  { name: "Phòng Hạ tầng (mẫu)", position: 1 },
  { name: "Phòng Phát triển phần mềm (mẫu)", position: 2 },
  { name: "Phòng Hỗ trợ người dùng (mẫu)", position: 3 },
];

/** Phòng ban của từng persona (theo tên trong DEPARTMENTS). */
export const PERSONA_DEPARTMENT: Record<PersonaKey, string> = {
  admin: "Phòng Hạ tầng (mẫu)",
  pm: "Phòng Phát triển phần mềm (mẫu)",
  member: "Phòng Phát triển phần mềm (mẫu)",
  viewer: "Phòng Hỗ trợ người dùng (mẫu)",
};

/**
 * Hai dự án mẫu, UUID cố định để upsert idempotent. Vai trò theo từng dự án (BR-01):
 * pm là PM ở A nhưng chỉ là Người xem ở B; member là Thành viên ở A nhưng là PM ở B;
 * viewer chỉ thuộc A. Admin không thuộc dự án nào (thấy tất cả nhờ is_admin).
 */
export const PROJECTS: readonly SeedProject[] = [
  {
    id: "5eed0000-0000-4000-8000-00000000000a",
    name: "Dự án mẫu A: Nâng cấp hạ tầng mạng",
    description: "Dữ liệu giả cho môi trường cục bộ.",
    startDate: "2026-11-01",
    endDate: "2027-03-31",
    createdBy: "pm",
    members: { pm: "pm", member: "member", viewer: "viewer" },
  },
  {
    id: "5eed0000-0000-4000-8000-00000000000b",
    name: "Dự án mẫu B: Cổng thông tin nội bộ",
    description: "Dữ liệu giả cho môi trường cục bộ.",
    startDate: "2026-12-01",
    endDate: "2027-06-30",
    createdBy: "member",
    members: { member: "pm", pm: "viewer" },
  },
];

/** Số điện thoại giả, không gán cho ai (đầu số 0900 000 00x). */
export const PHONES: Record<PersonaKey, string> = {
  admin: "0900000001",
  pm: "0900000002",
  member: "0900000003",
  viewer: "0900000004",
};

export interface MembershipRow {
  project_id: string;
  user_id: string;
  role: ProjectRole;
}

/** Dòng project_members cần có, đã đổi persona sang id người dùng. */
export function buildMemberships(ids: UserIds): MembershipRow[] {
  return PROJECTS.flatMap((project) => {
    if (project.members[project.createdBy] !== "pm") {
      throw new Error(`Người tạo dự án ${project.name} phải là PM.`);
    }
    return (Object.entries(project.members) as [PersonaKey, ProjectRole][]).map(
      ([key, role]) => ({ project_id: project.id, user_id: ids[key], role }),
    );
  });
}

async function restRequest<T>(
  stack: LocalStack,
  method: string,
  path: string,
  body: unknown,
  prefer: string,
): Promise<T> {
  const res = await fetch(`${stack.apiUrl}/rest/v1${path}`, {
    method,
    headers: { ...serviceHeaders(stack), Prefer: prefer },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${method} /rest/v1${path} lỗi ${res.status}: ${text}`);
  }
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

/** INSERT ... ON CONFLICT DO UPDATE qua PostgREST, trả về các dòng sau khi ghi. */
function upsert<T>(
  stack: LocalStack,
  table: string,
  onConflict: string,
  rows: unknown[],
): Promise<T> {
  return restRequest<T>(
    stack,
    "POST",
    `/${table}?on_conflict=${onConflict}`,
    rows,
    "resolution=merge-duplicates,return=representation",
  );
}

export async function seedProjectData(
  stack: LocalStack,
  ids: UserIds,
): Promise<void> {
  const departments = await upsert<{ id: string; name: string }[]>(
    stack,
    "departments",
    "name",
    DEPARTMENTS.map((d) => ({ name: d.name, position: d.position })),
  );
  const deptId = new Map(departments.map((d) => [d.name, d.id]));
  console.log(`Phòng ban:  ${departments.length}`);

  // profiles do trigger tạo khi có user; ở đây chỉ cập nhật. is_admin chỉ cho admin.
  for (const persona of PERSONAS) {
    await restRequest(
      stack,
      "PATCH",
      `/profiles?id=eq.${ids[persona.key]}`,
      {
        full_name: persona.fullName,
        is_admin: persona.key === "admin",
        is_active: true,
        locale: "vi",
        department_id: deptId.get(PERSONA_DEPARTMENT[persona.key]),
      },
      "return=minimal",
    );
  }
  console.log(`Hồ sơ:      ${PERSONAS.length} (is_admin cho admin)`);

  await upsert(
    stack,
    "projects",
    "id",
    PROJECTS.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      start_date: p.startDate,
      end_date: p.endDate,
      status: "active",
      created_by: ids[p.createdBy],
    })),
  );
  const memberships = buildMemberships(ids);
  await upsert(stack, "project_members", "project_id,user_id", memberships);
  console.log(
    `Dự án:      ${PROJECTS.length}, thành viên dự án: ${memberships.length}`,
  );

  await upsert(
    stack,
    "profile_contacts",
    "user_id",
    PERSONAS.map((p) => ({ user_id: ids[p.key], phone: PHONES[p.key] })),
  );
  console.log(`Số điện thoại giả: ${PERSONAS.length}`);
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
  const ids = await seedUsers(stack, password);
  await seedProjectData(stack, ids);
  console.log(
    `Xong: ${PERSONAS.length} tài khoản (cùng mật khẩu SEED_PASSWORD) và dữ liệu mẫu E1-3.`,
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
