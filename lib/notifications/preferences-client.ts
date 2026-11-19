import { call } from "@/lib/admin/users/client-api";
import type {
  EmailPreferences,
  NotificationPreferencesResponse,
} from "./preferences";

/** Bật/tắt email theo loại từ trình duyệt (PUT /api/v1/me/notification-preferences). */
export function putEmailPreferences(email: Partial<EmailPreferences>) {
  return call<NotificationPreferencesResponse>(
    "/api/v1/me/notification-preferences",
    {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email }),
    },
  );
}
