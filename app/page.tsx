import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { AppShell } from "@/components/projects/app-shell";
import { ProjectsScreen } from "@/components/projects/projects-screen";
import { LOGIN_PATH } from "@/lib/auth/routes";
import { canCreateProject } from "@/lib/projects/policy";
import { getStrings } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";

export async function generateMetadata(): Promise<Metadata> {
  const strings = await getStrings();
  return { title: `${strings.projects.pageTitle} · ${strings.app.name}` };
}

/**
 * Trang chủ = S02 Danh sách dự án (Story E2-1, mockup v3 bp-Projects.dc.html). Máy chủ chỉ kiểm
 * phiên và quyền tạo dự án để ẩn/hiện nút; danh sách lấy qua /api/v1/projects ở trình duyệt, API
 * kiểm quyền lần nữa ở từng request.
 */
export default async function Home() {
  const strings = await getStrings();
  return (
    <Suspense
      fallback={
        <p role="status" className="p-6">
          {strings.home.loading}
        </p>
      }
    >
      <ProjectsGate />
    </Suspense>
  );
}

async function ProjectsGate() {
  // Phần này luôn chạy theo request (supabase-js đọc giờ hiện tại để kiểm hạn phiên).
  await connection();
  const strings = await getStrings();
  const supabase = await createClient();
  // getUser hỏi Supabase Auth: phiên đã thu hồi thì không còn hợp lệ (proxy chỉ kiểm tra lạc quan).
  const { data } = await supabase.auth.getUser();
  if (!data.user) {
    redirect(LOGIN_PATH);
  }
  const [{ data: profile }, { data: pmRows }] = await Promise.all([
    supabase
      .from("profiles")
      .select("full_name, is_admin, is_active")
      .eq("id", data.user.id)
      .maybeSingle(),
    supabase
      .from("project_members")
      .select("project_id")
      .eq("user_id", data.user.id)
      .eq("role", "pm")
      .limit(1),
  ]);
  const isAdmin = profile?.is_admin === true && profile.is_active === true;
  const isPm = (pmRows ?? []).length > 0;
  const canCreate = canCreateProject({ isAdmin, isPmAnywhere: isPm });
  const roleLabel = isAdmin
    ? strings.projects.roles.admin
    : isPm
      ? strings.projects.roles.pm
      : null;

  return (
    <AppShell
      userName={profile?.full_name?.trim() ?? ""}
      email={data.user.email ?? ""}
      roleLabel={roleLabel}
      isAdmin={isAdmin}
      canUseTemplates={canCreate}
    >
      <ProjectsScreen isAdmin={isAdmin} canCreate={canCreate} />
    </AppShell>
  );
}
