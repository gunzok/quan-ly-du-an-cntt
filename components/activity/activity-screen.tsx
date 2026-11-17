"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { ProjectHeader } from "@/components/project-shell/project-header";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { ErrorIcon } from "@/components/ui/icons";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Skeleton, SkeletonGroup } from "@/components/ui/skeleton";
import { fetchProjectActivity } from "@/lib/activity/client-api";
import {
  ACTIVITY_PERIODS,
  EMPTY_ACTIVITY_FILTERS,
  isFiltered,
  toApiFilters,
  type ActivityFilterState,
  type ActivityPeriod,
} from "@/lib/activity/filters";
import {
  ACTIVITY_ACTIONS,
  ACTIVITY_ENTITY_TYPES,
  type ActivityEntry,
} from "@/lib/activity/model";
import { vnDateOf } from "@/lib/activity/time";
import type { ApiError } from "@/lib/api/errors";
import { apiErrorText } from "@/lib/i18n/api-error";
import { useStrings } from "@/lib/i18n/client";
import { fetchMembers } from "@/lib/project-members/client-api";
import type { ProjectMember } from "@/lib/project-members/model";
import { ActivityList } from "./activity-list";

const PAGE_SIZE = 50;

type Loaded =
  | {
      key: string;
      status: "ready";
      entries: ActivityEntry[];
      next: string | null;
    }
  | { key: string; status: "error"; error: ApiError };

type More = { status: "idle" | "loading" } | { status: "error" };

export interface ActivityScreenProps {
  projectId: string;
  projectName: string;
  /** PM của dự án hoặc Admin (máy chủ đã tính). Không: hiện thông báo không có quyền. */
  canView: boolean;
}

/**
 * Nhật ký hoạt động S15 (Story E6-2, mockup v3 bp-Activity.dc.html): danh sách mới nhất trước,
 * nhóm theo ngày giờ Việt Nam, lọc người thực hiện, thời gian, đối tượng, loại thay đổi, tải thêm
 * theo con trỏ. Chỉ đọc. Dữ liệu qua GET /api/v1/projects/{id}/activity (API và RLS kiểm quyền).
 */
export function ActivityScreen({
  projectId,
  projectName,
  canView,
}: ActivityScreenProps) {
  const t = useStrings().activity;
  return (
    <div className="flex min-w-0 flex-col">
      <ProjectHeader
        projectId={projectId}
        projectName={projectName}
        active="activity"
        canViewActivity={canView}
      />
      <div className="flex min-w-0 flex-col gap-5 px-4 py-5 sm:px-7">
        <h2 className="sr-only">{t.heading}</h2>
        {canView ? (
          <ActivityBody projectId={projectId} />
        ) : (
          <EmptyState title={t.heading} description={t.errors.forbidden} />
        )}
      </div>
    </div>
  );
}

