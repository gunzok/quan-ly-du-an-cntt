"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { Locale } from "./config";
import { MESSAGES, type Messages } from "./messages";

interface I18nValue {
  locale: Locale;
  t: Messages;
  /** Có người đăng nhập: lựa chọn ngôn ngữ lưu vào hồ sơ; khách: lưu cookie. */
  signedIn: boolean;
}

const I18nContext = createContext<I18nValue | null>(null);

/**
 * Cung cấp ngôn ngữ cho Client Component. Root layout truyền ngôn ngữ đã chọn ở máy chủ (chuỗi
 * "vi"/"en", không truyền hàm qua ranh giới Server → Client); từ điển lấy ở phía trình duyệt.
 */
export function I18nProvider({
  locale,
  signedIn,
  children,
}: {
  locale: Locale;
  signedIn: boolean;
  children: ReactNode;
}) {
  return (
    <I18nContext.Provider value={{ locale, t: MESSAGES[locale], signedIn }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  if (!value) {
    throw new Error(
      "useI18n() phải nằm trong <I18nProvider> (app/layout.tsx).",
    );
  }
  return value;
}

/** Từ điển của ngôn ngữ hiện tại cho Client Component. */
export function useStrings(): Messages {
  return useI18n().t;
}

export function useLocale(): Locale {
  return useI18n().locale;
}
