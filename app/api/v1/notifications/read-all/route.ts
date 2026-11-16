import { handleMarkAllRead } from "@/lib/notifications/handlers";
import { createClient } from "@/lib/supabase/server";

/** POST /api/v1/notifications/read-all — đánh dấu mọi thông báo của tôi đã đọc (Story E4-1). */
export async function POST(request: Request) {
  return handleMarkAllRead(request, { session: await createClient() });
}
