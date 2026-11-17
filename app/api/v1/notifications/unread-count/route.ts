import { handleUnreadCount } from "@/lib/notifications/handlers";
import { createClient } from "@/lib/supabase/server";

/** GET /api/v1/notifications/unread-count — số chưa đọc cho chuông (Story E4-1). */
export async function GET(request: Request) {
  return handleUnreadCount(request, { session: await createClient() });
}
