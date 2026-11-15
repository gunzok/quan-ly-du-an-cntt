"use client";

import Link from "next/link";
import { useId } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton, SkeletonGroup } from "@/components/ui/skeleton";
import type { ApiError } from "@/lib/api/errors";
import type { TaskStatus } from "@/lib/project-config/model";
import type { TaskRelationView } from "@/lib/task-relations/model";
import { apiErrorText } from "@/lib/i18n/api-error";
import { useStrings } from "@/lib/i18n/client";

export type RelationsState =
  | { status: "loading" }
  | { status: "ready"; relations: TaskRelationView[] }
  | { status: "error"; error: ApiError };

/**
 * Quan hệ (mockup bp-TaskDetail mục 03): danh sách hai chiều từ GET /tasks/{id}/relations (E8-1),
 * nhãn theo góc nhìn của task đang xem (Bị chặn bởi, Đứng sau...). CHỈ HIỂN THỊ: thêm, bỏ quan hệ
 * là Story E8-2 nên không có nút "+ Thêm quan hệ" ở đây.
 */
export function RelationsSection({
  number,
  projectId,
  state,
  statuses,
  onRetry,
}: {
  number: string;
  projectId: string;
  state: RelationsState;
  statuses: TaskStatus[];
  onRetry: () => void;
}) {
  const strings = useStrings();
  const t = strings.taskDetail.relations;
  const headingId = useId();
  const statusName = (id: string | null) =>
    statuses.find((s) => s.id === id)?.name ?? strings.taskDetail.unknown;

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-1">
      <h2 id={headingId} className="label m-0 flex items-center gap-2 pb-1">
        <span
          aria-hidden="true"
          className="inline-block size-1.5 rounded-pill bg-accent"
        />
        {number} / {t.heading}
      </h2>
      {state.status === "loading" ? (
        <SkeletonGroup label={t.loading}>
          <Skeleton className="h-8" />
          <Skeleton className="h-8" />
        </SkeletonGroup>
      ) : state.status === "error" ? (
        <div role="alert" className="flex flex-wrap items-center gap-3">
          <p className="m-0 text-sm text-danger">
            {t.loadError} {apiErrorText(strings, state.error)}
          </p>
          <Button variant="secondary" onClick={onRetry}>
            {strings.taskDetail.retry}
          </Button>
        </div>
      ) : state.relations.length === 0 ? (
        <p className="m-0 text-sm text-text-muted">{t.empty}</p>
      ) : (
        <ul aria-label={t.listLabel} className="m-0 flex list-none flex-col p-0">
          {state.relations.map((r) => (
            <li
              key={r.id}
              data-relation={r.relation}
              className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-0 border-t border-solid border-border py-2 text-sm"
            >
              <span className="flex min-w-0 flex-wrap items-baseline gap-x-2.5">
                <span className="label">{t.kinds[r.relation]}</span>
                <Link
                  href={`/projects/${projectId}/tasks/${r.task.id}`}
                  className="inline-flex min-h-11 items-center [overflow-wrap:anywhere] sm:min-h-0"
                >
                  {r.task.title}
                </Link>
              </span>
              <span className="text-xs text-text-muted">
                {statusName(r.task.status_id)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
