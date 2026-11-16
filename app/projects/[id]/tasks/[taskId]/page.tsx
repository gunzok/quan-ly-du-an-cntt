import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { AppShell } from "@/components/projects/app-shell";
import { TaskDetailScreen } from "@/components/task-detail/task-detail-screen";
import { isUuid } from "@/lib/api/request";
import { LOGIN_PATH } from "@/lib/auth/routes";
import type { ProjectRole } from "@/lib/projects/model";
import { getStrings } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";

export async function generateMetadata(): Promise<Metadata> {
  const strings = await getStrings();
  return { title: `${strings.taskDetail.pageTitle} · ${strings.app.name}` };
}

type Params = { params: Promise<{ id: string; taskId: string }> };

/**
 * Chi tiết task (Story E2-5, S05 v2). Máy chủ chỉ kiểm phiên và task thấy được trong đúng dự án
 * (RLS): không thấy thì 404, không lộ sự tồn tại (BR-10). Dữ liệu chi tiết lấy qua /api/v1 ở trình
 * duyệt, API kiểm quyền lần nữa ở từng request.
 */
export default async function TaskDetailPage({ params }: Params) {
  const strings = await getStrings();
  return (
    <Suspense
      fallback={
        <p role="status" className="p-6">
          {strings.home.loading}
        </p>
      }
    >
      <TaskGate params={params} />
    </Suspense>
  );
}

async function TaskGate({ params }: Params) {
  await connection();
  const strings = await getStrings();
  const { id, taskId } = await params;
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) {
    redirect(LOGIN_PATH);
  }
  if (!isUuid(id) || !isUuid(taskId)) notFound();
  const projectId = id.toLowerCase();
  const [
    { data: profile },
    { data: project },
    { data: task },
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
      .from("tasks")
      .select("id")
      .eq("id", taskId.toLowerCase())
      .eq("project_id", projectId)
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
  // Không thuộc dự án, task ở dự án khác, đã xóa hoặc id sai: 404 (BR-10).
  if (!project || !task) notFound();
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
      <TaskDetailScreen
        key={task.id as string}
        projectId={project.id as string}
        projectName={project.name as string}
        taskId={task.id as string}
        userId={data.user.id}
        role={role}
        isAdmin={isAdmin}
      />
    </AppShell>
  );
}
