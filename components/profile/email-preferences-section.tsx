"use client";

import { useState } from "react";
import { Switch } from "@/components/ui/switch";
import { apiErrorText } from "@/lib/i18n/api-error";
import { useI18n } from "@/lib/i18n/client";
import {
  EMAIL_PREFERENCE_TYPES,
  type EmailPreferenceType,
  type EmailPreferences,
} from "@/lib/notifications/preferences";
import { putEmailPreferences } from "@/lib/notifications/preferences-client";

/**
 * Bật/tắt email theo loại thông báo (Story E4-2, S16 mockup bp-Notifications "Email / Nhận email
 * khi", đặt trong trang Hồ sơ S18). Mỗi công tắc lưu ngay (PUT /api/v1/me/notification-preferences),
 * hiện trạng thái mới trước rồi trả lại nếu lỗi; vùng role=status đọc kết quả cho trình đọc màn hình.
 * Không tải được cài đặt (initial null): hiện thông báo, không có công tắc.
 */
export function EmailPreferencesSection({
  initial,
}: {
  initial: EmailPreferences | null;
}) {
  const { t: strings } = useI18n();
  const t = strings.emailPreferences;
  const [prefs, setPrefs] = useState<EmailPreferences | null>(initial);
  const [pending, setPending] = useState<EmailPreferenceType | null>(null);
  const [message, setMessage] = useState("");
  const [failure, setFailure] = useState<string | null>(null);

  // Không vô hiệu hóa công tắc khi đang lưu (input bị disabled mất focus bàn phím); bỏ qua lượt bấm
  // trong lúc chờ.
  async function toggle(type: EmailPreferenceType, on: boolean) {
    if (!prefs || pending) return;
    const before = prefs;
    setPrefs({ ...prefs, [type]: on });
    setPending(type);
    setMessage(t.saving);
    setFailure(null);
    const result = await putEmailPreferences({ [type]: on });
    setPending(null);
    if (!result.ok) {
      setPrefs(before);
      setMessage("");
      setFailure(
        result.error.code === "internal_error" ||
          result.error.code === "validation_failed"
          ? t.saveFailed
          : apiErrorText(strings, result.error),
      );
      return;
    }
    setPrefs(result.data.data.email);
    setMessage(t.saved(t.types[type], result.data.data.email[type]));
  }

  return (
    <section
      aria-labelledby="profile-email-heading"
      className="flex flex-col gap-2 rounded-lg border border-solid border-border p-4 sm:p-5"
    >
      <h2 id="profile-email-heading" className="m-0 text-base font-semibold">
        {t.heading}
      </h2>
      <p className="m-0 text-xs text-text-muted">{t.hint}</p>
      {prefs ? (
        <ul className="m-0 flex list-none flex-col p-0">
          {EMAIL_PREFERENCE_TYPES.map((type) => {
            const hintId = `profile-email-${type}-hint`;
            return (
              <li
                key={type}
                className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-0 border-t border-solid border-border py-1.5"
              >
                <div className="flex min-w-0 flex-col">
                  <Switch
                    label={t.types[type]}
                    name={`email-${type}`}
                    checked={prefs[type]}
                    aria-busy={pending === type || undefined}
                    aria-describedby={hintId}
                    onChange={(event) => toggle(type, event.target.checked)}
                  />
                  <span id={hintId} className="text-xs text-text-muted">
                    {t.typeHints[type]}
                  </span>
                </div>
                <span
                  aria-hidden="true"
                  className={
                    prefs[type]
                      ? "font-mono text-xs font-semibold text-primary"
                      : "font-mono text-xs text-text-muted"
                  }
                >
                  {prefs[type] ? t.on : t.off}
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p role="alert" className="m-0 text-sm text-danger">
          {t.unavailable}
        </p>
      )}
      <p role="status" className="m-0 min-h-5 text-sm text-text-muted">
        {message}
      </p>
      {failure ? (
        <p role="alert" className="m-0 text-sm text-danger">
          {failure}
        </p>
      ) : null}
    </section>
  );
}
