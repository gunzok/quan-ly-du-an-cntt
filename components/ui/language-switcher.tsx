"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { cn } from "@/lib/cn";
import { useI18n } from "@/lib/i18n/client";
import { LOCALES, type Locale } from "@/lib/i18n/config";
import { writeLocaleCookie } from "@/lib/i18n/cookie";

/** Lưu lựa chọn vào hồ sơ (PATCH /api/v1/me); máy chủ ghi kèm cookie. */
async function saveProfileLocale(locale: Locale): Promise<boolean> {
  try {
    const response = await fetch("/api/v1/me", {
      method: "PATCH",
      credentials: "same-origin",
      cache: "no-store",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify({ locale }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

const button =
  "inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-pill border border-solid border-border-strong bg-bg px-3 font-sans text-xs text-text-muted hover:bg-bg-muted sm:min-h-8 " +
  "aria-pressed:border-primary aria-pressed:bg-bg-muted aria-pressed:font-medium aria-pressed:text-primary aria-busy:cursor-progress";

/**
 * Bộ chọn Tiếng Việt / English (Story E10-2). Đã đăng nhập: lưu vào hồ sơ (profiles.locale) nên
 * theo người dùng sang lần đăng nhập sau và máy khác; khách: lưu cookie. Sau khi lưu, làm mới
 * Server Component để toàn trang (kể cả <html lang>) đổi ngôn ngữ, URL giữ nguyên.
 * Tên ngôn ngữ hiện đầy đủ (không viết tắt) để tên đọc được trùng chữ nhìn thấy (WCAG 2.5.3).
 */
export function LanguageSwitcher({ className }: { className?: string }) {
  const { locale, t, signedIn } = useI18n();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState(false);

  function choose(next: Locale) {
    if (next === locale || pending) return;
    setFailed(false);
    startTransition(async () => {
      let ok = true;
      if (signedIn) {
        ok = await saveProfileLocale(next);
      } else {
        writeLocaleCookie(next);
      }
      if (!ok) {
        setFailed(true);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className={cn("flex flex-col items-end gap-1", className)}>
      <div
        role="group"
        aria-label={t.language.groupLabel}
        aria-busy={pending || undefined}
        className="flex gap-1"
      >
        {LOCALES.map((value) => (
          <button
            key={value}
            type="button"
            lang={value}
            aria-pressed={value === locale}
            className={button}
            onClick={() => choose(value)}
          >
            {t.language[value]}
          </button>
        ))}
      </div>
      <p role="status" className="sr-only">
        {pending ? t.language.changing : ""}
      </p>
      {failed ? (
        <p role="alert" className="m-0 text-xs text-danger">
          {t.language.changeFailed}
        </p>
      ) : null}
    </div>
  );
}
