import type { Metadata } from "next";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { Inter, Inter_Tight, JetBrains_Mono } from "next/font/google";
import type { ReactNode } from "react";
import { I18nProvider } from "@/lib/i18n/client";
import { getLocaleState, getStrings } from "@/lib/i18n/server";
import { THEME_COOKIE, themeAttribute } from "@/lib/profile/theme";
import "./globals.css";

// Phông theo design system v2 (Blueprint); cả 3 có bộ ký tự tiếng Việt.
const inter = Inter({
  subsets: ["latin", "vietnamese"],
  variable: "--font-inter",
  display: "swap",
});
const interTight = Inter_Tight({
  subsets: ["latin", "vietnamese"],
  weight: ["300", "400"],
  variable: "--font-inter-tight",
  display: "swap",
});
const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin", "vietnamese"],
  weight: ["400", "500"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

export async function generateMetadata(): Promise<Metadata> {
  const t = await getStrings();
  return { title: t.app.name, description: t.app.description };
}

/**
 * CSP dùng nonce theo từng request (Story E0-5, proxy.ts). Static shell của Cache Components được
 * prerender lúc build nên script trong đó không mang được nonce và bị CSP chặn. Vì vậy mọi trang
 * render theo request: root layout chờ connection() và tắt kiểm tra static shell (`instant = false`).
 * Đánh đổi: mất static shell (PPR); chấp nhận được vì mọi trang đều sau đăng nhập và proxy đã gọi
 * Supabase Auth cho mỗi request.
 */
export const instant = false;

export default async function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  await connection();
  // Ngôn ngữ theo hồ sơ > cookie > Accept-Language > vi (Story E10-2); URL không đổi.
  const { locale, signedIn } = await getLocaleState();
  // Giao diện sáng/tối chọn ở hồ sơ (E1-7), lưu cookie; vắng thì theo hệ thống.
  const theme = themeAttribute((await cookies()).get(THEME_COOKIE)?.value);
  return (
    <html
      lang={locale}
      data-theme={theme}
      className={`${inter.variable} ${interTight.variable} ${jetbrainsMono.variable}`}
    >
      <body>
        <I18nProvider locale={locale} signedIn={signedIn}>
          {children}
        </I18nProvider>
      </body>
    </html>
  );
}
