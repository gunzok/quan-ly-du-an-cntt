"use client";

import Link from "next/link";
import { cn } from "@/lib/cn";
import { useStrings } from "@/lib/i18n/client";

export type ProjectView = "board" | "dashboard" | "settings";

const VIEWS: readonly ProjectView[] = ["board", "dashboard", "settings"];

const href = (projectId: string, view: ProjectView) =>
  view === "board"
    ? `/projects/${projectId}`
    : `/projects/${projectId}/${view}`;

/**
 * Thanh điều hướng con TỐI THIỂU của dự án (Bảng, Tổng quan, Cấu hình) cho màn dashboard (Story
 * E5-1). Thanh chính thức thuộc E3-1 (components/project-shell/*); khi E3-1 merge, thay thành
 * phần này bằng thanh đó. Liên kết theo quy ước: /projects/{id}, /projects/{id}/dashboard,
 * /projects/{id}/settings.
 */
export function ProjectViewsNav({
  projectId,
  current,
}: {
  projectId: string;
  current: ProjectView;
}) {
  const t = useStrings().dashboard;
  return (
    <nav aria-label={t.navLabel} className="min-w-0 overflow-x-auto">
      <ul className="flex list-none gap-1 border-0 border-b border-solid border-border">
        {VIEWS.map((view, i) => {
          const active = view === current;
          return (
            <li key={view}>
              <Link
                href={href(projectId, view)}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "-mb-px inline-flex min-h-11 items-center gap-2 border-0 border-b-2 border-solid px-3 text-sm sm:min-h-9",
                  active
                    ? "border-primary font-medium text-text"
                    : "border-transparent text-text-muted hover:text-text",
                )}
              >
                <span
                  aria-hidden="true"
                  className="font-mono text-xs text-text-muted"
                >
                  {String(i + 1).padStart(2, "0")}
                </span>
                {t.nav[view]}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
