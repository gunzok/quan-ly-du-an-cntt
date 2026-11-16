"use client";

import Link from "next/link";
import { useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { CloseIcon } from "@/components/ui/icons";
import { Skeleton, SkeletonGroup } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import type { ApiError } from "@/lib/api/errors";
import type { TaskStatus } from "@/lib/project-config/model";
import { deleteRelation } from "@/lib/task-relations/client-api";
import type { TaskRelationView } from "@/lib/task-relations/model";
import type { RelationAccess } from "@/lib/task-relations/relation-ui";
import type { Actor } from "@/lib/tasks/policy";
import { apiErrorText } from "@/lib/i18n/api-error";
import { useStrings } from "@/lib/i18n/client";
import { AddRelationDialog } from "./add-relation-dialog";
import { relationErrorText } from "./relation-errors";

export type RelationsState =
  | { status: "loading" }
  | { status: "ready"; relations: TaskRelationView[] }
  | { status: "error"; error: ApiError };

/**
 * Quan hệ (mockup bp-TaskDetail mục 03): danh sách hai chiều từ GET /tasks/{id}/relations (E8-1),
 * nhãn theo góc nhìn của task đang xem (Bị chặn bởi, Đứng sau...). Story E8-2: nút "+ Thêm quan hệ"
 * (hộp thoại chọn kiểu và task đích) và nút bỏ từng quan hệ (có xác nhận). Danh sách cập nhật ngay
 * sau khi thêm/bỏ thành công; 404 thì tải lại phần quan hệ.
 *
 * Quyền (`access`, chỉ để khóa giao diện; API và RLS kiểm lại): Người xem không thấy nút (AC2);
 * Thành viên không sửa được task đang xem thấy nút bị khóa kèm giải thích; task đích không sửa được
 * bị khóa trong danh sách chọn, còn khi bỏ quan hệ thì 403 được giải thích bằng thông báo.
 */
export function RelationsSection({
  number,
  projectId,
  task,
  state,
  statuses,
  access,
  actor,
  onRetry,
  onChange,
}: {
  number: string;
  projectId: string;
  task: { id: string; title: string };
  state: RelationsState;
  statuses: TaskStatus[];
  access: RelationAccess;
  actor: Actor;
  onRetry: () => void;
  /** Sửa danh sách đang hiển thị (thêm, bỏ một dòng) khi phần quan hệ đã tải. */
  onChange: (
    update: (relations: TaskRelationView[]) => TaskRelationView[],
  ) => void;
}) {
  const strings = useStrings();
  const t = strings.taskDetail.relations;
  const ui = strings.taskRelationsUi;
  const { toast } = useToast();
  const headingId = useId();
  const lockedId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [adding, setAdding] = useState(false);
  const statusName = (id: string | null) =>
    statuses.find((s) => s.id === id)?.name ?? strings.taskDetail.unknown;
  const canManage = access === "enabled";

  async function remove(relation: TaskRelationView) {
    const result = await deleteRelation(task.id, relation.id);
    if (!result.ok) {
      toast({
        tone: "error",
        title: ui.removeFailed,
        description: relationErrorText(strings, result.error),
      });
      if (result.error.code === "not_found") onRetry();
      return;
    }
    onChange((list) => list.filter((r) => r.id !== relation.id));
    toast({ title: ui.removed });
    // Nút vừa bấm biến mất cùng dòng: đưa focus về tiêu đề mục để không rơi về đầu trang.
    requestAnimationFrame(() => headingRef.current?.focus());
  }

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center justify-between gap-2 pb-1">
        <h2
          id={headingId}
          ref={headingRef}
          tabIndex={-1}
          className="label m-0 flex items-center gap-2 outline-none"
        >
          <span
            aria-hidden="true"
            className="inline-block size-1.5 rounded-pill bg-accent"
          />
          {number} / {t.heading}
        </h2>
        {access === "hidden" ? null : (
          <Button
            variant="text"
            data-testid="add-relation"
            disabled={!canManage || state.status !== "ready"}
            aria-describedby={access === "locked" ? lockedId : undefined}
            onClick={() => setAdding(true)}
          >
            + {ui.add}
          </Button>
        )}
      </div>
      {access === "locked" ? (
        <p id={lockedId} className="m-0 pb-1 text-xs text-text-muted">
          {ui.locked}
        </p>
      ) : null}
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
        <ul
          aria-label={t.listLabel}
          className="m-0 flex list-none flex-col p-0"
        >
          {state.relations.map((r) => {
            const label = t.kinds[r.relation];
            return (
              <li
                key={r.id}
                data-relation={r.relation}
                className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-0 border-t border-solid border-border py-2 text-sm"
              >
                <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2.5">
                  <span className="label">{label}</span>
                  <Link
                    href={`/projects/${projectId}/tasks/${r.task.id}`}
                    className="inline-flex min-h-11 items-center [overflow-wrap:anywhere] sm:min-h-0"
                  >
                    {r.task.title}
                  </Link>
                  {r.lag_days !== 0 ? (
                    <span className="text-xs text-text-muted">
                      {ui.lag(r.lag_days)}
                    </span>
                  ) : null}
                </span>
                <span className="flex items-center gap-1">
                  <span className="text-xs text-text-muted">
                    {statusName(r.task.status_id)}
                  </span>
                  {canManage ? (
                    <ConfirmDialog
                      trigger={
                        <Button
                          variant="text"
                          aria-label={ui.removeLabel(label, r.task.title)}
                          title={ui.removeLabel(label, r.task.title)}
                          className="size-11 px-0 text-text-muted sm:size-9"
                        >
                          <CloseIcon className="size-4" />
                        </Button>
                      }
                      title={ui.removeTitle}
                      description={ui.removeBody(label, r.task.title)}
                      confirmLabel={ui.removeConfirm}
                      onConfirm={() => remove(r)}
                    />
                  ) : null}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {canManage ? (
        <AddRelationDialog
          open={adding}
          onOpenChange={setAdding}
          projectId={projectId}
          task={task}
          actor={actor}
          statuses={statuses}
          onCreated={(view) => {
            onChange((list) => [...list, view]);
            toast({ title: ui.added(t.kinds[view.relation], view.task.title) });
          }}
          onStale={onRetry}
        />
      ) : null}
    </section>
  );
}
