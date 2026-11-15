"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton, SkeletonGroup } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import type { ApiError } from "@/lib/api/errors";
import { fetchConfig, patchConfig } from "@/lib/project-config/client-api";
import {
  compareConfigItems,
  positionForMove,
  type ConfigItemByKind,
  type ConfigKind,
  type TaskStatus,
  type TaskType,
} from "@/lib/project-config/model";
import { apiErrorText } from "@/lib/i18n/api-error";
import { useStrings } from "@/lib/i18n/client";
import { ConfigFormDialog, DeleteConfigDialog } from "./config-dialogs";

type AnyItem = ConfigItemByKind[ConfigKind];

type Loaded =
  | { key: number; status: "ready"; items: AnyItem[] }
  | { key: number; status: "error"; error: ApiError };

/** Một tab cấu hình: danh sách, thêm, sửa, đổi thứ tự (nút lên/xuống), xóa. */
export function ConfigPanel({
  kind,
  projectId,
  canEdit,
}: {
  kind: ConfigKind;
  projectId: string;
  canEdit: boolean;
}) {
  const strings = useStrings();
  const t = strings.projectConfig;
  const { toast } = useToast();
  const [reloadKey, setReloadKey] = useState(0);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<AnyItem | null>(null);
  const [moving, setMoving] = useState<string | null>(null);
  // Sau khi đổi thứ tự, đưa focus về nút vừa bấm (dòng đã đổi chỗ trong DOM).
  const [focusTarget, setFocusTarget] = useState<{
    id: string;
    dir: "up" | "down";
  } | null>(null);
  const k = t.kinds[kind];
  const ordered = kind !== "labels";

  useEffect(() => {
    const controller = new AbortController();
    fetchConfig(kind, projectId, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        setLoaded(
          result.ok
            ? { key: reloadKey, status: "ready", items: result.data.data }
            : { key: reloadKey, status: "error", error: result.error },
        );
      })
      .catch((error: unknown) => {
        if ((error as { name?: string }).name !== "AbortError") throw error;
      });
    return () => controller.abort();
  }, [kind, projectId, reloadKey]);

  useEffect(() => {
    if (!focusTarget) return;
    const { id, dir } = focusTarget;
    const panel = document.getElementById(`config-${kind}`);
    const wanted = panel?.querySelector<HTMLButtonElement>(
      `[data-move="${id}:${dir}"]`,
    );
    const fallback = panel?.querySelector<HTMLButtonElement>(
      `[data-move="${id}:${dir === "up" ? "down" : "up"}"]`,
    );
    const target =
      wanted && wanted.getAttribute("aria-disabled") !== "true"
        ? wanted
        : fallback;
    target?.focus();
  }, [focusTarget, kind]);

  const reload = useCallback(() => setReloadKey((n) => n + 1), []);

  const items =
    loaded?.status === "ready"
      ? [...loaded.items].sort(compareConfigItems)
      : [];
  const loading = !loaded || loaded.key !== reloadKey;

  function replaceItem(item: AnyItem) {
    setLoaded((current) =>
      current?.status === "ready"
        ? {
            ...current,
            items: current.items.map((i) => (i.id === item.id ? item : i)),
          }
        : current,
    );
  }

  async function move(item: AnyItem, index: number, direction: -1 | 1) {
    if (moving) return;
    const positions = items.map((i) => ("position" in i ? i.position : 0));
    const position = positionForMove(positions, index, direction);
    if (position === null) return;
    setMoving(item.id);
    const result = await patchConfig(kind, item.id, { position });
    setMoving(null);
    if (!result.ok) {
      toast({
        title: t.errors.actionFailed,
        description: apiErrorText(strings, result.error),
        tone: "error",
      });
      return;
    }
    replaceItem(result.data.data);
    setFocusTarget({ id: item.id, dir: direction === -1 ? "up" : "down" });
    toast({ title: t.done.moved(item.name) });
  }

  function openCreate() {
    setEditing(null);
    setFormOpen(true);
  }

  function openEdit(item: AnyItem) {
    setEditing(item);
    setFormOpen(true);
  }

  function handleSaved(item: AnyItem, mode: "created" | "updated") {
    setFormOpen(false);
    toast({
      title:
        mode === "created"
          ? t.done.added(item.name)
          : t.done.updated(item.name),
    });
    reload();
  }

  function handleDeleted(item: AnyItem, moved: number) {
    toast({
      title:
        moved > 0
          ? t.done.deletedMoved(item.name, moved)
          : t.done.deleted(item.name),
    });
    reload();
  }

  return (
    <section
      id={`config-${kind}`}
      aria-labelledby={`config-${kind}-heading`}
      className="flex flex-col gap-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={`config-${kind}-heading`} className="label">
          {k.listLabel}
          {loaded?.status === "ready" ? ` (${items.length})` : null}
        </h2>
        {canEdit ? (
          <Button variant="secondary" onClick={openCreate}>
            + {k.add}
          </Button>
        ) : null}
      </div>

      {loaded?.status === "error" && !loading ? (
        <div role="alert" className="flex flex-wrap items-center gap-3">
          <p className="text-sm text-danger">
            {t.loadError} {apiErrorText(strings, loaded.error)}
          </p>
          <Button variant="secondary" onClick={reload}>
            {t.retry}
          </Button>
        </div>
      ) : !loaded ? (
        <SkeletonGroup label={t.loading} className="flex flex-col gap-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-11" />
          ))}
        </SkeletonGroup>
      ) : items.length === 0 ? (
        <EmptyState title={k.empty} headingLevel={3} />
      ) : (
        <ul
          aria-label={k.listLabel}
          aria-busy={loading || undefined}
          className="m-0 flex list-none flex-col rounded-lg border border-solid border-border p-0"
        >
          {items.map((item, index) => (
            <li
              key={item.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-2 border-0 border-t border-solid border-border px-3 py-2 first:border-t-0"
            >
              <span
                aria-hidden="true"
                className="inline-block size-2.5 shrink-0 rounded-pill"
                style={{ backgroundColor: item.color }}
              />
              <span className="min-w-0 flex-1 font-medium [overflow-wrap:anywhere]">
                {item.name}
              </span>
              {kind === "statuses" ? (
                <Badge
                  tone={
                    (item as TaskStatus).category === "done"
                      ? "success"
                      : (item as TaskStatus).category === "in_progress"
                        ? "primary"
                        : "neutral"
                  }
                >
                  {t.categories[(item as TaskStatus).category]}
                </Badge>
              ) : null}
              {kind === "task-types" && (item as TaskType).is_milestone ? (
                <Badge tone="new">{t.milestone}</Badge>
              ) : null}
              <span className="font-mono text-code text-text-muted">
                {t.taskCount(item.task_count)}
              </span>
              {canEdit ? (
                <div
                  role="group"
                  aria-label={t.actions.groupLabel(item.name)}
                  className="flex flex-wrap gap-1"
                >
                  {ordered ? (
                    <>
                      <Button
                        variant="text"
                        data-move={`${item.id}:up`}
                        aria-label={t.actions.moveUpAction(item.name)}
                        disabled={index === 0 || moving !== null}
                        onClick={() => move(item, index, -1)}
                      >
                        <span aria-hidden="true">↑</span> {t.actions.moveUp}
                      </Button>
                      <Button
                        variant="text"
                        data-move={`${item.id}:down`}
                        aria-label={t.actions.moveDownAction(item.name)}
                        disabled={index === items.length - 1 || moving !== null}
                        onClick={() => move(item, index, 1)}
                      >
                        <span aria-hidden="true">↓</span> {t.actions.moveDown}
                      </Button>
                    </>
                  ) : null}
                  <Button variant="secondary" onClick={() => openEdit(item)}>
                    {t.actions.edit}
                    <span className="sr-only"> {item.name}</span>
                  </Button>
                  <DeleteConfigDialog
                    kind={kind}
                    item={item}
                    others={items.filter((i) => i.id !== item.id)}
                    onDeleted={handleDeleted}
                  />
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {canEdit ? (
        <ConfigFormDialog
          kind={kind}
          projectId={projectId}
          open={formOpen}
          item={editing}
          onOpenChange={setFormOpen}
          onSaved={handleSaved}
        />
      ) : null}
    </section>
  );
}
