import { createBrowserClient } from "@supabase/ssr";
import { getSupabasePublicEnv } from "./env";

/**
 * Client Supabase cho Client Component (chỉ dùng khóa anon/publishable, không bao giờ service_role).
 *
 * Lưu ý: cookie phiên là httpOnly (xem cookie-options.ts) nên client này KHÔNG đọc được phiên
 * đăng nhập; nó chạy với vai trò anon. Đăng nhập, đăng xuất, đọc người dùng hiện tại làm ở máy chủ.
 * Tính năng cần phiên ở trình duyệt (ví dụ Realtime theo người dùng) phải xem lại quyết định này.
 */
export function createClient() {
  const { url, anonKey } = getSupabasePublicEnv();
  return createBrowserClient(url, anonKey);
}
