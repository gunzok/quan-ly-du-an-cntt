import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { Suspense } from "react";
import { ProfileScreen } from "@/components/profile/profile-screen";
import { AppShell } from "@/components/projects/app-shell";
import { LOGIN_PATH } from "@/lib/auth/routes";
import { getStrings } from "@/lib/i18n/server";
import { loadMe } from "@/lib/me/load";
import { loadEmailPreferences } from "@/lib/notifications/preferences-handlers";
import { THEME_COOKIE, themeAttribute } from "@/lib/profile/theme";
import { createClient } from "@/lib/supabase/server";

export async function generateMetadata(): Promise<Metadata> {
  const strings = await getStrings();
  return { title: `${strings.profile.pageTitle} · ${strings.app.name}` };
}

/**
 * Hồ sơ cá nhân S18 (Story E1-7, mockup v3 Profile-v2.dc.html). Máy chủ kiểm phiên và đọc hồ sơ
 * của chính mình qua client phiên (RLS); lưu qua PATCH /api/v1/me ở trình duyệt, API kiểm lại.
 * Tài khoản bị khóa: RLS ẩn hồ sơ → về trang đăng nhập (proxy cũng chặn).
 */
export default async function ProfilePage() {
  const strings = await getStrings();
  return (
    <Suspense
      fallback={
        <p role="status" className="p-6">
          {strings.home.loading}
        </p>
      }
    >
      <ProfileGate />
    </Suspense>
  );
}

async function ProfileGate() {
  await connection();
  const strings = await getStrings();
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) {
    redirect(LOGIN_PATH);
  }
  const me = await loadMe(supabase, data.user.id);
  if (!me) {
    redirect(LOGIN_PATH);
  }
  // Story E4-2: lỗi đọc cài đặt email không làm hỏng trang hồ sơ (phần đó hiện thông báo lỗi).
  const emailPreferences = await loadEmailPreferences(supabase).catch(
    () => null,
  );
  const cookieTheme = (await cookies()).get(THEME_COOKIE)?.value;
  const theme = themeAttribute(cookieTheme) ?? "system";
  const isPm = me.projects.some((p) => p.role === "pm");
  const roleLabel = me.is_admin
    ? strings.projects.roles.admin
    : isPm
      ? strings.projects.roles.pm
      : null;
  const email = me.email || data.user.email || "";

  return (
    <AppShell
      userName={me.full_name}
      email={email}
      roleLabel={roleLabel}
      isAdmin={me.is_admin}
      canUseTemplates={me.is_admin || isPm}
    >
      <ProfileScreen
        profile={{ ...me, email }}
        initialTheme={theme}
        emailPreferences={emailPreferences}
      />
    </AppShell>
  );
}
