import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { ProjectSettingsScreen } from "@/components/project-config/project-settings-screen";
import { AppShell } from "@/components/projects/app-shell";
import { isUuid } from "@/lib/api/request";
import { LOGIN_PATH } from "@/lib/auth/routes";
import { canManageConfig } from "@/lib/project-config/policy";
import type { ProjectRole } from "@/lib/projects/model";
import { strings } from "@/lib/strings";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: `${strings.projectConfig.pageTitle} · ${strings.app.name}`,
};

type Params = { params: Promise<{ id: string }> };

/**
 * Cấu hình dự án: trạng thái, loại task, nhãn (Story E2-3, mockup v3 bp-ProjectSettings.dc.html).
 * Máy chủ chỉ kiểm phiên, dự án thấy được (RLS) và quyền sửa để chọn chế độ chỉ đọc; dữ liệu lấy
 * qua /api/v1 ở trình duyệt, API kiểm quyền lần nữa ở từng request.
 */
export default function ProjectSettingsPage({ params }: Params) {
  return (
    <Suspense
      fallback={
        <p role="status" className="p-6">
          {strings.home.loading}
        </p>
      }
    >
      <SettingsGate params={params} />
    </Suspense>
  );
}

async function SettingsGate({ params }: Params) {
  await connection();
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
  const canEdit = canManageConfig({ userId: data.user.id, isAdmin, role });
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
      <ProjectSettingsScreen
        projectId={project.id as string}
        projectName={project.name as string}
        canEdit={canEdit}
        currentUserId={data.user.id}
      />
    </AppShell>
  );
}
