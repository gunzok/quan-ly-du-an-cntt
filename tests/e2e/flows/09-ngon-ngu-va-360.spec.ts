import type { SupabaseClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";
import { en } from "@/lib/i18n/messages/en";
import { vi } from "@/lib/i18n/messages/vi";
import { signInWithPassword } from "../login";
import { cleanupTempData, serviceClient } from "../temp-data";
import {
  createFlowUsers,
  createProject,
  expectNoA11yViolations,
  expectNoHorizontalOverflow,
  newTag,
  openAs,
  type FlowUser,
  type StorageState,
} from "./support";

/**
 * Luồng 9 (test-strategy.md mục 4): đổi ngôn ngữ Việt → English ở khung ứng dụng, lựa chọn được giữ
 * sau khi đăng xuất và đăng nhập lại từ trình duyệt sạch; rồi rà các màn chính ở 360 px (bằng tiếng
 * Anh): không tràn ngang, axe không lỗi critical/serious, sáng và tối.
 *
 * Thay test "người đăng nhập chọn English…" của i18n.spec.ts (trùng lặp). Rà 360 px chi tiết từng hộp
 * thoại, vùng bấm 44 px, bàn phím: responsive-a11y.spec.ts (tiếng Việt); ở đây thêm góc tiếng Anh
 * (chuỗi dài hơn dễ làm tràn).
 */
const tag = newTag();
const createdUsers: string[] = [];
const projectIds: string[] = [];
let service: SupabaseClient | null = null;
let pm: FlowUser;
let projectId = "";
let taskId = "";
const projectName = `E2E ${tag} Luồng 9`;
const PHONE = { width: 360, height: 740 };

test.beforeAll(async () => {
  service = serviceClient();
  ({ pm } = await createFlowUsers(
    service,
    9,
    tag,
    { pm: `E2E PM ${tag}` },
    createdUsers,
  ));
  projectId = await createProject(service, projectName, pm.id);
  projectIds.push(projectId);
  const { data, error } = await service
    .from("tasks")
    .insert({
      project_id: projectId,
      title: `Chuẩn bị tài liệu bàn giao hệ thống ${tag}`,
      created_by: pm.id,
      assignee_id: pm.id,
      due_date: "2027-02-01",
    })
    .select("id")
    .single();
  if (error) throw error;
  taskId = data.id as string;
});

test.afterAll(async () => {
  await cleanupTempData(service, { projectIds, userIds: createdUsers });
});

const languageGroup = (page: Page, label: string) =>
  page.getByRole("group", { name: label });

test("Luồng 9: chọn English → đăng xuất, đăng nhập lại vẫn English → rà màn chính ở 360 px (sáng, tối)", async ({
  browser,
  baseURL,
}) => {
  let englishState: StorageState | null = null;

  await test.step("Đăng nhập (tiếng Việt), chọn English ở khung ứng dụng", async () => {
    const context = await browser.newContext({ baseURL, locale: "vi-VN" });
    const page = await context.newPage();
    await signInWithPassword(page, pm.email, pm.password);
    await expect(page.locator("html")).toHaveAttribute("lang", "vi");
    await languageGroup(page, vi.language.groupLabel)
      .getByRole("button", { name: vi.language.en })
      .click();
    await expect(
      page.getByRole("navigation", { name: en.projects.navLabel }),
    ).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    const { data } = await service!
      .from("profiles")
      .select("locale")
      .eq("id", pm.id)
      .single();
    expect(data?.locale).toBe("en");

    await page.getByRole("button", { name: en.home.signOut }).click();
    await expect(page).toHaveURL("/login");
    await expect(
      page.getByRole("heading", { level: 1, name: en.login.heading }),
    ).toBeVisible();
    await context.close();
  });

  await test.step("Trình duyệt sạch (tiếng Việt, không cookie): đăng nhập lại thì về English theo hồ sơ", async () => {
    const context = await browser.newContext({ baseURL, locale: "vi-VN" });
    const page = await context.newPage();
    await signInWithPassword(page, pm.email, pm.password);
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(
      page.getByRole("heading", { level: 1, name: en.projects.pageTitle }),
    ).toBeVisible();
    englishState = await context.storageState();
    await context.close();
  });

  const screens: { name: string; path: string; heading: string | RegExp }[] = [
    { name: "Projects", path: "/", heading: en.projects.pageTitle },
    { name: "Board", path: `/projects/${projectId}`, heading: projectName },
    {
      name: "List",
      path: `/projects/${projectId}/list`,
      heading: new RegExp(projectName),
    },
    {
      name: "Task",
      path: `/projects/${projectId}/tasks/${taskId}`,
      heading: new RegExp(`Chuẩn bị tài liệu bàn giao hệ thống ${tag}`),
    },
    {
      name: "Dashboard",
      path: `/projects/${projectId}/dashboard`,
      heading: en.dashboard.heading,
    },
    { name: "Profile", path: "/profile", heading: en.profile.pageTitle },
  ];

  for (const colorScheme of ["light", "dark"] as const) {
    await test.step(`360 px (${colorScheme}): màn chính không tràn ngang, axe sạch`, async () => {
      const { page, close } = await openAs(browser, baseURL!, englishState!, {
        viewport: PHONE,
        colorScheme,
      });
      for (const screen of screens) {
        await page.goto(screen.path);
        await expect(
          page.getByRole("heading", { level: 1, name: screen.heading }).first(),
        ).toBeVisible();
        await expect(page.locator("html")).toHaveAttribute("lang", "en");
        await expectNoHorizontalOverflow(page, `${screen.name} 360 px`);
        await expectNoA11yViolations(
          page,
          `${screen.name} 360 px (${colorScheme})`,
        );
      }
      await close();
    });
  }
});
