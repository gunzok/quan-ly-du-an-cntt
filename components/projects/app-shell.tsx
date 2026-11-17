"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { Avatar } from "@/components/ui/avatar";
import { LanguageSwitcher } from "@/components/ui/language-switcher";
import { signOut } from "@/lib/auth/actions";
import { HOME_PATH } from "@/lib/auth/routes";
import { useStrings } from "@/lib/i18n/client";

const navLink =
  "flex min-h-11 items-center rounded-md px-2.5 text-sm text-text hover:bg-bg-muted hover:text-text sm:min-h-9";

/**
 * Khung trang Blueprint (mockup v3 bp-Projects.dc.html): thanh bên (thương hiệu, điều hướng, người
 * đang đăng nhập, bộ chọn ngôn ngữ, đăng xuất) và vùng nội dung. Dưới `lg` thanh bên nằm trên nội
 * dung. Client Component để dùng từ điển theo ngôn ngữ (useStrings) và bộ chọn ngôn ngữ.
 */
export function AppShell({
  userName,
  email,
  roleLabel,
  isAdmin,
  children,
}: {
  userName: string;
  email: string;
  roleLabel: string | null;
  isAdmin: boolean;
  children: ReactNode;
}) {
  const strings = useStrings();
  const t = strings.projects;
  return (
    <div className="flex flex-1 flex-col bg-canvas lg:p-3">
      <div className="flex min-h-full flex-1 flex-col overflow-hidden bg-bg lg:flex-row lg:rounded-xl lg:border lg:border-solid lg:border-border">
        <aside className="flex flex-col gap-4 border-0 border-b border-solid border-border bg-bg-subtle px-3 py-4 lg:w-60 lg:shrink-0 lg:border-r lg:border-b-0 lg:py-5">
          <div className="flex items-center gap-2.5 px-2">
            <span
              aria-hidden="true"
              className="inline-flex size-7 items-center justify-center rounded-md bg-brand font-mono text-label text-on-brand"
            >
              {strings.app.logoLetters}
            </span>
            <span className="flex-1 text-sm font-semibold">
              {strings.app.name}
            </span>
            {/* Chuông thông báo trong app (E4-1). */}
            <NotificationBell />
          </div>
          <nav aria-label={t.navLabel} className="flex flex-col gap-0.5">
            <Link
              href={HOME_PATH}
              aria-current="page"
              className={`${navLink} bg-bg-muted font-semibold shadow-[inset_2px_0_0_var(--color-primary)]`}
            >
              {t.navProjects}
            </Link>
            {isAdmin ? (
              <>
                <span className="label mt-3 flex items-center gap-2 px-2.5 pb-1">
                  <span
                    aria-hidden="true"
                    className="inline-block size-1.5 rounded-pill bg-accent"
                  />
                  {t.navAdminSection}
                </span>
                <Link href="/admin/users" className={navLink}>
                  {t.navUsers}
                </Link>
              </>
            ) : null}
          </nav>
          <div className="hidden flex-1 lg:block" />
          <div className="flex flex-col gap-3 border-0 border-t border-solid border-border px-2 pt-3">
            <div className="flex items-center gap-2.5">
              <Avatar name={userName || email} size="md" />
              <div className="flex min-w-0 flex-1 flex-col">
                {/* Chưa có họ tên: email đã hiện ở dòng "Đang đăng nhập" bên dưới, không lặp lại. */}
                {userName ? (
                  <span className="text-sm font-medium [overflow-wrap:anywhere]">
                    {userName}
                  </span>
                ) : null}
                {roleLabel ? <span className="label">{roleLabel}</span> : null}
              </div>
            </div>
            <p className="text-xs font-normal [overflow-wrap:anywhere] text-text-muted">
              {strings.home.signedInAs}{" "}
              <span className="text-text">{email}</span>
            </p>
            <LanguageSwitcher className="items-start" />
            <form action={signOut}>
              <button
                type="submit"
                className="inline-flex min-h-11 w-full cursor-pointer items-center justify-center rounded-md border border-solid border-border-strong bg-bg px-3 font-sans text-sm font-medium text-primary hover:bg-bg-muted sm:min-h-9 sm:w-auto"
              >
                {strings.home.signOut}
              </button>
            </form>
          </div>
        </aside>
        <main className="flex min-w-0 flex-1 flex-col">{children}</main>
      </div>
    </div>
  );
}
