import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { LanguageSwitcher } from "@/components/ui/language-switcher";
import { requireAdmin } from "@/lib/admin/users/handlers";
import { HOME_PATH, LOGIN_PATH } from "@/lib/auth/routes";
import { getStrings } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import styles from "../users/admin-users.module.css";
import {
  ReportTemplatesScreen,
  type TemplatesTab,
} from "./report-templates-screen";

export async function generateMetadata(): Promise<Metadata> {
  const strings = await getStrings();
  return {
    title: `${strings.reportTemplates.pageTitle} · ${strings.app.name}`,
  };
}

/**
 * S17 Quản lý template (mockup v3 bp-Templates.dc.html): tab "Template báo cáo" (Story E5-2) và
 * "Template dự án" (Story E7-1, `?tab=project`). Chỉ Admin vào được trang quản trị: người khác nhận
 * "không tìm thấy" (BR-10). PM đọc template báo cáo qua API khi xuất báo cáo (E5-3/E5-4) và quản lý
 * template dự án ở /project-templates.
 */
export default async function AdminReportTemplatesPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  const strings = await getStrings();
  return (
    <div className={styles.canvas}>
      <div className={styles.frame}>
        <Suspense
          fallback={
            <p role="status" className={styles.pageLoading}>
              {strings.home.loading}
            </p>
          }
        >
          <Gate searchParams={searchParams} />
        </Suspense>
      </div>
    </div>
  );
}

async function Gate({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  await connection();
  const { tab } = await searchParams;
  const initialTab: TemplatesTab = tab === "project" ? "project" : "report";
  const strings = await getStrings();
  const supabase = await createClient();
  const gate = await requireAdmin(supabase);
  if (!gate.ok) {
    if (gate.error.code === "unauthenticated") redirect(LOGIN_PATH);
    notFound();
  }
  const { data: me } = await supabase
    .from("profiles")
    .select("full_name, email")
    .eq("id", gate.userId)
    .maybeSingle();
  const myName = me?.full_name?.trim() || me?.email || "";

  return (
    <>
      <aside className={styles.sidebar}>
        <div className={styles.brand}>
          <span className={styles.logo} aria-hidden="true">
            {strings.app.logoLetters}
          </span>
          <span className={styles.brandName}>{strings.app.name}</span>
        </div>
        <nav aria-label={strings.adminUsers.navLabel} className={styles.nav}>
          <Link href={HOME_PATH} className={styles.navLink}>
            {strings.adminUsers.navHome}
          </Link>
          <span className={`label ${styles.navSection}`}>
            <span className={styles.dot} aria-hidden="true" />
            {strings.adminUsers.navSection}
          </span>
          <Link href="/admin/users" className={styles.navLink}>
            {strings.adminUsers.navUsers}
          </Link>
          <Link
            href="/admin/report-templates"
            aria-current="page"
            className={`${styles.navLink} ${styles.navLinkActive}`}
          >
            {strings.reportTemplates.navLink}
          </Link>
        </nav>
        <div className={styles.grow} />
        <div className={styles.me}>
          <span className={styles.meName}>{myName}</span>
          <span className="label">{strings.adminUsers.adminBadge}</span>
        </div>
        <LanguageSwitcher className="items-start" />
      </aside>
      <ReportTemplatesScreen initialTab={initialTab} />
    </>
  );
}
