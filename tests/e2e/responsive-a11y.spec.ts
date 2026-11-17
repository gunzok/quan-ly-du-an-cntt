import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { type SupabaseClient } from "@supabase/supabase-js";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { vi as strings } from "@/lib/i18n/messages/vi";
import { cleanupTempData, createTempUsers, serviceClient } from "./temp-data";
import { waitForHydration } from "./hydration";
import { signInWithPassword } from "./login";

/**
 * Story E10-3 (QLDA-69): rà TOÀN BỘ màn chính ở 360 px (S09), sáng và tối (S10), cả vai trò chỉ đọc.
 * Mỗi màn và mỗi hộp thoại/menu mở được kiểm:
 * - không tràn ngang: không phần tử nào thò ra ngoài khung nhìn, trừ khi nằm trong vùng cuộn ngang
 *   có chủ ý (tổ tiên overflow-x auto/scroll nằm gọn trong khung nhìn); nội dung bị khung
 *   overflow hidden cắt mất VẪN tính là lỗi (trừ hình trang trí aria-hidden);
 * - vùng bấm ≥ 44 × 44 px (NFR-10) đo bằng bounding box, gộp cả nhãn của ô chọn; ngoại lệ có chú
 *   thích ở `measureLayout`;
 * - axe (WCAG 2.2 AA) không lỗi critical/serious, ở sáng và tối.
 * Thêm: hộp thoại vừa khung nhìn thấp (bàn phím ảo mở), tương phản khi rê chuột, thứ tự và vòng
 * focus khi Tab, prefers-reduced-motion. Trạng thái lỗi: đăng nhập sai, form Tạo dự án trống.
 * Disabled: WCAG 1.4.3 miễn tương phản cho điều khiển bị vô hiệu; token hover/disabled đã có kiểm
 * ở lib/design/tokens.test.ts.
 *
 * Tài khoản tạm (tests/e2e/temp-data.ts), mỗi vai trò đăng nhập ĐÚNG MỘT lần. Mọi vấn đề gom bằng
 * expect.soft để một lượt chạy liệt kê đủ (bảng màn × kết quả in ra cuối spec).
 */
const BLOCKING_IMPACTS = new Set(["critical", "serious"]);
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const MIN_TARGET = 44;
const PHONE = { width: 360, height: 740 } as const;
/** Bàn phím ảo mở: khung nhìn còn khoảng nửa màn. */
const PHONE_KEYBOARD = { width: 360, height: 360 } as const;

const tag = randomUUID().slice(0, 8);
const password = `E2e-${randomUUID()}`;
const emails = {
  pm: `e2e-e10-3-pm-${tag}@example.com`,
  viewer: `e2e-e10-3-viewer-${tag}@example.com`,
  admin: `e2e-e10-3-admin-${tag}@example.com`,
};
type Who = keyof typeof emails;
const users = {} as Record<Who, string>;
const projectId = randomUUID();
/** Tên dài có chữ có dấu: kiểm xuống dòng, không cắt chữ ở 360 px. */
const projectName = `E2E ${tag} Nâng cấp hệ thống quản lý văn bản điện tử liên thông cấp tỉnh`;
const ids = {
  main: randomUUID(),
  child: randomUUID(),
  blocker: randomUUID(),
  other: randomUUID(),
};

let service: SupabaseClient | null = null;

