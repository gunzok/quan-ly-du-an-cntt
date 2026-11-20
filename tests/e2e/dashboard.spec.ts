import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { type SupabaseClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";
import { vi as strings } from "@/lib/i18n/messages/vi";
import { cleanupTempData, createTempUsers, serviceClient } from "./temp-data";
import { cachedSignIn } from "./login";

/**
 * Story E5-1 (QLDA-60): dashboard tiến độ S06.
 * Dự án tạm tạo bằng khóa service của stack CỤC BỘ (make test-e2e đặt SUPABASE_SERVICE_ROLE_KEY):
 *   - "số liệu": pm là PM (người tạo), member Thành viên, viewer Người xem; 3 task biết trước
 *     (1 xong, 1 trễ hạn giao member, 1 đang làm chưa giao) => 33%, trễ hạn 1, đang làm 1.
 *   - "rỗng": cùng thành viên, không task (AC2).
 *   - "khác": chỉ pm; viewer là người ngoài => 404 (BR-10).
 * admin không thuộc dự án nào ở trên nhưng là Admin nên xem được.
 * Bốn vai trò là TÀI KHOẢN TẠM (QLDA-56; trước dùng persona seed nên chạm giới hạn đăng nhập theo
 * email khi bộ e2e lớn), mỗi tài khoản đăng nhập một lần rồi dùng lại cookie phiên.
 * Mọi dòng task cùng tập cột (insert nhiều dòng của PostgREST điền null cho cột thiếu).
 * afterAll xóa các dự án tạm (xóa theo task, trạng thái, loại).
 */
const t = strings.dashboard;
const BLOCKING_IMPACTS = new Set(["critical", "serious"]);
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const tag = randomUUID().slice(0, 8);
const projectName = `E2E ${tag} Tổng quan`;
const projectId = randomUUID();
const emptyId = randomUUID();
const otherId = randomUUID();

let service: SupabaseClient | null = null;

const password = `E2e-${randomUUID()}`;
const roles = ["pm", "member", "viewer", "admin"] as const;
type Role = (typeof roles)[number];
const emailOf = (who: Role) => `e2e-e5-1-${who}-${tag}@example.com`;
const users = {} as Record<Role, string>;
const signInAs = cachedSignIn<Role>((who) => ({
  email: emailOf(who),
  password,
}));

/** Ngày YYYY-MM-DD theo giờ Việt Nam, lệch `days` ngày so với hôm nay. */
function vnDate(days: number): string {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
  }).format(new Date());
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

test.beforeAll(async () => {
  service = serviceClient();
  await createTempUsers(
    service,
    Object.fromEntries(
      roles.map((who) => [
        who,
        {
          email: emailOf(who),
          password,
          // Tên người phụ trách hiện ở bảng "theo người phụ trách" (expectSeededNumbers).
          fullName:
            who === "member" ? `Thành viên Thử ${tag}` : `E2E ${who} ${tag}`,
        },
      ]),
    ) as Record<Role, { email: string; password: string; fullName: string }>,
    users,
  );
  const admin = await service
    .from("profiles")
    .update({ is_admin: true })
    .eq("id", users.admin);
  if (admin.error) throw admin.error;
  const { pm, member, viewer } = users;
  const projects = await service.from("projects").insert([
    { id: projectId, name: projectName, created_by: pm },
    { id: emptyId, name: `E2E ${tag} Tổng quan rỗng`, created_by: pm },
    { id: otherId, name: `E2E ${tag} Tổng quan khác`, created_by: pm },
  ]);
  if (projects.error) throw projects.error;
  const members = await service.from("project_members").insert([
    { project_id: projectId, user_id: member, role: "member" },
    { project_id: projectId, user_id: viewer, role: "viewer" },
    { project_id: emptyId, user_id: member, role: "member" },
    { project_id: emptyId, user_id: viewer, role: "viewer" },
  ]);
  if (members.error) throw members.error;

  const statuses = await service
    .from("task_statuses")
    .select("id, category, position")
    .eq("project_id", projectId)
    .order("position");
  if (statuses.error) throw statuses.error;
  const status = (category: string) =>
    statuses.data.find((s) => s.category === category)!.id as string;
  const tasks = await service.from("tasks").insert([
    {
      project_id: projectId,
      title: `E2E ${tag} đã xong`,
      created_by: pm,
      status_id: status("done"),
      assignee_id: pm,
      due_date: vnDate(-10),
      priority: "medium",
    },
    {
      project_id: projectId,
      title: `E2E ${tag} trễ hạn`,
      created_by: pm,
      status_id: status("todo"),
      assignee_id: member,
      due_date: vnDate(-3),
      priority: "urgent",
    },
    {
      project_id: projectId,
      title: `E2E ${tag} đang làm`,
      created_by: pm,
      status_id: status("in_progress"),
      due_date: null,
      priority: "low",
    },
  ]);
  if (tasks.error) throw tasks.error;
});

