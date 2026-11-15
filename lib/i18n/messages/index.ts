import type { Locale } from "../config";
import { en } from "./en";
import { vi, type Messages } from "./vi";

export type { Messages };

/** Mọi từ điển theo ngôn ngữ. Bundle phía trình duyệt chứa cả hai (vài chục KB trước nén). */
export const MESSAGES: Record<Locale, Messages> = { vi, en };

export function getMessages(locale: Locale): Messages {
  return MESSAGES[locale];
}
