import { cookies, headers } from "next/headers";
import { connection } from "next/server";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { LOCALE_COOKIE, type Locale } from "./config";
import { getMessages, type Messages } from "./messages";
import { resolveLocale, type LocaleSource } from "./negotiate";

export interface LocaleState {
  locale: Locale;
  source: LocaleSource;
  /** Có người đăng nhập (hồ sơ đọc được): bộ chọn lưu vào hồ sơ qua PATCH /api/v1/me. */
  signedIn: boolean;
}

/**
 * Hồ sơ của người đang đăng nhập qua client phiên (RLS: chỉ đọc được hồ sơ của mình hoặc người
 * cùng dự án; lọc theo id của chính mình). Lỗi mạng/CSDL: coi như khách, rơi về cookie.
 */
async function readProfileLocale(): Promise<{
  signedIn: boolean;
  locale: string | null;
}> {
  try {
    const supabase = await createClient();
    const { data } = await supabase.auth.getUser();
    if (!data.user) return { signedIn: false, locale: null };
    const { data: profile } = await supabase
      .from("profiles")
      .select("locale")
      .eq("id", data.user.id)
      .maybeSingle();
    return {
      signedIn: Boolean(profile),
      locale: (profile?.locale as string | undefined) ?? null,
    };
  } catch {
    return { signedIn: false, locale: null };
  }
}

/**
 * Ngôn ngữ của request hiện tại (Server Component, Server Action, Route Handler). Thứ tự: hồ sơ >
 * cookie > Accept-Language > vi. React cache(): chỉ tính một lần cho mỗi request.
 */
export const getLocaleState = cache(async (): Promise<LocaleState> => {
  // Luôn theo request: supabase-js đọc giờ hiện tại khi nạp phiên, không được chạy lúc prerender
  // (generateMetadata và trang có thể gọi trước connection() của root layout).
  await connection();
  const [cookieStore, headerList, profile] = await Promise.all([
    cookies(),
    headers(),
    readProfileLocale(),
  ]);
  const { locale, source } = resolveLocale({
    profileLocale: profile.locale,
    cookieLocale: cookieStore.get(LOCALE_COOKIE)?.value,
    acceptLanguage: headerList.get("accept-language"),
  });
  return { locale, source, signedIn: profile.signedIn };
});

export async function getLocale(): Promise<Locale> {
  return (await getLocaleState()).locale;
}

/** Từ điển của request hiện tại cho Server Component (Client Component dùng useStrings()). */
export async function getStrings(): Promise<Messages> {
  return getMessages(await getLocale());
}