test.beforeAll(async () => {
  service = serviceClient();
  await createTempUsers(
    service,
    Object.fromEntries(
      (Object.keys(emails) as Who[]).map((who) => [
        who,
        {
          email: emails[who],
          password,
          fullName: `E2E ${who} ${tag} Nguyễn Thị Phương Thảo`,
        },
      ]),
    ),
    users,
  );
  const admin = await service
    .from("profiles")
    .update({ is_admin: true })
    .eq("id", users.admin);
  if (admin.error) throw admin.error;
  const project = await service.from("projects").insert({
    id: projectId,
    name: projectName,
    description:
      "Mô tả dự án đủ dài để kiểm việc xuống dòng trên điện thoại hẹp 360 px.",
    created_by: users.pm,
  });
  if (project.error) throw project.error;
  const members = await service.from("project_members").insert([
    { project_id: projectId, user_id: users.viewer, role: "viewer" },
    { project_id: projectId, user_id: users.admin, role: "member" },
  ]);
  if (members.error) throw members.error;
  const statuses = await service
    .from("task_statuses")
    .select("id")
    .eq("project_id", projectId)
    .order("position");
  if (statuses.error) throw statuses.error;
  const types = await service
    .from("task_types")
    .select("id")
    .eq("project_id", projectId)
    .order("position");
  if (types.error) throw types.error;
  const label = await service
    .from("labels")
    .insert({ project_id: projectId, name: `Giao diện ${tag}` })
    .select("id")
    .single();
  if (label.error) throw label.error;
  const base = {
    project_id: projectId,
    created_by: users.pm,
    status_id: statuses.data[0].id,
    type_id: types.data[0].id,
    priority: "medium",
    assignee_id: null as string | null,
    due_date: null as string | null,
    description: null as string | null,
  };
  const tasks = await service.from("tasks").insert([
    {
      ...base,
      id: ids.main,
      title: `Chuẩn hóa quy trình phê duyệt hồ sơ trực tuyến cho bộ phận một cửa ${tag}`,
      description: "Dòng một\nDòng hai có nội dung dài hơn để kiểm xuống dòng.",
      assignee_id: users.pm,
      priority: "high",
      due_date: "2020-01-01",
    },
    {
      ...base,
      id: ids.blocker,
      title: `Việc chặn ${tag}`,
      status_id: statuses.data[1].id,
      assignee_id: users.admin,
    },
    { ...base, id: ids.other, title: `Việc khác ${tag}`, priority: "urgent" },
  ]);
  if (tasks.error) throw tasks.error;
  const child = await service.from("tasks").insert({
    ...base,
    id: ids.child,
    parent_id: ids.main,
    title: `Việc con ${tag}`,
  });
  if (child.error) throw child.error;
  const taskLabel = await service
    .from("task_labels")
    .insert({ task_id: ids.main, label_id: label.data.id });
  if (taskLabel.error) throw taskLabel.error;
  const rel = await service.from("task_relations").insert({
    from_task_id: ids.blocker,
    to_task_id: ids.main,
    kind: "blocks",
    created_by: users.pm,
  });
  if (rel.error) throw rel.error;
});

test.afterAll(async () => {
  await cleanupTempData(service, {
    projectIds: [projectId],
    userIds: Object.values(users),
  });
  printReport();
});

// ---------------------------------------------------------------------------------------------
// Kiểm tra trong trang
// ---------------------------------------------------------------------------------------------

type LayoutFindings = {
  /** Phần tử thò ra ngoài khung nhìn mà không nằm trong vùng cuộn ngang có chủ ý. */
  overflow: string[];
  /** Phần tử tương tác nhỏ hơn 44 × 44 px (không thuộc ngoại lệ). */
  smallTargets: string[];
  /** Chữ bị cắt bằng dấu "…" mà không có cách đọc đủ (title/aria-label): chỉ báo, không làm đỏ. */
  truncated: string[];
};

/**
 * Đo bố cục trong trình duyệt. `scope`: chỉ đo bên trong phần tử này (hộp thoại/menu đang mở).
 *
 * Ngoại lệ vùng bấm (WCAG 2.5.8 và quy ước dự án), mỗi ngoại lệ đều có lý do:
 * - liên kết NẰM TRONG CÂU (ngoại lệ "inline" của WCAG 2.5.8): kích thước theo dòng chữ;
 * - phần tử chỉ dành cho trình đọc màn hình (sr-only, 1 × 1 px) và link "bỏ qua" chưa focus;
 * - ô nhập liệu nhiều dòng/một dòng chỉ cần cao 44 px (chiều ngang luôn rộng hơn).
 */
