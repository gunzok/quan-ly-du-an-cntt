import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { KanbanScreen } from "@/components/kanban/kanban-screen";
import { AppShell } from "@/components/projects/app-shell";
import { isUuid } from "@/lib/api/request";
import { LOGIN_PATH } from "@/lib/auth/routes";
import { getStrings } from "@/lib/i18n/server";
import type { ProjectRole } from "@/lib/projects/model";
import { createClient } from "@/lib/supabase/server";

export async function generateMetadata(): Promise<Metadata> {
  const strings = await getStrings();
  return { title: `${strings.kanban.pageTitle} · ${strings.app.name}` };
}

type Params = { params: Promise<{ id: string }> };

/**
 * Trang dự án = bảng Kanban (Story E3-1, S03, S09; mockup v3 bp-Kanban.dc.html). Máy chủ chỉ kiểm
 * phiên, dự án thấy được (RLS) và vai trò để chọn chế độ chỉ đọc; task, trạng thái, nhãn lấy qua
 * /api/v1 ở trình duyệt, API và RLS kiểm quyền lại ở từng request.
 */
export default async function ProjectBoardPage({ params }: Params) {
  const strings = await getStrings();
  return (
    <Suspense
      fallback={
        <p role="status" className="p-6">
          {strings.home.loading}
        </p>
      }
    >
      <BoardGate params={params} />
    </Suspense>
  );
}

async function BoardGate({ params }: Params) {
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
      <KanbanScreen
        projectId={project.id as string}
        projectName={project.name as string}
        actor={{ userId: data.user.id, isAdmin, role }}
      />
    </AppShell>
  );
}
