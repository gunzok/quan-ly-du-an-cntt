import type { Page } from "@playwright/test";

/**
 * Chờ React hydrate xong phần tử khớp `selector` (mặc định: form đầu tiên). React gắn khóa
 * `__reactFiber$…` vào nút DOM khi hydrate; trước đó trình duyệt chỉ có HTML tĩnh.
 *
 * Vì sao cần (QLDA-43): khi chạy song song nhiều worker, máy bận làm hydrate chậm. Điền form và
 * bấm gửi TRƯỚC khi hydrate thì trình duyệt gửi form gốc (không qua useActionState) hoặc React
 * gắn vào giữa lúc đang gõ: giá trị hai ô lệch nhau, máy chủ trả "Hai mật khẩu không khớp".
 * Chờ điều kiện rõ ràng này rồi mới thao tác, thay vì chờ thời gian cố định.
 */
export async function waitForHydration(
  page: Page,
  selector = "form",
): Promise<void> {
  await page.waitForFunction((sel) => {
    const el = document.querySelector(sel);
    return (
      el !== null && Object.keys(el).some((k) => k.startsWith("__reactFiber$"))
    );
  }, selector);
}