async function measureLayout(
  page: Page,
  scope: string | null = null,
): Promise<LayoutFindings> {
  return page.evaluate(
    ({ scope, min }) => {
      const root: Element =
        (scope && document.querySelector(scope)) || document.body;
      const vw = document.documentElement.clientWidth;
      const describe = (el: Element) => {
        const name =
          el.getAttribute("aria-label") ??
          (el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 40);
        const id = el.id ? `#${el.id}` : "";
        const testId = el.getAttribute("data-testid");
        return `${el.tagName.toLowerCase()}${id}${testId ? `[data-testid=${testId}]` : ""} "${name}"`;
      };
      const visible = (el: Element) =>
        el.checkVisibility({ checkVisibilityCSS: true, checkOpacity: false });
      const inViewport = (r: DOMRect) => r.right <= vw + 1 && r.left >= -1;
      /**
       * Có nằm trong vùng CUỘN ngang có chủ ý không: một tổ tiên overflow-x auto/scroll nằm gọn
       * trong khung nhìn. Tổ tiên chỉ "hidden/clip" (ví dụ khung ứng dụng) KHÔNG tính: nội dung
       * thò ra bị cắt mất, người dùng không cuộn tới được.
       */
      const inScroller = (el: Element): boolean => {
        for (
          let p = el.parentElement;
          p && p !== document.body && p !== document.documentElement;
          p = p.parentElement
        ) {
          const ox = getComputedStyle(p).overflowX;
          if (
            (ox === "auto" || ox === "scroll") &&
            inViewport(p.getBoundingClientRect())
          ) {
            return true;
          }
        }
        return false;
      };
      /**
       * Hình trang trí (aria-hidden) cố ý thò ra và bị khung overflow hidden/clip nằm trong khung
       * nhìn cắt bớt (ví dụ vòng tròn ở thanh thương hiệu /login): không mất thông tin.
       */
      const decorativeClipped = (el: Element): boolean => {
        if (!el.closest("[aria-hidden=true]")) return false;
        for (
          let p = el.parentElement;
          p && p !== document.body && p !== document.documentElement;
          p = p.parentElement
        ) {
          const ox = getComputedStyle(p).overflowX;
          if (
            (ox === "hidden" || ox === "clip") &&
            inViewport(p.getBoundingClientRect())
          ) {
            return true;
          }
        }
        return false;
      };
      const isSrOnly = (r: DOMRect) => r.width <= 1 || r.height <= 1;

      const overflow: string[] = [];
      const offenders = new Set<Element>();
      for (const el of root.querySelectorAll("*")) {
        // Bên trong SVG đo theo chính thẻ <svg> (hình vẽ tự cắt theo khung của nó).
        if (el.parentElement?.closest("svg")) continue;
        if (!visible(el)) continue;
        const r = el.getBoundingClientRect();
        if (isSrOnly(r)) continue;
        if (inViewport(r)) continue;
        if (inScroller(el)) continue;
        if (decorativeClipped(el)) continue;
        if (el.parentElement && offenders.has(el.parentElement)) {
          offenders.add(el);
          continue;
        }
        offenders.add(el);
        overflow.push(
          `${describe(el)} [${Math.round(r.left)}→${Math.round(r.right)}]`,
        );
      }
      const docOverflow = document.documentElement.scrollWidth - vw;
      if (!scope && docOverflow > 0) {
        // Kể cả phần tử chỉ dành cho trình đọc màn hình: chúng vẫn đẩy được trang tràn ngang.
        const culprits = [...document.body.querySelectorAll("*")]
          .filter((el) => el.getBoundingClientRect().right > vw + 1)
          .filter((el) => !offenders.has(el))
          .slice(0, 3)
          .map(describe);
        overflow.unshift(
          `document scrollWidth vượt ${docOverflow}px (${culprits.join("; ")})`,
        );
      }

      const selector = [
        "a[href]",
        "button",
        "input:not([type=hidden])",
        "select",
        "textarea",
        "summary",
        "[role=button]",
        "[role=link]",
        "[role=tab]",
        "[role=menuitem]",
        "[role=menuitemradio]",
        "[role=option]",
        "[role=checkbox]",
        "[role=switch]",
        "[role=radio]",
      ].join(",");
      const smallTargets: string[] = [];
      for (const el of root.querySelectorAll(selector)) {
        if (!visible(el)) continue;
        if (el.closest("[inert]")) continue;
        const r = el.getBoundingClientRect();
        if (isSrOnly(r)) continue;
        // Liên kết nằm trong câu: ngoại lệ inline của WCAG 2.5.8.
        if (el.tagName === "A" && getComputedStyle(el).display === "inline") {
          const parent = el.parentElement;
          const ownText = (parent?.textContent ?? "").replace(
            el.textContent ?? "",
            "",
          );
          if (ownText.trim().length > 0) continue;
        }
        let left = r.left;
        let right = r.right;
        let top = r.top;
        let bottom = r.bottom;
        const input = el as HTMLInputElement;
        const label =
          el.closest("label") ?? (input.labels ? input.labels[0] : null);
        if (label) {
          const l = label.getBoundingClientRect();
          left = Math.min(left, l.left);
          right = Math.max(right, l.right);
          top = Math.min(top, l.top);
          bottom = Math.max(bottom, l.bottom);
        }
        const w = right - left;
        const h = bottom - top;
        if (w + 0.5 < min || h + 0.5 < min) {
          smallTargets.push(
            `${describe(el)} ${Math.round(w)}×${Math.round(h)}`,
          );
        }
      }

      const truncated: string[] = [];
      for (const el of root.querySelectorAll("*")) {
        if (!visible(el)) continue;
        const s = getComputedStyle(el);
        if (s.textOverflow !== "ellipsis") continue;
        if (el.scrollWidth <= el.clientWidth + 1) continue;
        if (el.getAttribute("title") || el.closest("[title]")) continue;
        truncated.push(describe(el));
      }
      return { overflow, smallTargets, truncated };
    },
    { scope, min: MIN_TARGET },
  );
}

