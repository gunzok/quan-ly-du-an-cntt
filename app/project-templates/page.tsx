import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { ProjectTemplatesScreen } from "@/components/project-templates/templates-screen";
import { AppShell } from "@/components/projects/app-shell";
import { LOGIN_PATH } from "@/lib/auth/routes";
import { getStrings } from "@/lib/i18n/server";
import { requireProjectTemplateReader } from "@/lib/project-templates/handlers";
import { createClient } from "@/lib/supabase/server";

export async function generateMetadata(): Promise<Metadata> {
  const strings = await getStrings();
  return {
    title: `${strings.projectTemplates.pageTitle} · ${strings.app.name}`,
  };
}

/**
 * S17 Quản lý template dự án (Story E7-1; mockup v3 bp-Templates.dc.html, tab "Template dự án").
 * Admin và PM (ở ít nhất một dự án) vào được; người khác nhận "không tìm thấy" (BR-10). Admin còn
 * thấy cùng danh sách ở tab của /admin/report-templates. API và RLS kiểm lại mọi thao tác.
 */
export default async function ProjectTemplatesPage() {
  const strings = await getStrings();
  return (
    <Suspense
      fallback={
        <p role="status" className="p-6">
          {strings.home.loading}
        </p>
      }
    >
      <Gate />
    </Suspense>
  );
}

async function Gate() {
  await connection();
  const strings = await getStrings();
  const supabase = await createClient();
  const gate = await requireProjectTemplateReader(supabase);
  if (!gate.ok) {
    if (gate.error.code === "unauthenticated") redirect(LOGIN_PATH);
    notFound();
  }
  const [{ data: profile }, { data: auth }] = await Promise.all([
    supabase
      .from("profiles")
      .select("full_name, email")
      .eq("id", gate.userId)
      .maybeSingle(),
    supabase.auth.getUser(),
  ]);
  return (
    <AppShell
      userName={profile?.full_name?.trim() ?? ""}
      email={profile?.email ?? auth.user?.email ?? ""}
      roleLabel={
        gate.isAdmin ? strings.projects.roles.admin : strings.projects.roles.pm
      }
      isAdmin={gate.isAdmin}
      canUseTemplates
    >
      <ProjectTemplatesScreen />
    </AppShell>
  );
}