function ActivityBody({ projectId }: { projectId: string }) {
  const strings = useStrings();
  const t = strings.activity;
  const [today] = useState(() => vnDateOf(new Date()));
  const [filters, setFilters] = useState<ActivityFilterState>(
    EMPTY_ACTIVITY_FILTERS,
  );
  const [reloadKey, setReloadKey] = useState(0);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [more, setMore] = useState<More>({ status: "idle" });
  const [members, setMembers] = useState<ProjectMember[]>([]);

  const api = useMemo(() => toApiFilters(filters, today), [filters, today]);
  const key = `${JSON.stringify(api)}#${reloadKey}`;

  useEffect(() => {
    const controller = new AbortController();
    fetchMembers(projectId, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted && result.ok) {
          setMembers(result.data.data);
        }
      })
      .catch((error: unknown) => {
        if ((error as { name?: string }).name !== "AbortError") throw error;
      });
    return () => controller.abort();
  }, [projectId]);

  useEffect(() => {
    if (!api.ok) return;
    const controller = new AbortController();
    fetchProjectActivity(
      projectId,
      { filters: api.filters, limit: PAGE_SIZE },
      controller.signal,
    )
      .then((result) => {
        if (controller.signal.aborted) return;
        setMore({ status: "idle" });
        setLoaded(
          result.ok
            ? {
                key,
                status: "ready",
                entries: result.data.data,
                next: result.data.next_cursor,
              }
            : { key, status: "error", error: result.error },
        );
      })
      .catch((error: unknown) => {
        if ((error as { name?: string }).name !== "AbortError") throw error;
      });
    return () => controller.abort();
    // `key` gói đủ bộ lọc và lượt tải lại.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, key]);

  const loadMore = useCallback(async () => {
    if (!loaded || loaded.status !== "ready" || !loaded.next || !api.ok) return;
    const at = loaded.key;
    setMore({ status: "loading" });
    const result = await fetchProjectActivity(projectId, {
      filters: api.filters,
      limit: PAGE_SIZE,
      cursor: loaded.next,
    });
    setLoaded((prev) => {
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
    setMore({ status: result.ok ? "idle" : "error" });
  }, [api, loaded, projectId]);

  const update = (patch: Partial<ActivityFilterState>) =>
    setFilters((f) => ({ ...f, ...patch }));

  const loading = api.ok && (!loaded || loaded.key !== key);
  const filtered = isFiltered(filters);

  let body: ReactNode;
  if (!api.ok) {
    body = null;
  } else if (loading) {
    body = <LoadingState label={t.loading} />;
  } else if (loaded!.status === "error") {
    body = (
      <div
        role="alert"
        className="flex flex-col items-start gap-3 rounded-lg border border-solid border-border bg-bg-subtle p-4"
      >
        <p className="m-0 flex items-center gap-2 text-sm text-text">
          <ErrorIcon className="size-4 shrink-0 text-danger" />
          {t.loadError} {apiErrorText(strings, loaded!.error)}
        </p>
        <Button variant="secondary" onClick={() => setReloadKey((n) => n + 1)}>
          {t.retry}
        </Button>
      </div>
    );
  } else if (loaded!.entries.length === 0) {
    body = filtered ? (
      <EmptyState
        title={t.emptyFiltered.title}
        description={t.emptyFiltered.body}
        headingLevel={3}
        action={
          <Button
            variant="secondary"
            onClick={() => setFilters(EMPTY_ACTIVITY_FILTERS)}
          >
            {t.filters.reset}
          </Button>
        }
      />
    ) : (
      <EmptyState
        title={t.empty.title}
        description={t.empty.body}
        headingLevel={3}
      />
    );
  } else {
    const ready = loaded as Extract<Loaded, { status: "ready" }>;
    body = (
      <div className="flex min-w-0 flex-col gap-4">
        <div aria-label={t.listLabel} role="region">
          <ActivityList entries={ready.entries} today={today} />
        </div>
        {ready.next ? (
          <div className="flex flex-col items-start gap-2">
            {more.status === "error" ? (
              <p role="alert" className="m-0 flex items-center gap-2 text-sm">
                <ErrorIcon className="size-4 shrink-0 text-danger" />
                {t.loadMoreError}
              </p>
            ) : null}
            <Button
              variant="secondary"
              loading={more.status === "loading"}
              loadingText={t.loadingMore}
              onClick={loadMore}
            >
              {more.status === "error" ? t.retry : t.loadMore}
            </Button>
          </div>
        ) : null}
      </div>
    );
  }

  const shown =
    !loading && loaded?.status === "ready" ? loaded.entries.length : null;

  return (
    <>
      <Filters
        filters={filters}
        members={members}
        invalidRange={!api.ok}
        filtered={filtered}
        update={update}
        reset={() => setFilters(EMPTY_ACTIVITY_FILTERS)}
      />
      <p role="status" className="sr-only">
        {shown === null ? "" : t.shown(shown)}
      </p>
      {body}
    </>
  );
}

function Filters({
  filters,
  members,
  invalidRange,
  filtered,
  update,
  reset,
}: {
  filters: ActivityFilterState;
  members: readonly ProjectMember[];
  invalidRange: boolean;
  filtered: boolean;
  update: (patch: Partial<ActivityFilterState>) => void;
  reset: () => void;
}) {
  const t = useStrings().activity;
  const f = t.filters;
  return (
    <form
      aria-label={f.label}
      onSubmit={(e) => e.preventDefault()}
      className="flex min-w-0 flex-col gap-3 border-0 border-b border-solid border-border pb-4"
    >
      <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label={f.actor}>
          {(control) => (
            <Select
              {...control}
              value={filters.actor}
              onChange={(e) => update({ actor: e.target.value })}
              options={[
                { value: "", label: f.actorAll },
                ...members.map((m) => ({
                  value: m.user_id,
                  label: m.user.full_name || m.user.email || m.user_id,
                })),
              ]}
            />
          )}
        </Field>
        <Field label={f.period}>
          {(control) => (
            <Select
              {...control}
              value={filters.period}
              onChange={(e) =>
                update({ period: e.target.value as ActivityPeriod })
              }
              options={ACTIVITY_PERIODS.map((p) => ({
                value: p,
                label: f.periods[p],
              }))}
            />
          )}
        </Field>
        <Field label={f.entity}>
          {(control) => (
            <Select
              {...control}
              value={filters.entity}
              onChange={(e) => update({ entity: e.target.value })}
              options={[
                { value: "", label: f.entityAll },
                ...ACTIVITY_ENTITY_TYPES.map((v) => ({
                  value: v,
                  label: f.entities[v],
                })),
              ]}
            />
          )}
        </Field>
        <Field label={f.action}>
          {(control) => (
            <Select
              {...control}
              value={filters.action}
              onChange={(e) => update({ action: e.target.value })}
              options={[
                { value: "", label: f.actionAll },
                ...ACTIVITY_ACTIONS.map((v) => ({
                  value: v,
                  label: f.actions[v],
                })),
              ]}
            />
          )}
        </Field>
      </div>
      {filters.period === "custom" ? (
        <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label={f.from} hint={f.timezoneHint}>
            {(control) => (
              <Input
                {...control}
                type="date"
                value={filters.from}
                max={filters.to || undefined}
                onChange={(e) => update({ from: e.target.value })}
              />
            )}
          </Field>
          <Field label={f.to} error={invalidRange ? f.rangeInvalid : undefined}>
            {(control) => (
              <Input
                {...control}
                type="date"
                value={filters.to}
                min={filters.from || undefined}
                onChange={(e) => update({ to: e.target.value })}
              />
            )}
          </Field>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="m-0 flex items-center gap-2 text-xs text-text-muted">
          <LockIcon />
          {t.readOnlyNote}
        </p>
        {filtered ? (
          <Button variant="text" onClick={reset}>
            {f.reset}
          </Button>
        ) : null}
      </div>
    </form>
  );
}

function LockIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden="true"
      focusable="false"
      className="size-3.5 shrink-0"
    >
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}

function LoadingState({ label }: { label: string }) {
  return (
    <SkeletonGroup label={label} className="gap-4">
      <Skeleton className="w-40" />
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="flex items-start gap-3">
          <Skeleton className="size-8 rounded-pill" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="w-3/4" />
            <Skeleton className="w-1/2" />
          </div>
        </div>
      ))}
    </SkeletonGroup>
  );
}