async function settle(page: Page) {
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getComputedTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => undefined)),
    ),
  );
}

async function blockingViolations(page: Page): Promise<string[]> {
  await settle(page);
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  return results.violations
    .filter((v) => v.impact && BLOCKING_IMPACTS.has(v.impact))
    .flatMap((v) => v.nodes.map((n) => `${v.id} @ ${n.target.join(" ")}`));
}

// ---------------------------------------------------------------------------------------------
// Báo cáo
// ---------------------------------------------------------------------------------------------

type Row = {
  screen: string;
  overflow: number;
  targets: number;
  axeLight: number;
  axeDark: number;
  /** Hộp thoại khi bàn phím ảo mở (chỉ với hộp thoại). */
  lowViewport?: string;
  /** Thứ tự và vòng focus (chỉ với dòng kiểm bàn phím). */
  focus?: string;
  details: string[];
};
const rows: Row[] = [];

function printReport() {
  if (rows.length === 0) return;
  const lines = [
    "| Màn / trạng thái | Tràn ngang | Vùng bấm < 44 | axe sáng | axe tối | Bàn phím mở | Focus |",
    "|---|---|---|---|---|---|---|",
    ...rows.map(
      (r) =>
        `| ${r.screen} | ${r.overflow} | ${r.targets} | ${r.axeLight} | ${r.axeDark} | ${r.lowViewport ?? "—"} | ${r.focus ?? "—"} |`,
    ),
  ];
  const details = rows.flatMap((r) =>
    r.details.length
      ? [`## ${r.screen}`, ...r.details.map((d) => `- ${d}`)]
      : [],
  );
  console.log(
    `\n[E10-3] Kết quả 360 px\n${lines.join("\n")}\n\n${details.join("\n")}\n`,
  );
}

/**
 * Kiểm một màn (hoặc một hộp thoại/menu đang mở khi `scope` có giá trị) ở 360 px, sáng rồi tối.
 * Khung nhìn và chế độ màu do hàm tự đặt; trả về sau khi đã ghi bảng.
 */
async function audit(page: Page, screen: string, scope: string | null = null) {
  await page.setViewportSize(PHONE);
  await page.emulateMedia({ colorScheme: "light" });
  await settle(page);
  const layout = await measureLayout(page, scope);
  const axeLight = await blockingViolations(page);
  await page.emulateMedia({ colorScheme: "dark" });
  const axeDark = await blockingViolations(page);
  await page.emulateMedia({ colorScheme: "light" });
  rows.push({
    screen,
    overflow: layout.overflow.length,
    targets: layout.smallTargets.length,
    axeLight: axeLight.length,
    axeDark: axeDark.length,
    details: [
      ...layout.overflow.map((d) => `tràn ngang: ${d}`),
      ...layout.smallTargets.map((d) => `vùng bấm: ${d}`),
      ...axeLight.map((d) => `axe sáng: ${d}`),
      ...axeDark.map((d) => `axe tối: ${d}`),
      ...layout.truncated.map((d) => `(lưu ý) chữ bị cắt: ${d}`),
    ],
  });
  expect.soft(layout.overflow, `${screen}: tràn ngang ở 360 px`).toEqual([]);
  expect.soft(layout.smallTargets, `${screen}: vùng bấm < 44 px`).toEqual([]);
  expect.soft(axeLight, `${screen}: axe (sáng)`).toEqual([]);
  expect.soft(axeDark, `${screen}: axe (tối)`).toEqual([]);
}