test.afterAll(async () => {
  await cleanupTempData(service, {
    projectIds: [projectId, emptyId, otherId],
    userIds: Object.values(users),
  });
});

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

const kpi = (page: Page, label: string) =>
  page
    .getByRole("region", { name: t.kpisLabel })
    .getByRole("listitem")
    .filter({ hasText: label });

/** AC1: số liệu khớp 3 task đã seed. */
async function expectSeededNumbers(page: Page) {
  await expect(
    page.getByRole("heading", { level: 1, name: t.heading }),
  ).toBeVisible();
  await expect(
    page.getByRole("progressbar", { name: t.kpi.completionAria(33) }),
  ).toBeVisible();
  await expect(kpi(page, t.kpi.completion)).toContainText(
    t.kpi.completionNote("1", "3"),
  );
  await expect(kpi(page, t.kpi.inProgress)).toContainText("1");
  await expect(kpi(page, t.kpi.overdue)).toContainText("1");
  await expect(kpi(page, t.kpi.blocked)).toContainText("0");

  // Bảng thay thế cho biểu đồ người phụ trách: có hàng "Chưa giao".
  const assignees = page.getByRole("table", { name: t.byAssignee.title });
  await expect(
    assignees.getByRole("row").filter({ hasText: t.byAssignee.unassigned }),
  ).toBeVisible();
  await expect(
    assignees.getByRole("row").filter({ hasText: "Thành viên Thử" }),
  ).toBeVisible();
  // Tóm tắt thanh chồng theo nhóm cho trình đọc màn hình.
  await expect(
    page.getByRole("img", { name: /Phân bố theo nhóm trạng thái/ }),
  ).toBeVisible();

  // Danh sách trễ hạn: đúng task, trễ 3 ngày.
  const overdue = page.getByRole("region", { name: t.overdueList.title });
  await expect(overdue.getByRole("link")).toHaveCount(1);
  await expect(overdue).toContainText(`E2E ${tag} trễ hạn`);
  await expect(overdue).toContainText(t.overdueList.days(3));
}

test.describe.serial("Dashboard tiến độ S06", () => {
  test("PM: vào từ thẻ dự án, số liệu khớp task (AC1), axe sáng", async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await signInAs(page, "pm");
    await page
      .getByRole("link", { name: `${t.open} ${projectName}`, exact: true })
      .click();
    await expect(page).toHaveURL(`/projects/${projectId}/dashboard`);
    await expectSeededNumbers(page);
    expect(await blockingViolations(page)).toEqual([]);
  });

  test("Người xem: cùng số liệu, axe tối", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await signInAs(page, "viewer");
    await page.goto(`/projects/${projectId}/dashboard`);
    await expectSeededNumbers(page);
    expect(await blockingViolations(page)).toEqual([]);
  });

  test("Thành viên và Admin (không thuộc dự án) xem được", async ({ page }) => {
    await signInAs(page, "member");
    await page.goto(`/projects/${projectId}/dashboard`);
    await expectSeededNumbers(page);

    await signInAs(page, "admin");
    await page.goto(`/projects/${projectId}/dashboard`);
    await expectSeededNumbers(page);
  });

  test("AC2: dự án chưa có task có hướng dẫn; Người xem không có nút tạo", async ({
    page,
  }) => {
    await signInAs(page, "member");
    await page.goto(`/projects/${emptyId}/dashboard`);
    await expect(page.getByText(t.empty.title)).toBeVisible();
    await expect(page.getByText(t.empty.bodyCanCreate)).toBeVisible();
    await expect(
      page.getByRole("link", { name: t.empty.action }),
    ).toHaveAttribute("href", `/projects/${emptyId}`);
    expect(await blockingViolations(page)).toEqual([]);

    await signInAs(page, "viewer");
    await page.goto(`/projects/${emptyId}/dashboard`);
    await expect(page.getByText(t.empty.title)).toBeVisible();
    await expect(page.getByText(t.empty.bodyReadOnly)).toBeVisible();
    await expect(page.getByRole("link", { name: t.empty.action })).toHaveCount(
      0,
    );
  });

  test("Người ngoài: trang 404, không lộ tên dự án; API 404", async ({
    page,
  }) => {
    await signInAs(page, "viewer");
    await page.goto(`/projects/${otherId}/dashboard`);
    await expect(page.getByRole("heading", { name: "404" })).toBeVisible();
    await expect(page.getByText(`E2E ${tag} Tổng quan khác`)).toHaveCount(0);
    const api = await page.request.get(`/api/v1/projects/${otherId}/dashboard`);
    expect(api.status()).toBe(404);
  });

  test("360 px (tối): không tràn ngang, vẫn đủ số liệu", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await signInAs(page, "pm");
    await page.setViewportSize({ width: 360, height: 780 });
    await page.goto(`/projects/${projectId}/dashboard`);
    await expectSeededNumbers(page);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow, "Trang tràn ngang ở 360 px").toBeLessThanOrEqual(0);
    expect(await blockingViolations(page)).toEqual([]);
  });
});
