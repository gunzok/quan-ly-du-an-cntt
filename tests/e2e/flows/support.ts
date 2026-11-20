import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  expect,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { withSharedLock } from "@/tests/support/shared-lock";
import { signInWithPassword } from "../login";
import { createTempUsers, type TempUserSpec } from "../temp-data";

/**
 * Hỗ trợ chung cho bộ e2e 9 luồng chính (Story E0-9, QLDA-56; test-strategy.md mục 4).
 *
 * Quy ước của thư mục tests/e2e/flows/:
 * - Mỗi tệp MỘT luồng, MỘT kịch bản liền mạch (chia bước bằng test.step), chạy được độc lập với thứ
 *   tự và song song 4 worker: mọi dữ liệu là dữ liệu tạm có tag riêng (tests/e2e/temp-data.ts),
 *   tự dọn ở afterAll bằng cleanupTempData.
 * - Đăng nhập tối thiểu: mỗi tài khoản qua /login đúng MỘT lần (`loginState`), sau đó mở context mới
 *   bằng storageState (`openAs`). Không dùng persona seed nên không đụng giới hạn đăng nhập theo email.
 * - Axe (WCAG 2.2 AA, lỗi critical/serious làm đỏ) ở màn chính của mỗi bước (`expectNoA11yViolations`).
 * - Kiểm chi tiết từng tính năng (lỗi biên, phân quyền đầy đủ, 360 px từng hộp thoại) đã nằm ở spec
 *   của Story tương ứng; luồng ở đây chỉ nối các bước như người dùng thật đi từ đầu tới cuối.
 */
export const BLOCKING_IMPACTS = new Set(["critical", "serious"]);
export const WCAG_TAGS = [
  "wcag2a",
  "wcag2aa",
  "wcag21a",
  "wcag21aa",
  "wcag22aa",
];

export type StorageState = Awaited<ReturnType<BrowserContext["storageState"]>>;

/** Tag ngẫu nhiên 8 ký tự cho tên dự án, task, email của một lần chạy luồng. */
export const newTag = () => randomUUID().slice(0, 8);

/** Mật khẩu ngẫu nhiên cho tài khoản tạm (không phải bí mật: chỉ sống trong lần chạy). */
export const newPassword = () => `E2e-${randomUUID()}`;

/** Email tài khoản tạm theo quy ước temp-data.ts: e2e-flow<n>-<vai trò>-<tag>@example.com. */
export const flowEmail = (flow: number, role: string, tag: string) =>
  `e2e-flow${flow}-${role}-${tag}@example.com`;

export interface FlowUser {
  id: string;
  email: string;
  password: string;
  name: string;
}

/**
 * Tạo các tài khoản tạm của một luồng (mỗi người một mật khẩu ngẫu nhiên). Id được ghi vào `into`
 * ngay khi tạo để afterAll dọn được cả khi beforeAll đỏ giữa chừng.
 */
export async function createFlowUsers<K extends string>(
  service: SupabaseClient,
  flow: number,
  tag: string,
  names: Record<K, string>,
  into: string[],
): Promise<Record<K, FlowUser>> {
  const keys = Object.keys(names) as K[];
  const specs = Object.fromEntries(
    keys.map((k) => [
      k,
      {
        email: flowEmail(flow, k.toLowerCase(), tag),
        password: newPassword(),
        fullName: names[k],
      },
    ]),
  ) as Record<K, TempUserSpec>;
  const ids: Partial<Record<K, string>> = {};
  try {
    await createTempUsers(service, specs, ids);
  } finally {
    into.push(...(Object.values(ids) as string[]));
  }
  return Object.fromEntries(
    keys.map((k) => [
      k,
      {
        id: ids[k]!,
        email: specs[k].email,
        password: specs[k].password,
        name: specs[k].fullName,
      },
    ]),
  ) as Record<K, FlowUser>;
}

/** Bật quyền Admin cho tài khoản tạm (khóa service, stack cục bộ). */
export async function makeAdmin(service: SupabaseClient, id: string) {
  const { error } = await service
    .from("profiles")
    .update({ is_admin: true })
    .eq("id", id);
  if (error) throw error;
}

/** Tạo dự án tạm do `owner` tạo (trigger thêm owner làm PM), thêm thành viên theo vai trò. */
export async function createProject(
  service: SupabaseClient,
  name: string,
  owner: string,
  members: { user: string; role: "pm" | "member" | "viewer" }[] = [],
): Promise<string> {
  const id = randomUUID();
  const project = await service
    .from("projects")
    .insert({ id, name, created_by: owner });
  if (project.error) throw project.error;
  if (members.length > 0) {
    const rows = members.map((m) => ({
      project_id: id,
      user_id: m.user,
      role: m.role,
    }));
    const { error } = await service.from("project_members").insert(rows);
    if (error) throw error;
  }
  return id;
}