/** Mở trang, chờ tiêu đề cấp 1 và mạng yên. */
async function open(page: Page, path: string) {
  await page.goto(path);
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
  await page.waitForLoadState("networkidle");
}

async function signInAs(page: Page, who: Who) {
  await signInWithPassword(page, emails[who], password);
}

const p = (view = "") => `/projects/${projectId}${view}`;
const DIALOG = "[role=dialog], [role=alertdialog], dialog[open]";

/**
 * Hộp thoại khi bàn phím ảo mở (khung nhìn 360 × 360): hộp nằm gọn trong khung nhìn và nút cuối
 * cùng (thường là nút gửi) cuộn tới được bên trong hộp.
 */
async function checkLowViewport(page: Page, screen: string) {
  await page.setViewportSize(PHONE_KEYBOARD);
  await settle(page);
  const dialog = page.locator(DIALOG).first();
  const box = (await dialog.boundingBox())!;
  const fits =
    box.y >= -1 &&
    box.x >= -1 &&
    box.y + box.height <= PHONE_KEYBOARD.height + 1 &&
    box.x + box.width <= PHONE_KEYBOARD.width + 1;
  const last = dialog.locator("button:visible").last();
  await last.scrollIntoViewIfNeeded();
  const lastBox = await last.boundingBox();
  const reachable =
    lastBox !== null &&
    lastBox.y >= 0 &&
    lastBox.y + lastBox.height <= PHONE_KEYBOARD.height;
  const row = rows.at(-1)!;
  row.lowViewport = fits && reachable ? "đạt" : "LỖI";
  if (!fits) {
    row.details.push(
      `bàn phím mở: hộp thoại ${Math.round(box.width)}×${Math.round(box.height)} tại (${Math.round(box.x)}, ${Math.round(box.y)}) vượt khung nhìn 360×360`,
    );
  }
  if (!reachable) row.details.push("bàn phím mở: nút cuối không cuộn tới được");
  expect.soft(fits, `${screen}: hộp thoại vừa khung nhìn thấp`).toBe(true);
  expect.soft(reachable, `${screen}: nút cuối cuộn tới được`).toBe(true);
  await page.setViewportSize(PHONE);
}

/**
 * Mở một hộp thoại/menu/trạng thái bằng `action`, kiểm như một màn, rồi đóng (mặc định Esc).
 * `scope` = DIALOG: chỉ đo bên trong hộp thoại (phần nền bị khóa) và kiểm khung nhìn thấp.
 */
async function auditOpened(
  page: Page,
  screen: string,
  action: () => Promise<void>,
  scope: string | null = DIALOG,
  close: (() => Promise<void>) | null = () => page.keyboard.press("Escape"),
) {
  await action();
  if (scope) await expect(page.locator(scope).first()).toBeVisible();
  await audit(page, screen, scope);
  if (scope === DIALOG) await checkLowViewport(page, screen);
  if (close) {
    await close();
    if (scope) await expect(page.locator(scope)).toHaveCount(0);
  }
}

/**
 * Tương phản khi rê chuột (axe chỉ đo trạng thái tĩnh): rê lên phần tử rồi chạy riêng luật
 * color-contrast trên chính nó, ở sáng và tối.
 */
async function hoverContrast(page: Page, screen: string, target: Locator) {
  await target.hover();
  await target.evaluate((el) => el.setAttribute("data-e10-3-hover", ""));
  const found: string[] = [];
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await settle(page);
    const results = await new AxeBuilder({ page })
      .include("[data-e10-3-hover]")
      .withRules(["color-contrast"])
      .analyze();
    for (const v of results.violations) {
      for (const n of v.nodes) {
        found.push(`${colorScheme}: ${v.id} @ ${n.target.join(" ")}`);
      }
    }
  }
  await page.emulateMedia({ colorScheme: "light" });
  await target.evaluate((el) => el.removeAttribute("data-e10-3-hover"));
  await page.mouse.move(0, 0);
  rows.push({
    screen: `${screen} (rê chuột)`,
    overflow: 0,
    targets: 0,
    axeLight: found.filter((f) => f.startsWith("light")).length,
    axeDark: found.filter((f) => f.startsWith("dark")).length,
    details: found.map((f) => `tương phản khi rê: ${f}`),
  });
  expect.soft(found, `${screen}: tương phản khi rê chuột`).toEqual([]);
}

