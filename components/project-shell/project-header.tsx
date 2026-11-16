"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { HOME_PATH } from "@/lib/auth/routes";
import { useStrings } from "@/lib/i18n/client";

export type ProjectView = "board" | "list" | "dashboard" | "settings";

/** Đường dẫn của từng chế độ xem dự án (quy ước liên kết giữa các story E3-1, E5-1, E2-3). */
export function projectViewHref(projectId: string, view: ProjectView): string {
  const base = `/projects/${encodeURIComponent(projectId)}`;
  if (view === "board") return base;
  return `${base}/${view}`;
}

const VIEWS: readonly ProjectView[] = [
  "board",
  "list",
  "dashboard",
  "settings",
];

/**
 * Đầu trang dự án (mockup v3 bp-Kanban.dc.html): đường về danh sách dự án, nhãn mục, tên dự án và
 * thanh điều hướng con Bảng / Danh sách / Tổng quan / Cấu hình (Story E3-1 sở hữu; Danh sách thuộc
 * E3-2, Tổng quan thuộc E5-1).
 * `meta` hiện cạnh nhãn mục (ví dụ "Chỉ xem"), `actions` ở góc phải.
 */
export function ProjectHeader({
  projectId,
  projectName,
  active,
  meta,
  actions,
}: {
  projectId: string;
  projectName: string;
  active: ProjectView;
  meta?: ReactNode;
  actions?: ReactNode;
}) {
  const strings = useStrings();
  const t = strings.projectNav;
  return (
    <div className="flex flex-col gap-3 border-0 border-b border-solid border-border px-4 pt-5 sm:px-7">
      <Link
        href={HOME_PATH}
        className="inline-flex min-h-11 w-fit items-center text-sm sm:min-h-0"
      >
        <span aria-hidden="true">←&nbsp;</span>
        {t.backToProjects}
      </Link>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1.5">
          <span className="label flex flex-wrap items-center gap-2">
            <span
              aria-hidden="true"
              className="inline-block size-1.5 rounded-pill bg-accent"
            />
            {t.eyebrow}
            {meta}
          </span>
          <h1 className="font-display text-display-sm [overflow-wrap:anywhere]">
            {projectName}
            <span aria-hidden="true" className="text-accent">
              .
            </span>
          </h1>
        </div>
        {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
      </div>
      <nav aria-label={t.navLabel} className="flex flex-wrap gap-x-6">
        {VIEWS.map((view, i) => {
          const current = view === active;
          return (
            <Link
              key={view}
              href={projectViewHref(projectId, view)}
              aria-current={current ? "page" : undefined}
              className={cn(
                "inline-flex min-h-11 items-center gap-1.5 border-0 border-b-2 border-solid px-0.5 text-sm no-underline",
                current
                  ? "border-primary font-semibold text-primary"
                  : "border-transparent text-text-muted hover:text-text",
              )}
            >
              <span aria-hidden="true" className="font-mono text-label">
                {String(i + 1).padStart(2, "0")}
              </span>
              {view === "list" ? strings.taskList.navTab : t[view]}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
