import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * QUY ƯỚC DỮ LIỆU TẠM CHO E2E (stack Supabase cục bộ DÙNG CHUNG giữa các worktree):
 * - Tài khoản tạm: email `e2e-<story>-<vai trò>-<tag>@example.com` (TEMP_EMAIL_RE), mật khẩu ngẫu
 *   nhiên; tạo bằng `createTempUsers` (khóa service, chỉ chấp nhận URL localhost).
 * - Dự án tạm: tên bắt đầu `E2E <tag> ` (TEMP_PROJECT_PREFIX).
 * - Mỗi spec dọn phần của mình ở afterAll bằng `cleanupTempData` (xóa dự án trước, tài khoản sau;
 *   lỗi được in ra chứ không nuốt im lặng). Lần chạy bị ngắt giữa chừng thì `sweepStaleTempData`
 *   (gọi tự động một lần mỗi worker khi tạo tài khoản tạm) dọn đồ sót cũ hơn STALE_AFTER_MS.
 * - KHÔNG bao giờ xóa persona seed (admin@, pm@, member@, viewer@example.com): mọi hàm xóa ở đây
 *   từ chối email không khớp TEMP_EMAIL_RE và dự án không bắt đầu bằng TEMP_PROJECT_PREFIX.
 * Đăng nhập: xem tests/e2e/login.ts.
 */

export const TEMP_EMAIL_RE = /^e2e-[a-z0-9-]+@example\.com$/;
export const TEMP_PROJECT_PREFIX = "E2E ";
/** Đồ sót cũ hơn ngưỡng này mới bị quét: không đụng lần chạy đang diễn ra ở worktree khác. */
export const STALE_AFTER_MS = 2 * 60 * 60 * 1000;

const LOCAL_URL_RE = /^https?:\/\/(127\.0\.0\.1|localhost)[:/]/;

/** Client khóa service của stack CỤC BỘ (make test-e2e đặt biến môi trường). */
export function serviceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key || !LOCAL_URL_RE.test(url)) {
    throw new Error(
      "Cần NEXT_PUBLIC_SUPABASE_URL (localhost) và SUPABASE_SERVICE_ROLE_KEY (make test-e2e).",
    );
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export interface TempUserSpec {
  email: string;
  password: string;
  fullName: string;
}

let sweepOnce: Promise<void> | null = null;

/**
 * Tạo các tài khoản tạm (email đã xác nhận), trả id theo khóa. Id được ghi vào `into` NGAY sau mỗi
 * lần tạo, nên afterAll vẫn dọn được nếu beforeAll đỏ giữa chừng.
 */
export async function createTempUsers<K extends string>(
  service: SupabaseClient,
  specs: Record<K, TempUserSpec>,
  into: Partial<Record<K, string>> = {},
): Promise<Record<K, string>> {
  sweepOnce ??= sweepStaleTempData(service);
  await sweepOnce;
  for (const key of Object.keys(specs) as K[]) {
    const spec = specs[key];
    assertTempEmail(spec.email);
    const { data, error } = await service.auth.admin.createUser({
      email: spec.email,
      password: spec.password,
      email_confirm: true,
      user_metadata: { full_name: spec.fullName },
    });
    if (error) throw error;
    into[key] = data.user.id;
  }
  return into as Record<K, string>;
}

/**
 * Dọn dữ liệu tạm của một spec: dự án (kéo theo task, trạng thái, nhãn, thành viên...) rồi tài
 * khoản. Không ném lỗi (afterAll không làm đỏ test đã xanh) nhưng in cảnh báo để lộ chỗ rò.
 */
export async function cleanupTempData(
  service: SupabaseClient | null,
  {
    projectIds = [],
    userIds = [],
  }: {
    projectIds?: (string | null | undefined)[];
    userIds?: (string | null | undefined)[];
  },
): Promise<void> {
  if (!service) return;
  const problems: string[] = [];
  const projects = projectIds.filter((id): id is string => Boolean(id));
  if (projects.length > 0) {
    const { error } = await service
      .from("projects")
      .delete()
      .in("id", projects)
      .like("name", `${TEMP_PROJECT_PREFIX}%`);
    if (error) problems.push(`dự án ${projects.join(", ")}: ${error.message}`);
  }
  for (const id of userIds) {
    if (!id) continue;
    const problem = await deleteTempUser(service, id);
    if (problem) problems.push(problem);
  }
  if (problems.length > 0) {
    console.warn(
      `[e2e] Chưa dọn được dữ liệu tạm:\n- ${problems.join("\n- ")}`,
    );
  }
}

/** Xóa một tài khoản tạm theo id; trả mô tả lỗi (hoặc null). Từ chối nếu không phải email tạm. */
async function deleteTempUser(
  service: SupabaseClient,
  id: string,
): Promise<string | null> {
  const found = await service.auth.admin.getUserById(id);
  if (found.error) {
    // Đã bị xóa (ví dụ do lần quét khác) thì coi như xong.
    return found.error.status === 404
      ? null
      : `tài khoản ${id}: ${found.error.message}`;
  }
  const email = found.data.user.email ?? "";
  if (!TEMP_EMAIL_RE.test(email)) {
    return `tài khoản ${id} (${email}) không phải tài khoản tạm e2e: bỏ qua`;
  }
  const { error } = await service.auth.admin.deleteUser(id);
  return error ? `tài khoản ${email}: ${error.message}` : null;
}

/**
 * Quét tài khoản `e2e-…@example.com` và dự án `E2E …` cũ hơn STALE_AFTER_MS (sót lại do lần chạy
 * bị ngắt, Ctrl-C, máy treo). Không ném lỗi.
 */
export async function sweepStaleTempData(
  service: SupabaseClient,
  now = Date.now(),
): Promise<void> {
  const cutoff = new Date(now - STALE_AFTER_MS).toISOString();
  try {
    await service
      .from("projects")
      .delete()
      .like("name", `${TEMP_PROJECT_PREFIX}%`)
      .lt("created_at", cutoff);
    for (let page = 1; ; page++) {
      const { data, error } = await service.auth.admin.listUsers({
        page,
        perPage: 1000,
      });
      if (error) throw error;
      const stale = data.users.filter(
        (u) => TEMP_EMAIL_RE.test(u.email ?? "") && u.created_at < cutoff,
      );
      for (const u of stale) await service.auth.admin.deleteUser(u.id);
      if (data.users.length < 1000) break;
    }
  } catch (error) {
    console.warn("[e2e] Quét dữ liệu tạm cũ lỗi:", error);
  }
}

function assertTempEmail(email: string): void {
  if (!TEMP_EMAIL_RE.test(email)) {
    throw new Error(
      `Email tài khoản tạm phải khớp ${TEMP_EMAIL_RE} (nhận: ${email}).`,
    );
  }
}
