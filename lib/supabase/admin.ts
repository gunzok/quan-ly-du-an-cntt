import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getSupabasePublicEnv } from "./env";

/**
 * Client Supabase dùng khóa service_role: BỎ QUA RLS. Chỉ dùng trong Route Handler/Server Action
 * SAU khi đã xác minh người gọi là Admin bằng phiên của họ (lib/admin/users/guard.ts).
 *
 * - Khóa đọc từ SUPABASE_SERVICE_ROLE_KEY (không tiền tố NEXT_PUBLIC_ nên Next.js không bao giờ
 *   nhúng vào mã trình duyệt; ở trình duyệt biến này luôn undefined).
 * - Không ghi log khóa, không đưa vào thông báo lỗi.
 * - Không lưu phiên, không tự làm mới token: mỗi lần gọi tạo client mới, không giữ trạng thái.
 */
export function createServiceRoleClient(): SupabaseClient {
  if (typeof window !== "undefined") {
    throw new Error("createServiceRoleClient chỉ được gọi phía máy chủ.");
  }
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    throw new Error(
      "Thiếu SUPABASE_SERVICE_ROLE_KEY (biến môi trường máy chủ). Xem .env.example.",
    );
  }
  const { url } = getSupabasePublicEnv();
  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