/**
 * Bàn phím: Tab qua tối đa `stops` điểm dừng từ đầu trang. Mỗi điểm phải thấy được (có kích thước,
 * có vòng focus: outline hoặc box-shadow), không có tabindex dương (phá thứ tự đọc).
 */
async function checkFocus(page: Page, screen: string, stops = 30) {
  // Gọi ngay sau khi mở trang (focus còn ở body). KHÔNG blur() bằng script: Chromium khi đó bỏ
  // :focus-visible của ô ngày ở lần Tab sau (khác với người dùng bàn phím thật).
  await page.evaluate(() => window.scrollTo(0, 0));
  const problems: string[] = [];
  const positive = await page
    .locator("[tabindex]:not([tabindex^='-']):not([tabindex='0'])")
    .count();
  if (positive > 0) problems.push(`${positive} phần tử có tabindex dương`);
  for (let i = 0; i < stops; i++) {
    await page.keyboard.press("Tab");
    const info = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return null;
      const s = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return {
        name:
          el.getAttribute("aria-label") ??
          (el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 40),
        tag: `${el.tagName.toLowerCase()}${el.getAttribute("type") ? `[type=${el.getAttribute("type")}]` : ""}${el.id ? `#${el.id}` : ""} outline=${s.outlineStyle}/${s.outlineWidth} shadow=${s.boxShadow}`,
        size: r.width > 1 && r.height > 1,
        // Vòng focus có thể vẽ ở khung bọc (:focus-within), ví dụ ô tìm kiếm có biểu tượng.
        ring: [el, el.parentElement, el.parentElement?.parentElement].some(
          (node) => {
            if (!node) return false;
            const st = getComputedStyle(node);
            return (
              (st.outlineStyle !== "none" &&
                parseFloat(st.outlineWidth) >= 1) ||
              (node === el && s.boxShadow !== "none")
            );
          },
        ),
        hidden: el.closest("[aria-hidden=true]") !== null,
        // Ô ngày: Tab cuối cùng vào nút lịch NỘI BỘ (shadow DOM của trình duyệt); khi đó ô không
        // khớp :focus nhưng trình duyệt tự vẽ vòng focus quanh biểu tượng lịch (đã kiểm bằng ảnh).
        nativePicker:
          el instanceof HTMLInputElement &&
          /^(date|time|datetime-local|month|week)$/.test(el.type) &&
          !el.matches(":focus"),
      };
    });
    if (!info) break;
    const label = `${info.tag} "${info.name}"`;
    if (!info.size) problems.push(`focus vào phần tử không thấy: ${label}`);
    else if (!info.ring && !info.nativePicker)
      problems.push(`focus không nhìn thấy: ${label}`);
    if (info.hidden) problems.push(`focus vào phần tử aria-hidden: ${label}`);
  }
  rows.push({
    screen: `${screen} (bàn phím)`,
    overflow: 0,
    targets: 0,
    axeLight: 0,
    axeDark: 0,
    focus: problems.length === 0 ? "đạt" : "LỖI",
    details: problems.map((d) => `bàn phím: ${d}`),
  });
  expect.soft(problems, `${screen}: thứ tự/vòng focus`).toEqual([]);
}

// ---------------------------------------------------------------------------------------------

test.describe.configure({ mode: "default" });
test.setTimeout(300_000);
test.use({ actionTimeout: 15_000 });

