"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { ExportReportDialog } from "@/components/reports/export-report-dialog";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorIcon } from "@/components/ui/icons";
import { Skeleton, SkeletonGroup } from "@/components/ui/skeleton";
import type { ApiError } from "@/lib/api/errors";
import { HOME_PATH } from "@/lib/auth/routes";
import { fetchDashboard } from "@/lib/dashboard/client-api";
import {
  CATEGORIES,
  categoryCounts,
  share,
  type AssigneeBucket,
  type Dashboard,
} from "@/lib/dashboard/model";
import { useLocale, useStrings } from "@/lib/i18n/client";
import { formatCalendarDate, formatNumber } from "@/lib/i18n/format";
import type { Messages } from "@/lib/i18n/messages";
import { BAR_TONE, BarTable, StackedBar, type BarTone } from "./charts";
import { ProjectViewsNav } from "./project-views-nav";

type Loaded =
  | { key: number; status: "ready"; data: Dashboard }
  | { key: number; status: "error"; error: ApiError };

export interface DashboardScreenProps {
  projectId: string;
  projectName: string;
  /** PM, Thành viên, Admin: được tạo task (trạng thái rỗng hiện lối tạo task). */
  canCreateTask: boolean;
  /** PM của dự án, Admin: thấy nút Xuất báo cáo (S07, Story E5-3). */
  canExportReport?: boolean;
  isAdmin?: boolean;
}

const card =
  "flex min-w-0 flex-col gap-3 rounded-lg border border-solid border-border bg-bg p-4 sm:p-5";

/**
 * Dashboard tiến độ S06 (Story E5-1, mockup v3 bp-Dashboard.dc.html): thẻ số liệu, phân bố theo
 * nhóm/trạng thái, theo người phụ trách, ưu tiên, loại, danh sách task trễ hạn. Số liệu do
 * GET /api/v1/projects/{id}/dashboard tính trong CSDL; màn này chỉ hiển thị, không có thao tác sửa
 * nên mọi vai trò (kể cả Người xem) thấy như nhau.
 */
export function DashboardScreen({
  projectId,
  projectName,
  canCreateTask,
  canExportReport = false,
  isAdmin = false,
}: DashboardScreenProps) {
  const strings = useStrings();
  const t = strings.dashboard;
  const [reloadKey, setReloadKey] = useState(0);
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetchDashboard(projectId, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        setLoaded(
          result.ok
            ? { key: reloadKey, status: "ready", data: result.data.data }
            : { key: reloadKey, status: "error", error: result.error },
        );
      })
      .catch((error: unknown) => {
        if ((error as { name?: string }).name !== "AbortError") throw error;
      });
    return () => controller.abort();
  }, [projectId, reloadKey]);

  const reload = useCallback(() => setReloadKey((n) => n + 1), []);
  const loading = !loaded || loaded.key !== reloadKey;
  const data = !loading && loaded.status === "ready" ? loaded.data : null;

  let body: ReactNode;
  if (loading) {
    body = <LoadingState label={t.loading} />;
  } else if (loaded.status === "error") {
    body = (
      <div
        role="alert"
        className="flex flex-col items-start gap-3 rounded-lg border border-solid border-border bg-bg-subtle p-4"
      >
        <p className="flex items-center gap-2 text-sm text-text">
          <ErrorIcon className="size-4 shrink-0 text-danger" />
          {t.loadError}
        </p>
        <Button variant="secondary" onClick={reload}>
          {t.retry}
        </Button>
      </div>
    );
  } else if (loaded.data.total === 0) {
    body = (
      <EmptyState
        title={t.empty.title}
        description={
          canCreateTask ? t.empty.bodyCanCreate : t.empty.bodyReadOnly
        }
        action={
          canCreateTask ? (
            <Link
              href={`/projects/${projectId}`}
              className="inline-flex min-h-11 items-center rounded-md border border-solid border-transparent bg-primary px-3.5 py-2 text-sm font-medium text-on-primary hover:bg-primary-hover hover:text-on-primary sm:min-h-9"
            >
              {t.empty.action}
            </Link>
          ) : undefined
        }
      />
    );
  } else {
    body = <Metrics data={loaded.data} projectId={projectId} />;
  }

  return (
    <div className="flex min-w-0 flex-col gap-5 px-4 py-6 sm:px-8">
      <Link
        href={HOME_PATH}
        className="inline-flex min-h-11 w-fit items-center text-sm sm:min-h-0"
      >
        <span aria-hidden="true">←&nbsp;</span>
        {t.backToProjects}
      </Link>
      <header className="flex flex-col gap-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex min-w-0 flex-col gap-2">
            <span className="label [overflow-wrap:anywhere]">
              {t.eyebrow(projectName, data?.total ?? 0)}
            </span>
            <h1 className="font-display text-display-sm">
              {t.heading}
              <span aria-hidden="true" className="text-accent">
                .
              </span>
            </h1>
          </div>
          {canExportReport ? (
            <ExportReportDialog
              projectId={projectId}
              projectName={projectName}
              isAdmin={isAdmin}
            />
          ) : null}
        </div>
        <ProjectViewsNav projectId={projectId} current="dashboard" />
      </header>
      {body}
    </div>
  );
}

