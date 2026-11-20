import type { ApiErrorDetail } from "@/lib/api/errors";
import {
  isPlainObject,
  unknownFields,
  type Validation,
} from "@/lib/api/request";

/**
 * Tùy chọn email theo loại thông báo (Story E4-2, FR-12, GET/PUT /api/v1/me/notification-preferences).
 * Mặc định khi chưa lưu (CSDL private.email_enabled_default): giao việc BẬT, đổi trạng thái TẮT,
 * nhắc hạn BẬT (E4-3).
 */
export const EMAIL_PREFERENCE_TYPES = [
  "task_assigned",
  "task_status_changed",
  // Story E4-3: nhắc hạn, mặc định BẬT.
  "task_due_soon",
] as const;
export type EmailPreferenceType = (typeof EMAIL_PREFERENCE_TYPES)[number];

export type EmailPreferences = Record<EmailPreferenceType, boolean>;

export interface NotificationPreferencesResponse {
  data: { email: EmailPreferences };
}

/** Thân PUT tối đa (byte). */
export const PREFERENCES_BODY_MAX_BYTES = 1024;

/**
 * PUT { email: { task_assigned?, task_status_changed?, task_due_soon?: boolean } }: ít nhất một loại; loại
 * không nhắc tới giữ nguyên. Từ chối trường lạ ở cả hai cấp.
 */
export function validatePreferencesPut(
  body: unknown,
): Validation<{ email: Partial<EmailPreferences> }> {
  if (!isPlainObject(body)) {
    return { ok: false, details: [{ field: "body", issue: "invalid_format" }] };
  }
  const details: ApiErrorDetail[] = unknownFields(Object.keys(body), ["email"]);
  const email = body.email;
  if (email === undefined) {
    details.push({ field: "email", issue: "required" });
    return { ok: false, details };
  }
  if (!isPlainObject(email)) {
    details.push({ field: "email", issue: "invalid_format" });
    return { ok: false, details };
  }
  for (const d of unknownFields(Object.keys(email), EMAIL_PREFERENCE_TYPES)) {
    details.push({ field: `email.${d.field}`, issue: "unknown_field" });
  }
  const result: Partial<EmailPreferences> = {};
  for (const type of EMAIL_PREFERENCE_TYPES) {
    if (!(type in email)) continue;
    const value = email[type];
    if (typeof value !== "boolean") {
      details.push({ field: `email.${type}`, issue: "invalid_value" });
    } else {
      result[type] = value;
    }
  }
  if (details.length === 0 && Object.keys(result).length === 0) {
    details.push({ field: "email", issue: "required" });
  }
  return details.length > 0
    ? { ok: false, details }
    : { ok: true, data: { email: result } };
}

/** Gộp dòng trả về của public.my_notification_preferences() thành đủ mọi loại. */
export function toEmailPreferences(
  rows: { type: string; email_enabled: boolean }[],
): EmailPreferences | null {
  const out: Partial<EmailPreferences> = {};
  for (const row of rows) {
    if ((EMAIL_PREFERENCE_TYPES as readonly string[]).includes(row.type)) {
      out[row.type as EmailPreferenceType] = row.email_enabled === true;
    }
  }
  return EMAIL_PREFERENCE_TYPES.every((t) => typeof out[t] === "boolean")
    ? (out as EmailPreferences)
    : null;
}
