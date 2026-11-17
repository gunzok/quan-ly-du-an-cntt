import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { vi as strings } from "@/lib/i18n/messages/vi";
import { waitForHydration } from "./hydration";

/**
 * Story E6-2 (QLDA-72): nhật ký hoạt động S15 và mục nhật ký trong chi tiết task.
 *
 * Dự án và TÀI KHOẢN TẠM tạo bằng khóa service của stack CỤC BỘ (make test-e2e đặt
 * SUPABASE_SERVICE_ROLE_KEY), mật khẩu ngẫu nhiên: không đụng persona của db-seed. Thay đổi cần
 * "người làm" được ghi bằng client Supabase đăng nhập thẳng (Auth, không qua /login của ứng dụng)
 * để trigger ghi actor_id. Mỗi vai trò chỉ đăng nhập giao diện MỘT lần cho cả tệp (giới hạn
 * loginIp dùng chung). Nhật ký (62 dòng):
 *   hệ thống: tạo dự án, PM người tạo, thêm thành viên (3) · PM: tạo 55 task loạt
 *   · thành viên: tạo task của mình, đổi ưu tiên · PM: tạo task chính, đổi trạng thái (mới nhất).
 */
const t = strings.activity;
const BLOCKING_IMPACTS = new Set(["critical", "serious"]);
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const tag = randomUUID().slice(0, 8);
const password = `E2e-${randomUUID()}`;
const projectId = randomUUID();
const projectName = `E2E ${tag} Nhật ký`;
const emails = {
  pm: `e2e-e6-2-pm-${tag}@example.com`,
  member: `e2e-e6-2-member-${tag}@example.com`,
};
type Who = keyof typeof emails;
const names: Record<Who, string> = {
  pm: `PM Nhật ký ${tag}`,
  member: `Thành viên Nhật ký ${tag}`,
};
const users = {} as Record<Who, string>;
const titles = {
  main: `Task chính ${tag}`,
  own: `Task thành viên ${tag}`,
};
let mainTaskId = "";
const TOTAL = 62;

let service: SupabaseClient | null = null;

function env() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (
    !url ||
    !key ||
    !anon ||
    !/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(url)
  ) {
    throw new Error(
      "Cần NEXT_PUBLIC_SUPABASE_URL (localhost), NEXT_PUBLIC_SUPABASE_ANON_KEY và SUPABASE_SERVICE_ROLE_KEY (make test-e2e).",
    );
  }
  return { url, key, anon };
}

/** Client Supabase đăng nhập bằng tài khoản tạm: thay đổi ghi nhật ký với actor là người này. */
async function actorClient(who: Who): Promise<SupabaseClient> {
  const { url, anon } = env();
  const client = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await client.auth.signInWithPassword({
    email: emails[who],
    password,
  });
  if (error) throw error;
  return client;
}

test.beforeAll(async () => {
  const { url, key } = env();
  service = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  for (const who of Object.keys(emails) as Who[]) {
    const { data, error } = await service.auth.admin.createUser({
      email: emails[who],
      password,
      email_confirm: true,
      user_metadata: { full_name: names[who] },
    });
    if (error) throw error;
    users[who] = data.user.id;
  }
  const project = await service
    .from("projects")
    .insert({ id: projectId, name: projectName, created_by: users.pm });
  if (project.error) throw project.error;
  const member = await service
    .from("project_members")
    .insert({ project_id: projectId, user_id: users.member, role: "member" });
  if (member.error) throw member.error;
  const statuses = await service
    .from("task_statuses")
    .select("id, category, position")
    .eq("project_id", projectId)
    .order("position");
  if (statuses.error) throw statuses.error;
  const doing = statuses.data.find((s) => s.category === "in_progress")!.id;

  const pm = await actorClient("pm");
  const bulk = await pm.from("tasks").insert(
    Array.from({ length: 55 }, (_, i) => ({
      project_id: projectId,
      title: `Task loạt ${i + 1} ${tag}`,
      priority: "medium",
    })),
  );
  if (bulk.error) throw bulk.error;

  const mem = await actorClient("member");
  const own = await mem
    .from("tasks")
    .insert({ project_id: projectId, title: titles.own, priority: "medium" })
    .select("id")
    .single();
  if (own.error) throw own.error;
  const prio = await mem
    .from("tasks")
    .update({ priority: "urgent" })
    .eq("id", own.data.id);
  if (prio.error) throw prio.error;

  const main = await pm
    .from("tasks")
    .insert({ project_id: projectId, title: titles.main, priority: "high" })
    .select("id")
    .single();
  if (main.error) throw main.error;
  mainTaskId = main.data.id as string;
  const status = await pm
    .from("tasks")
    .update({ status_id: doing })
    .eq("id", mainTaskId);
  if (status.error) throw status.error;
});