function LoadingState({ label }: { label: string }) {
  return (
    <SkeletonGroup label={label} className="gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className={card}>
            <Skeleton className="w-24" />
            <Skeleton className="h-8 w-16" />
            <Skeleton className="w-32" />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {[0, 1].map((i) => (
          <div key={i} className={card}>
            <Skeleton className="w-40" />
            <Skeleton className="h-3" />
            <Skeleton />
            <Skeleton />
            <Skeleton />
          </div>
        ))}
      </div>
    </SkeletonGroup>
  );
}

function assigneeName(a: AssigneeBucket, t: Messages["dashboard"]): string {
  if (a.assignee_id === null) return t.byAssignee.unassigned;
  return a.full_name?.trim() || t.byAssignee.formerMember;
}

function Metrics({ data, projectId }: { data: Dashboard; projectId: string }) {
  const strings = useStrings();
  const locale = useLocale();
  const t = strings.dashboard;
  const n = (v: number) => formatNumber(v, locale);
  const pct = (v: number) => t.percent(v);
  const groupLabel = strings.projectConfig.categories;
  const groups = categoryCounts(data);
  const statusMax = Math.max(0, ...data.by_status.map((s) => s.count));
  const typeMax = Math.max(0, ...data.by_type.map((s) => s.count));
  const prioMax = Math.max(0, ...data.by_priority.map((s) => s.count));
  const openMax = Math.max(0, ...data.by_assignee.map((a) => a.open));
  const names = new Map(
    data.by_assignee.map((a) => [a.assignee_id, assigneeName(a, t)]),
  );
  const todayText = formatCalendarDate(data.today, locale) ?? data.today;

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <section aria-label={t.kpisLabel}>
        <ul className="grid list-none grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <li className={card}>
            <span className="label">{t.kpi.completion}</span>
            <span className="font-display text-display-lg">
              {pct(data.completion_percent)}
            </span>
            <div
              role="progressbar"
              aria-valuenow={data.completion_percent}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={t.kpi.completionAria(data.completion_percent)}
              className="h-2 w-full overflow-hidden rounded-pill bg-bg-muted"
            >
              <div
                className="h-full rounded-pill bg-success"
                style={{ width: `${data.completion_percent}%` }}
              />
            </div>
            <span className="text-sm text-text-muted">
              {t.kpi.completionNote(n(data.done), n(data.total))}
            </span>
          </li>
          <Kpi
            label={t.kpi.inProgress}
            value={n(data.in_progress)}
            note={t.kpi.inProgressNote}
          />
          <Kpi
            label={t.kpi.overdue}
            value={n(data.overdue)}
            note={t.kpi.overdueNote}
            tone={data.overdue > 0 ? "danger" : undefined}
          />
          <Kpi
            label={t.kpi.blocked}
            value={n(data.blocked)}
            note={t.kpi.blockedNote}
            tone={data.blocked > 0 ? "warning" : undefined}
          />
        </ul>
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section aria-labelledby="dash-status" className={card}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="dash-status" className="text-lg">
              {t.byStatus.title}
            </h2>
            <span className="label">{t.byStatus.total(n(data.total))}</span>
          </div>
          <StackedBar
            label={t.byGroup.summary(
              CATEGORIES.map((c) =>
                t.byGroup.part(
                  groupLabel[c],
                  n(groups[c]),
                  share(groups[c], data.total),
                ),
              ).join(", "),
            )}
            segments={CATEGORIES.map((c) => ({
              key: c,
              value: groups[c],
              tone: c,
            }))}
          />
          <ul
            aria-label={t.byGroup.title}
            className="flex list-none flex-wrap gap-x-4 gap-y-1 text-sm"
          >
            {CATEGORIES.map((c) => (
              <li key={c} className="inline-flex items-center gap-1.5">
                <Swatch tone={c} />
                <span>{groupLabel[c]}</span>
                <span className="font-mono tabular-nums text-text-muted">
                  {n(groups[c])} · {pct(share(groups[c], data.total))}
                </span>
              </li>
            ))}
          </ul>
          <BarTable
            caption={t.byStatus.title}
            headers={[t.byStatus.colStatus, t.colCount, t.colShare]}
            max={statusMax}
            rows={data.by_status.map((s) => ({
              key: s.id,
              label: (
                <span className="inline-flex flex-wrap items-center gap-x-2">
                  <span>{s.name}</span>
                  <span className="text-xs text-text-muted">
                    {groupLabel[s.category]}
                  </span>
                </span>
              ),
              value: s.count,
              tone: s.category,
              cells: [n(s.count), pct(share(s.count, data.total))],
            }))}
          />
        </section>

        <section aria-labelledby="dash-assignee" className={card}>
          <h2 id="dash-assignee" className="text-lg">
            {t.byAssignee.title}
          </h2>
          <BarTable
            caption={t.byAssignee.title}
            headers={[
              t.byAssignee.colPerson,
              t.byAssignee.colOpen,
              t.byAssignee.colOverdue,
              t.byAssignee.colDone,
            ]}
            max={openMax}
            rows={data.by_assignee.map((a) => ({
              key: a.assignee_id ?? "unassigned",
              label: (
                <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span
                    className={a.assignee_id === null ? "italic" : undefined}
                  >
                    {assigneeName(a, t)}
                  </span>
                  {a.assignee_id !== null && !a.is_member ? (
                    <Badge tone="neutral">{t.byAssignee.leftBadge}</Badge>
                  ) : null}
                </span>
              ),
              value: a.open,
              tone: "primary",
              cells: [
                n(a.open),
                a.overdue > 0 ? (
                  <span className="text-danger">{n(a.overdue)}</span>
                ) : (
                  n(a.overdue)
                ),
                n(a.done),
              ],
            }))}
          />
        </section>

        <section aria-labelledby="dash-priority" className={card}>
          <h2 id="dash-priority" className="text-lg">
            {t.byPriority.title}
          </h2>
          <BarTable
            caption={t.byPriority.title}
            headers={[t.byPriority.colPriority, t.colCount, t.colShare]}
            max={prioMax}
            rows={data.by_priority.map((p) => ({
              key: p.priority,
              label: strings.ui.priority[p.priority],
              value: p.count,
              tone: p.priority === "urgent" ? "danger" : "primary",
              cells: [n(p.count), pct(share(p.count, data.total))],
            }))}
          />
        </section>

        <section aria-labelledby="dash-type" className={card}>
          <h2 id="dash-type" className="text-lg">
            {t.byType.title}
          </h2>
          <BarTable
            caption={t.byType.title}
            headers={[t.byType.colType, t.colCount, t.colShare]}
            max={typeMax}
            rows={data.by_type.map((ty) => ({
              key: ty.id,
              label: (
                <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span>{ty.name}</span>
                  {ty.is_milestone ? (
                    <Badge tone="neutral">{t.byType.milestone}</Badge>
                  ) : null}
                </span>
              ),
              value: ty.count,
              tone: "primary",
              cells: [n(ty.count), pct(share(ty.count, data.total))],
            }))}
          />
        </section>
      </div>

      <section aria-labelledby="dash-overdue" className={card}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="dash-overdue" className="text-lg">
            {t.overdueList.title}
          </h2>
          <span className="label">{n(data.overdue)}</span>
        </div>
        {data.overdue_tasks.length === 0 ? (
          <p className="text-sm text-text-muted">{t.overdueList.empty}</p>
        ) : (
          <ol className="flex list-none flex-col">
            {data.overdue_tasks.map((task) => (
              <li
                key={task.id}
                className="border-0 border-t border-solid border-border first:border-t-0"
              >
                <Link
                  href={`/projects/${projectId}/tasks/${task.id}`}
                  className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 py-2 text-text hover:text-primary"
                >
                  <span className="min-w-0 flex-1 font-medium [overflow-wrap:anywhere]">
                    {task.title}
                  </span>
                  <span className="text-xs text-text-muted">
                    {names.get(task.assignee_id) ?? t.byAssignee.unassigned}
                    {" · "}
                    {t.overdueList.due(
                      formatCalendarDate(task.due_date, locale) ??
                        task.due_date,
                    )}
                  </span>
                  <Badge tone="danger">
                    {t.overdueList.days(task.days_overdue)}
                  </Badge>
                </Link>
              </li>
            ))}
          </ol>
        )}
        {data.overdue > data.overdue_tasks.length ? (
          <p className="text-xs text-text-muted">
            {t.overdueList.more(data.overdue_tasks.length, data.overdue)}
          </p>
        ) : null}
      </section>

      <p className="text-xs text-text-muted">{t.todayNote(todayText)}</p>
    </div>
  );
}

function Kpi({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: string;
  note: string;
  tone?: "danger" | "warning";
}) {
  return (
    <li className={card}>
      <span className="label">{label}</span>
      <span
        className={
          "font-display text-display-lg " +
          (tone === "danger"
            ? "text-danger"
            : tone === "warning"
              ? "text-warning"
              : "text-text")
        }
      >
        {value}
      </span>
      <span className="text-sm text-text-muted">{note}</span>
    </li>
  );
}

function Swatch({ tone }: { tone: BarTone }) {
  return (
    <span
      aria-hidden="true"
      className={"inline-block size-2.5 rounded-sm " + BAR_TONE[tone]}
    />
  );
}
