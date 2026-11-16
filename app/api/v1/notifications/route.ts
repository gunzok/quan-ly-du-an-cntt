import { handleListNotifications } from "@/lib/notifications/handlers";
import { createClient } from "@/lib/supabase/server";

/** GET /api/v1/notifications — thông báo của tôi (Story E4-1). */
export async function GET(request: Request) {
  return handleListNotifications(request, { session: await createClient() });
}