test.afterAll(async () => {
  if (!service) return;
  await service.from("projects").delete().eq("id", projectId);
  for (const id of Object.values(users))
    await service.auth.admin.deleteUser(id);
});

type Cookies = Awaited<ReturnType<BrowserContext["cookies"]>>;
const sessions: Partial<Record<Who, Cookies>> = {};

async function signInAs(page: Page, who: Who) {
  const saved = sessions[who];
  if (saved) {
    await page.context().addCookies(saved);
    return;
  }
  await page.goto("/login");
  await waitForHydration(page);
  await page.getByLabel(strings.login.emailLabel).fill(emails[who]);
  await page.getByLabel(strings.login.passwordLabel).fill(password);
  await page
    .getByRole("button", { name: strings.login.submit, exact: true })
    .click();
  await expect(page).toHaveURL("/");
  sessions[who] = await page.context().cookies();
}

async function blockingViolations(page: Page) {
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getComputedTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => undefined)),
    ),
  );
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  return results.violations
    .filter((v) => v.impact && BLOCKING_IMPACTS.has(v.impact))
    .flatMap((v) => v.nodes.map((n) => `${v.id} @ ${n.target.join(" ")}`));
}

const rows = (page: Page) =>
  page.getByRole("region", { name: t.listLabel }).locator("[data-activity-id]");

async function openActivity(page: Page) {
  await page.goto(`/projects/${projectId}/activity`);
  await waitForHydration(page);
  await expect(rows(page).first()).toBeVisible();
}

