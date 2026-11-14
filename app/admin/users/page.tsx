import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { requireAdmin } from "@/lib/admin/users/handlers";
import { HOME_PATH, LOGIN_PATH } from "@/lib/auth/routes";
import { strings } from "@/lib/strings";
import { createClient } from "@/lib/supabase/server";
import styles from "./admin-users.module.css";
import { UsersScreen } from "./users-screen";

export const metadata: Metadata = {
  title: `${strings.adminUsers.pageTitle} · ${strings.app.name}`,
};

/**
 * S08 Quản lý người dùng, bản Blueprint v3 (docs/03-design/ui-ux/mockups/v3/bp-Admin.dc.html).
 * Chỉ Admin vào được: người khác nhận trang "không tìm thấy" (không lộ trang tồn tại, BR-10).
 * Dữ liệu bảng lấy qua /api/v1/users ở trình duyệt; máy chủ kiểm quyền lần nữa ở từng request.
 */
export default function AdminUsersPage() {
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
          <AdminUsersGate />
        </Suspense>
      </div>
    </div>
  );
}

async function AdminUsersGate() {
  await connection();
  const supabase = await createClient();
  const gate = await requireAdmin(supabase);
  if (!gate.ok) {
    if (gate.error.code === "unauthenticated") {
      redirect(LOGIN_PATH);
    }
    notFound();
  }

  // Admin đọc được qua RLS; không cần service_role cho hai truy vấn này.
  const [{ data: departments }, { data: me }] = await Promise.all([
    supabase
      .from("departments")
      .select("id, name")
      .order("position")
      .order("name"),
    supabase
      .from("profiles")
      .select("full_name, email")
      .eq("id", gate.userId)
      .maybeSingle(),
  ]);

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
          <Link
            href="/admin/users"
            aria-current="page"
            className={`${styles.navLink} ${styles.navLinkActive}`}
          >
            {strings.adminUsers.navUsers}
          </Link>
        </nav>
        <div className={styles.grow} />
        <div className={styles.me}>
          <span className={styles.meName}>{myName}</span>
          <span className="label">{strings.adminUsers.adminBadge}</span>
        </div>
      </aside>
      <UsersScreen
        currentUserId={gate.userId}
        departments={departments ?? []}
      />
    </>
  );
}
