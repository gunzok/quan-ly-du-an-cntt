import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { ActivityScreen } from "@/components/activity/activity-screen";
import { AppShell } from "@/components/projects/app-shell";
import { isUuid } from "@/lib/api/request";
import { LOGIN_PATH } from "@/lib/auth/routes";
import { getStrings } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";

export async function generateMetadata(): Promise<Metadata> {
  const strings = await getStrings();
  return { title: `${strings.activity.pageTitle} · ${strings.app.name}` };
}

type Params = { params: Promise<{ id: string }> };

/**
 * Nhật ký hoạt động S15 (Story E6-2, mockup v3 bp-Activity.dc.html). Máy chủ kiểm phiên, dự án thấy
 * được (RLS; người ngoài 404, BR-10) và vai trò: PM của dự án, Admin xem được; Thành viên, Người
 * xem thấy thông báo không có quyền (API trả 403). Nhật ký lấy qua GET /api/v1/projects/{id}/activity
 * ở trình duyệt, API và RLS kiểm quyền lại.
 */
export default async function ProjectActivityPage({ params }: Params) {
  const strings = await getStrings();
  return (
    <Suspense
      fallback={
        <p role="status" className="p-6">
          {strings.home.loading}
        </p>
      }
    >
      <ActivityGate params={params} />
    </Suspense>
  );
}

async function ActivityGate({ params }: Params) {
  await connection();
  const strings = await getStrings();
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) {
    redirect(LOGIN_PATH);
  }
  if (!isUuid(id)) notFound();
  const projectId = id.toLowerCase();
  const [
    { data: profile },
    { data: project },
    { data: member },
    { data: pmRows },
  ] = await Promise.all([
    supabase
      .from("profiles")
      .select("full_name, is_admin, is_active")
      .eq("id", data.user.id)
      .maybeSingle(),
    supabase
      .from("projects")
      .select("id, name")
      .eq("id", projectId)
      .maybeSingle(),
    supabase
      .from("project_members")
      .select("role")
      .eq("project_id", projectId)
      .eq("user_id", data.user.id)
      .maybeSingle(),
    supabase
      .from("project_members")
      .select("project_id")
      .eq("user_id", data.user.id)
      .eq("role", "pm")
      .limit(1),
  ]);
  if (!project) notFound();
  const isAdmin = profile?.is_admin === true && profile.is_active === true;
  const canView = isAdmin || member?.role === "pm";
  const roleLabel = isAdmin
    ? strings.projects.roles.admin
    : (pmRows ?? []).length > 0
      ? strings.projects.roles.pm
      : null;

  return (
    <AppShell
      userName={profile?.full_name?.trim() ?? ""}
      email={data.user.email ?? ""}
      roleLabel={roleLabel}
      isAdmin={isAdmin}
    >
      <ActivityScreen
        projectId={project.id as string}
        projectName={project.name as string}
        canView={canView}
      />
    </AppShell>
  );
}
