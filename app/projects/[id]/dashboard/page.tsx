import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { DashboardScreen } from "@/components/dashboard/dashboard-screen";
import { AppShell } from "@/components/projects/app-shell";
import { isUuid } from "@/lib/api/request";
import { LOGIN_PATH } from "@/lib/auth/routes";
import type { ProjectRole } from "@/lib/projects/model";
import { getStrings } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";

export async function generateMetadata(): Promise<Metadata> {
  const strings = await getStrings();
  return { title: `${strings.dashboard.pageTitle} · ${strings.app.name}` };
}

type Params = { params: Promise<{ id: string }> };

/**
 * Dashboard tiến độ S06 (Story E5-1, mockup v3 bp-Dashboard.dc.html). Máy chủ chỉ kiểm phiên và
 * dự án thấy được (RLS: PM, Thành viên, Người xem của dự án và Admin; người ngoài 404, BR-10); số
 * liệu lấy qua GET /api/v1/projects/{id}/dashboard ở trình duyệt, API kiểm quyền lần nữa.
 */
export default async function ProjectDashboardPage({ params }: Params) {
  const strings = await getStrings();
  return (
    <Suspense
      fallback={
        <p role="status" className="p-6">
          {strings.home.loading}
        </p>
      }
    >
      <DashboardGate params={params} />
    </Suspense>
  );
}

async function DashboardGate({ params }: Params) {
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
  // Không thuộc dự án, bị khóa hoặc id sai: 404, không lộ sự tồn tại (BR-10).
  if (!project) notFound();
  const isAdmin = profile?.is_admin === true && profile.is_active === true;
  const role = (member?.role as ProjectRole | undefined) ?? null;
  // Tạo task: PM, Thành viên, Admin (BR-02); Người xem chỉ đọc.
  const canCreateTask = isAdmin || role === "pm" || role === "member";
  // Xuất báo cáo S07: PM của dự án và Admin (Story E5-3); API kiểm lại.
  const canExportReport =
    profile?.is_active === true && (isAdmin || role === "pm");
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
      <DashboardScreen
        projectId={project.id as string}
        projectName={project.name as string}
        canCreateTask={canCreateTask}
        canExportReport={canExportReport}
        isAdmin={isAdmin}
      />
    </AppShell>
  );
}
