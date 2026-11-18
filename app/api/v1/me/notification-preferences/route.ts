import {
  handleGetNotificationPreferences,
  handlePutNotificationPreferences,
} from "@/lib/notifications/preferences-handlers";
import { createClient } from "@/lib/supabase/server";

/** GET /api/v1/me/notification-preferences — bật/tắt email theo loại của chính mình (E4-2). */
export async function GET(request: Request) {
  return handleGetNotificationPreferences(request, {
    session: await createClient(),
  });
}

/** PUT /api/v1/me/notification-preferences { email: { task_assigned?, task_status_changed? } }. */
export async function PUT(request: Request) {
  return handlePutNotificationPreferences(request, {
    session: await createClient(),
  });
}
