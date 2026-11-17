"use client";

import Link from "next/link";
import { useEffect, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { ErrorIcon } from "@/components/ui/icons";
import { Skeleton, SkeletonGroup } from "@/components/ui/skeleton";
import { fetchTaskActivity } from "@/lib/activity/client-api";
import type { ActivityEntry } from "@/lib/activity/model";
import { vnDateOf } from "@/lib/activity/time";
import { useStrings } from "@/lib/i18n/client";
import { ActivityList } from "./activity-list";

const PAGE_SIZE = 20;

type State =
  | {
      key: string;
      status: "ready";
      entries: ActivityEntry[];
      next: string | null;
    }
  | { key: string; status: "error" };

/**
 * Mục "Nhật ký" trong chi tiết task (mockup bp-TaskDetail mục 04, Story E6-2). Chỉ hiện cho PM của
 * dự án và Admin (nơi gọi quyết định theo vai trò; API GET /api/v1/tasks/{id}/activity kiểm lại).
 * `reloadToken` đổi sau mỗi lần lưu task để thấy ngay thay đổi vừa ghi.
 */
export function TaskActivitySection({
  number,
  projectId,
  taskId,
  reloadToken,
}: {
  number: string;
  projectId: string;
  taskId: string;
  reloadToken?: string;
}) {
  const t = useStrings().activity;
  const headingId = useId();
  const [today] = useState(() => vnDateOf(new Date()));
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState<State | null>(null);
  const [more, setMore] = useState<"idle" | "loading" | "error">("idle");
  const key = `${taskId}#${reloadToken ?? ""}#${retry}`;

  useEffect(() => {
    const controller = new AbortController();
    fetchTaskActivity(taskId, { limit: PAGE_SIZE }, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        setMore("idle");
        setState(
          result.ok
            ? {
                key,
                status: "ready",
                entries: result.data.data,
                next: result.data.next_cursor,
              }
            : { key, status: "error" },
        );
      })
      .catch((error: unknown) => {
        if ((error as { name?: string }).name !== "AbortError") throw error;
      });
    return () => controller.abort();
  }, [taskId, key]);

  async function loadMore() {
    if (!state || state.status !== "ready" || !state.next) return;
    const at = state.key;
    setMore("loading");
    const result = await fetchTaskActivity(taskId, {
      limit: PAGE_SIZE,
      cursor: state.next,
    });
    setState((prev) => {
      if (!prev || prev.key !== at || prev.status !== "ready" || !result.ok) {
        return prev;
      }
      const seen = new Set(prev.entries.map((e) => e.id));
      return {
        ...prev,
        entries: [
          ...prev.entries,
          ...result.data.data.filter((e) => !seen.has(e.id)),
        ],
        next: result.data.next_cursor,
      };
    });
    setMore(result.ok ? "idle" : "error");
  }

  const loading = !state || state.key !== key;

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2">
      <h2 id={headingId} className="label m-0 flex items-center gap-2">
        <span
          aria-hidden="true"
          className="inline-block size-1.5 rounded-pill bg-accent"
        />
        {number} / {t.taskSection.heading}
      </h2>
      {loading ? (
        <SkeletonGroup label={t.taskSection.loading}>
          <Skeleton className="w-3/4" />
          <Skeleton className="w-1/2" />
        </SkeletonGroup>
      ) : state.status === "error" ? (
        <div role="alert" className="flex flex-col items-start gap-2">
          <p className="m-0 flex items-center gap-2 text-sm">
            <ErrorIcon className="size-4 shrink-0 text-danger" />
            {t.loadError}
          </p>
          <Button variant="secondary" onClick={() => setRetry((n) => n + 1)}>
            {t.retry}
          </Button>
        </div>
      ) : state.entries.length === 0 ? (
        <p className="m-0 text-sm text-text-muted">{t.taskSection.empty}</p>
      ) : (
        <ActivityList
          entries={state.entries}
          today={today}
          compact
          headingLevel={3}
        />
      )}
      {!loading && state.status === "ready" && state.next ? (
        <div className="flex flex-col items-start gap-2">
          {more === "error" ? (
            <p role="alert" className="m-0 flex items-center gap-2 text-sm">
              <ErrorIcon className="size-4 shrink-0 text-danger" />
              {t.loadMoreError}
            </p>
          ) : null}
          <Button
            variant="secondary"
            loading={more === "loading"}
            loadingText={t.loadingMore}
            onClick={loadMore}
          >
            {more === "error" ? t.retry : t.loadMore}
          </Button>
        </div>
      ) : null}
      <Link
        href={`/projects/${encodeURIComponent(projectId)}/activity`}
        className="inline-flex min-h-11 w-fit items-center text-sm sm:min-h-0"
      >
        {t.taskSection.viewProject}
      </Link>
    </section>
  );
}