test("Chưa đăng nhập: đăng nhập (kể cả lỗi), nhận lời mời", async ({
  page,
}) => {
  await page.setViewportSize(PHONE);
  await open(page, "/login");
  await audit(page, "Đăng nhập");
  await checkFocus(page, "Đăng nhập", 8);
  await auditOpened(
    page,
    "Đăng nhập (sai mật khẩu)",
    async () => {
      await waitForHydration(page);
      await page
        .getByLabel(strings.login.emailLabel)
        .fill(`e2e-e10-3-nobody-${tag}@example.com`);
      await page.getByLabel(strings.login.passwordLabel).fill("sai-mat-khau");
      await page
        .getByRole("button", { name: strings.login.submit, exact: true })
        .click();
      await expect(page.getByRole("alert").first()).toBeVisible();
    },
    null,
    null,
  );
  await open(page, "/auth/accept-invite?token_hash=khong-hop-le");
  await audit(page, "Nhận lời mời (form)");
  await open(page, "/auth/accept-invite");
  await audit(page, "Nhận lời mời (link hỏng)");
});

test("PM: mọi màn dự án, hộp thoại và menu", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await signInAs(page, "pm");
  const button = (name: string | RegExp, exact = true) =>
    page.getByRole("button", { name, exact });

  await test.step("Trang chủ", async () => {
    await open(page, "/");
    await audit(page, "PM · Trang chủ (danh sách dự án)");
    await checkFocus(page, "PM · Trang chủ");
    await hoverContrast(
      page,
      "PM · Nút Tạo dự án",
      button(strings.projects.create, false).first(),
    );
    await hoverContrast(
      page,
      "PM · Nút Đăng xuất",
      button(strings.home.signOut),
    );
    await auditOpened(page, "PM · Hộp thoại Tạo dự án", () =>
      button(strings.projects.create, false).first().click(),
    );
    await auditOpened(
      page,
      "PM · Hộp thoại Tạo dự án (lỗi kiểm tra)",
      async () => {
        await button(strings.projects.create, false).first().click();
        await page.locator(DIALOG).locator("button[type=submit]").click();
        await expect(
          page.locator(DIALOG).locator("[aria-invalid=true]").first(),
        ).toBeVisible();
      },
    );
    await test.step("prefers-reduced-motion", async () => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await button(strings.projects.create, false).first().click();
      const motion = await page.locator(DIALOG).evaluate((el) => {
        const s = getComputedStyle(el);
        return { name: s.animationName, duration: s.animationDuration };
      });
      // Hộp thoại có hiệu ứng mở (fade-in) nhưng thời lượng gần 0 khi người dùng xin giảm chuyển động.
      expect(motion.name).not.toBe("none");
      expect.soft(parseFloat(motion.duration)).toBeLessThanOrEqual(0.001);
      rows.push({
        screen: "PM · Hộp thoại khi prefers-reduced-motion",
        overflow: 0,
        targets: 0,
        axeLight: 0,
        axeDark: 0,
        details:
          parseFloat(motion.duration) <= 0.001
            ? []
            : [`hiệu ứng ${motion.name} vẫn chạy ${motion.duration}`],
      });
      await page.keyboard.press("Escape");
      await expect(page.locator(DIALOG)).toHaveCount(0);
      await page.emulateMedia({ reducedMotion: "no-preference" });
    });
    await auditOpened(page, "PM · Hộp thoại Sửa dự án", () =>
      button(`${strings.projects.card.edit} ${projectName}`).click(),
    );
    await auditOpened(page, "PM · Xác nhận lưu trữ dự án", async () => {
      await button(`${strings.projects.card.archive} ${projectName}`).click();
      await hoverContrast(
        page,
        "PM · Nút nguy hiểm trong xác nhận",
        page.locator(DIALOG).getByRole("button").last(),
      );
    });
    await auditOpened(
      page,
      "PM · Ngăn thông báo",
      () => page.getByRole("button", { name: /^Thông báo/ }).click(),
      "[data-testid=notification-panel]",
    );
  });

  await test.step("Kanban", async () => {
    await open(page, p());
    await audit(page, "PM · Kanban");
    await checkFocus(page, "PM · Kanban");
    await auditOpened(page, "PM · Kanban: menu chuyển cột", () =>
      button(strings.kanban.card.moveMenu(`Việc khác ${tag}`)).click(),
    );
  });

  await test.step("Danh sách", async () => {
    await open(page, p("/list"));
    await audit(page, "PM · Danh sách task");
    await checkFocus(page, "PM · Danh sách task");
    await auditOpened(page, "PM · Hộp thoại Tạo task", () =>
      button(strings.taskList.create.action).click(),
    );
    await auditOpened(page, "PM · Hộp thoại Lưu chế độ xem", () =>
      button(strings.savedViewsManage.saveNew).click(),
    );
    const viewToggle = button(/^Chế độ xem: /, false);
    await auditOpened(
      page,
      "PM · Danh sách: menu chế độ xem mở",
      () => viewToggle.click(),
      null,
      () => viewToggle.click(),
    );
    const columns = button(/^Chọn cột \(/, false);
    await auditOpened(page, "PM · Danh sách: chọn cột", () => columns.click());
  });

  await test.step("Chi tiết task", async () => {
    await open(page, p(`/tasks/${ids.main}`));
    await audit(page, "PM · Chi tiết task");
    await checkFocus(page, "PM · Chi tiết task");
    await auditOpened(
      page,
      "PM · Chi tiết task: sửa tiêu đề",
      () => button(strings.taskDetail.title.edit).click(),
      null,
    );
    await auditOpened(page, "PM · Hộp thoại Thêm quan hệ", () =>
      button(/Thêm quan hệ$/, false).click(),
    );
    await auditOpened(page, "PM · Xác nhận xóa task", () =>
      button(strings.taskDetail.delete.action).click(),
    );
  });

  await test.step("Dashboard, nhật ký", async () => {
    await open(page, p("/dashboard"));
    await audit(page, "PM · Dashboard");
    await open(page, p("/activity"));
    await audit(page, "PM · Nhật ký");
    await checkFocus(page, "PM · Nhật ký");
  });

  await test.step("Cấu hình dự án (4 tab)", async () => {
    await open(page, p("/settings"));
    await audit(page, "PM · Cấu hình: Trạng thái");
    await checkFocus(page, "PM · Cấu hình");
    await hoverContrast(
      page,
      "PM · Tab cấu hình",
      page.getByRole("tab").nth(1),
    );
    await auditOpened(page, "PM · Hộp thoại Thêm trạng thái", () =>
      button(/Thêm trạng thái$/, false).click(),
    );
    await auditOpened(page, "PM · Xác nhận xóa trạng thái", () =>
      page.getByRole("button", { name: /^Xóa / }).first().click(),
    );
    for (const tab of ["Loại task", "Nhãn", "Thành viên"]) {
      await page.getByRole("tab", { name: tab, exact: true }).click();
      await page.waitForLoadState("networkidle");
      await audit(page, `PM · Cấu hình: ${tab}`);
    }
    await auditOpened(page, "PM · Hộp thoại Thêm thành viên", () =>
      button(/Thêm thành viên$/, false).click(),
    );
  });
});