/** Trạng thái của dự án theo thứ tự cột (position). */
export async function projectStatuses(service: SupabaseClient, id: string) {
  const { data, error } = await service
    .from("task_statuses")
    .select("id, name, category")
    .eq("project_id", id)
    .order("position");
  if (error) throw error;
  return data as { id: string; name: string; category: string }[];
}

/**
 * Đăng nhập qua /login MỘT lần trong context riêng rồi trả storageState để mở lại nhiều lần
 * (`openAs`). Context đăng nhập dùng locale vi-VN như cấu hình chung.
 */
export async function loginState(
  browser: Browser,
  baseURL: string,
  user: { email: string; password: string },
): Promise<StorageState> {
  const context = await browser.newContext({ baseURL, locale: "vi-VN" });
  try {
    const page = await context.newPage();
    await signInWithPassword(page, user.email, user.password);
    return await context.storageState();
  } finally {
    await context.close();
  }
}

export interface OpenedPage {
  page: Page;
  context: BrowserContext;
  close: () => Promise<void>;
}

/** Mở context mới đã đăng nhập sẵn (không qua /login). */
export async function openAs(
  browser: Browser,
  baseURL: string,
  state: StorageState,
  opts: {
    colorScheme?: "light" | "dark";
    viewport?: { width: number; height: number };
    acceptDownloads?: boolean;
  } = {},
): Promise<OpenedPage> {
  const context = await browser.newContext({
    baseURL,
    locale: "vi-VN",
    storageState: state,
    colorScheme: opts.colorScheme ?? "light",
    viewport: opts.viewport ?? { width: 1280, height: 900 },
    acceptDownloads: opts.acceptDownloads ?? false,
  });
  const page = await context.newPage();
  return { page, context, close: () => context.close() };
}

/** Hộp thoại đang mở: Radix (role="dialog"/"alertdialog") hoặc thẻ <dialog> gốc. */
export const OPEN_DIALOG =
  '[role="dialog"], [role="alertdialog"], dialog[open]';

/**
 * Axe WCAG 2.2 AA trên trang (hoặc vùng `include`, ví dụ OPEN_DIALOG): không lỗi critical/serious. Chờ hiệu ứng mở hộp
 * thoại xong trước (axe đo màu lúc đang mờ sẽ báo sai tương phản).
 */
export async function expectNoA11yViolations(
  page: Page,
  where: string,
  include?: string,
): Promise<void> {
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getComputedTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => undefined)),
    ),
  );
  let builder = new AxeBuilder({ page }).withTags(WCAG_TAGS);
  if (include) builder = builder.include(include);
  const results = await builder.analyze();
  const blocking = results.violations
    .filter((v) => v.impact && BLOCKING_IMPACTS.has(v.impact))
    .flatMap((v) => v.nodes.map((n) => `${v.id} @ ${n.target.join(" ")}`));
  expect(blocking, `Lỗi trợ năng critical/serious ở ${where}`).toEqual([]);
}

/** Trang không tràn ngang (360 px). */
export async function expectNoHorizontalOverflow(
  page: Page,
  where: string,
): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow, `Trang tràn ngang ở ${where}`).toBeLessThanOrEqual(0);
}

/** Header Origin cho request API ghi (proxy từ chối 403 khi thiếu Origin cùng nguồn). */
export const originHeader = (baseURL: string) => ({
  origin: new URL(baseURL).origin,
});

/**
 * Chạy worker gửi email MỘT lần như pg_cron (POST /api/internal/email/dispatch, Bearer CRON_SECRET).
 * `make test-e2e` bật ứng dụng với CRON_SECRET ngẫu nhiên và EMAIL_PROVIDER=mailpit. Worker nhận mọi
 * dòng đang chờ của CSDL nên giữ khóa "email-outbox" (dùng chung với test tích hợp email) để không
 * gửi mất dòng mà test khác đang chờ kiểm.
 */
export async function dispatchEmails(
  request: APIRequestContext,
): Promise<{ claimed: number; sent: number }> {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    throw new Error(
      "Thiếu CRON_SECRET: chạy bằng `make test-e2e` (đặt CRON_SECRET và EMAIL_PROVIDER=mailpit cho ứng dụng).",
    );
  }
  return withSharedLock("email-outbox", async () => {
    const res = await request.post("/api/internal/email/dispatch", {
      headers: { authorization: `Bearer ${secret}` },
    });
    expect(res.status(), await res.text()).toBe(200);
    const body = (await res.json()) as {
      data: { status: string; claimed: number; sent: number };
    };
    expect(body.data.status, "Worker email chưa bật (EMAIL_PROVIDER)").toBe(
      "ok",
    );
    return body.data;
  });
}