test.describe.serial("Nhật ký hoạt động S15", () => {
  test("AC1: PM thấy mới nhất trước, nhóm theo ngày, tải thêm; axe sáng", async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await signInAs(page, "pm");
    await openActivity(page);
    await expect(
      page.getByRole("link", { name: t.navTab, exact: true }),
    ).toHaveAttribute("aria-current", "page");
    await expect(page.getByText(t.readOnlyNote, { exact: true })).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 3, name: new RegExp(t.today) }),
    ).toBeVisible();

    // Dòng đầu là thay đổi mới nhất: PM đổi trạng thái task chính.
    const first = rows(page).first();
    await expect(first).toContainText(names.pm);
    await expect(first).toContainText(t.task.status(titles.main));
    await expect(first).toContainText(`${t.fields.status_id}:`);
    // Dòng cuối trang đầu không phải bản ghi tạo dự án (cũ nhất) vì còn trang sau.
    await expect(rows(page)).toHaveCount(50);
    await expect(
      page.getByRole("status").filter({ hasText: t.shown(50) }),
    ).toBeAttached();
    expect(await blockingViolations(page)).toEqual([]);

    await page.getByRole("button", { name: t.loadMore, exact: true }).click();
    await expect(rows(page)).toHaveCount(TOTAL);
    await expect(
      page.getByRole("button", { name: t.loadMore, exact: true }),
    ).toHaveCount(0);
    // Cũ nhất ở cuối: hệ thống tạo dự án.
    const last = rows(page).last();
    await expect(last).toContainText(t.system);
    await expect(last).toContainText(t.project.create(projectName));
  });

  test("AC2: lọc người thực hiện, thời gian; khoảng ngược báo lỗi; axe tối", async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await signInAs(page, "pm");
    await openActivity(page);

    await page
      .getByLabel(t.filters.actor, { exact: true })
      .selectOption({ label: names.member });
    await expect(rows(page)).toHaveCount(2);
    for (const row of await rows(page).all()) {
      await expect(row).toContainText(names.member);
    }
    await expect(rows(page).first()).toContainText(t.task.update(titles.own));
    await expect(rows(page).first()).toContainText(
      t.fieldChange(
        t.fields.priority,
        strings.ui.priority.medium,
        strings.ui.priority.urgent,
      ),
    );

    // Hôm nay (giờ Việt Nam): vẫn đủ 2 dòng của thành viên.
    await page
      .getByLabel(t.filters.period, { exact: true })
      .selectOption({ label: t.filters.periods.today });
    await expect(rows(page)).toHaveCount(2);

    // Khoảng tùy chọn kết thúc hôm qua: rỗng có lối bỏ lọc.
    await page
      .getByLabel(t.filters.period, { exact: true })
      .selectOption({ label: t.filters.periods.custom });
    await page.getByLabel(t.filters.to, { exact: true }).fill("2020-01-01");
    await expect(page.getByText(t.emptyFiltered.title)).toBeVisible();
    expect(await blockingViolations(page)).toEqual([]);

    // Khoảng ngược: báo lỗi ngay ở ô, không gọi API.
    await page.getByLabel(t.filters.from, { exact: true }).fill("2020-01-02");
    await expect(page.getByText(t.filters.rangeInvalid)).toBeVisible();

    await page
      .getByRole("button", { name: t.filters.reset, exact: true })
      .first()
      .click();
    await expect(rows(page)).toHaveCount(50);
  });

  test("360 px (tối): không tràn ngang, bộ lọc dùng được", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await signInAs(page, "pm");
    await page.setViewportSize({ width: 360, height: 780 });
    await openActivity(page);
    await page
      .getByLabel(t.filters.period, { exact: true })
      .selectOption({ label: t.filters.periods.custom });
    await expect(
      page.getByLabel(t.filters.from, { exact: true }),
    ).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow, "Trang tràn ngang ở 360 px").toBeLessThanOrEqual(0);
    expect(await blockingViolations(page)).toEqual([]);
  });

  test("Tab Nhật ký trên Bảng cho PM; chi tiết task có mục nhật ký", async ({
    page,
  }) => {
    await signInAs(page, "pm");
    await page.goto(`/projects/${projectId}`);
    await page.getByRole("link", { name: t.navTab, exact: true }).click();
    await expect(page).toHaveURL(`/projects/${projectId}/activity`);

    await page.goto(`/projects/${projectId}/tasks/${mainTaskId}`);
    const section = page.getByRole("region", {
      name: `04 / ${t.taskSection.heading}`,
    });
    await expect(section).toContainText(t.task.status(titles.main));
    await expect(section).toContainText(t.task.create(titles.main));
    await expect(
      section.getByRole("link", { name: t.taskSection.viewProject }),
    ).toHaveAttribute("href", `/projects/${projectId}/activity`);
  });

  test("Thành viên: không có tab, trang báo không có quyền, API 403", async ({
    page,
  }) => {
    await signInAs(page, "member");
    const probe = page.waitForResponse((r) =>
      r.url().includes(`/api/v1/projects/${projectId}/activity`),
    );
    await page.goto(`/projects/${projectId}`);
    expect((await probe).status()).toBe(403);
    await expect(
      page.getByRole("link", { name: strings.projectNav.board, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: t.navTab, exact: true }),
    ).toHaveCount(0);

    await page.goto(`/projects/${projectId}/activity`);
    await expect(page.getByText(t.errors.forbidden)).toBeVisible();
    await expect(page.locator("[data-activity-id]")).toHaveCount(0);

    await page.goto(`/projects/${projectId}/tasks/${mainTaskId}`);
    await expect(
      page.getByRole("heading", { name: new RegExp(t.taskSection.heading) }),
    ).toHaveCount(0);
    const api = await page.request.get(`/api/v1/tasks/${mainTaskId}/activity`);
    expect(api.status()).toBe(403);
  });
});