test("Người xem (chỉ đọc): các màn dự án", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await signInAs(page, "viewer");
  for (const [name, path] of [
    ["Trang chủ (danh sách dự án)", "/"],
    ["Kanban", p()],
    ["Danh sách task", p("/list")],
    ["Chi tiết task", p(`/tasks/${ids.main}`)],
    ["Dashboard", p("/dashboard")],
    ["Cấu hình", p("/settings")],
  ] as const) {
    await test.step(name, async () => {
      await open(page, path);
      await audit(page, `Người xem · ${name}`);
    });
  }
  await checkFocus(page, "Người xem · Cấu hình");
});

test("Admin: người dùng, phòng ban, template báo cáo", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await signInAs(page, "admin");
  await open(page, "/admin/users");
  await audit(page, "Admin · Quản trị người dùng");
  await checkFocus(page, "Admin · Quản trị người dùng");
  const button = (name: string) =>
    page.getByRole("button", { name, exact: true });
  await auditOpened(page, "Admin · Hộp thoại Quản lý phòng ban", () =>
    button(strings.adminUsers.manageDepartments).click(),
  );
  await auditOpened(page, "Admin · Hộp thoại Mời người dùng", () =>
    page.getByRole("button", { name: /^Mời người dùng/ }).click(),
  );
  await auditOpened(page, "Admin · Hộp thoại Đổi phòng ban", () =>
    button(
      strings.adminUsers.changeDepartmentAction(
        `E2E pm ${tag} Nguyễn Thị Phương Thảo`,
      ),
    ).click(),
  );
  await open(page, "/admin/report-templates");
  await audit(page, "Admin · Template báo cáo");
  await checkFocus(page, "Admin · Template báo cáo");
});
