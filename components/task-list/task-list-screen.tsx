"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ProjectHeader } from "@/components/project-shell/project-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Skeleton, SkeletonGroup } from "@/components/ui/skeleton";
import { ToastProvider, useToast } from "@/components/ui/toast";
import { useStrings } from "@/lib/i18n/client";
import { todayIso } from "@/lib/kanban/board";
import { fetchAllTasks } from "@/lib/kanban/client-api";
import {
  compareConfigItems,
  type StatusCategory,
} from "@/lib/project-config/model";
import { fetchConfig } from "@/lib/project-config/client-api";
import { fetchMembers } from "@/lib/project-members/client-api";
import {
  VIEW_GROUP_BY,
  type SavedViewFilters,
  type ViewColumn,
  type ViewGroupBy,
} from "@/lib/saved-views/model";
import {
  DEFAULT_TASK_LIST_STATE,
  hasActiveListFilters,
  loadListPrefs,
  nextSort,
  saveListPrefs,
  SORTABLE_COLUMNS,
  type TaskListState,
} from "@/lib/task-list/model";
import {
  buildRows,
  matchesListFilters,
  parentIds,
  type ListContext,
} from "@/lib/task-list/tree";
import { canCreateTask, type Actor } from "@/lib/tasks/policy";
import {
  TASK_PRIORITIES,
  type Task,
  type TaskPriority,
} from "@/lib/tasks/model";
import { isDateOrderValid } from "@/lib/tasks/validate";
import { ColumnDialog, CreateTaskDialog } from "./dialogs";
import { ListTable, type ListLookups } from "./list-table";

const SEARCH_DEBOUNCE_MS = 300;
const STATUS_OPEN = "__open__";
const STATUS_CUSTOM = "__custom__";

export interface TaskListScreenProps {
  projectId: string;
  projectName: string;
  actor: Actor;
}

/**
 * Bảng phân cấp của dự án (Story E3-2; S04, S12; mockup v3 bp-List.dc.html, bp-ListViews.dc.html).
 * Tải HẾT task bằng API danh sách có sẵn (con trỏ, 100/trang) rồi dựng cây, lọc, sắp xếp, nhóm ở
 * trình duyệt (lib/task-list/tree.ts); từ khóa tìm ở máy chủ (bỏ dấu, E3-3). Bảng chỉ đọc với mọi
 * vai trò; tạo task nhanh ẩn với Người xem (API vẫn trả 403). Cách xem (cột, sắp xếp, nhóm) theo
 * lược đồ query v1 của chế độ xem đã lưu và được ghi nhớ trong localStorage.
 */
export function TaskListScreen(props: TaskListScreenProps) {
  return (
    <ToastProvider>
      <TaskList {...props} />
    </ToastProvider>
  );
}

interface ListData {
  statuses: {
    id: string;
    name: string;
    color: string;
    category: StatusCategory;
    position: number;
  }[];
  types: { id: string; name: string }[];
  labels: { id: string; name: string; color: string }[];
  members: Map<string, string>;
}

type LoadState =
  { kind: "loading"; loaded: number } | { kind: "error" } | { kind: "ready" };

type SearchResult = { q: string; ids: ReadonlySet<string> | null };

function TaskList({ projectId, projectName, actor }: TaskListScreenProps) {
  const strings = useStrings();
  const t = strings.taskList;
  const { toast } = useToast();
  const readOnly =
    !actor.isAdmin && (actor.role === "viewer" || actor.role === null);
  const canCreate = canCreateTask(actor);

  const [requestKey, setRequestKey] = useState(0);
  const [loaded, setLoaded] = useState<{ key: number; state: LoadState }>({
    key: -1,
    state: { kind: "loading", loaded: 0 },
  });
  const load: LoadState =
    loaded.key === requestKey ? loaded.state : { kind: "loading", loaded: 0 };
  const [data, setData] = useState<ListData | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);

  // Cách xem: lấy từ localStorage ngay lần dựng đầu (khi còn đang tải nên không lệch hydrate).
  const [view, setView] = useState<TaskListState>(() =>
    typeof window === "undefined"
      ? DEFAULT_TASK_LIST_STATE
      : loadListPrefs(projectId),
  );
  const [qInput, setQInput] = useState("");
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [collapsedGroups, setCollapsedGroups] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const [searchResult, setSearchResult] = useState<SearchResult>({
    q: "",
    ids: null,
  });
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  useEffect(() => {
    saveListPrefs(projectId, view);
  }, [projectId, view.columns, view.sort, view.group_by]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Tải dữ liệu ----
  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    const key = requestKey;
    (async () => {
      const [statuses, types, labels, members, all] = await Promise.all([
        fetchConfig("statuses", projectId, signal),
        fetchConfig("task-types", projectId, signal),
        fetchConfig("labels", projectId, signal),
        fetchMembers(projectId, signal),
        fetchAllTasks(projectId, {}, signal, (n) =>
          setLoaded({ key, state: { kind: "loading", loaded: n } }),
        ),
      ]);
      if (signal.aborted) return;
      if (!statuses.ok || !types.ok || !labels.ok || !members.ok || !all.ok) {
        setLoaded({ key, state: { kind: "error" } });
        return;
      }
      setData({
        statuses: [...statuses.data.data].sort(compareConfigItems),
        types: [...types.data.data].sort(compareConfigItems),
        labels: [...labels.data.data].sort(compareConfigItems),
        members: new Map(
          members.data.data.map((m) => [m.user_id, m.user.full_name]),
        ),
      });
      setTasks(all.data);
      setLoaded({ key, state: { kind: "ready" } });
    })().catch((error: unknown) => {
      if ((error as { name?: string }).name !== "AbortError") {
        setLoaded({ key, state: { kind: "error" } });
      }
    });
    return () => controller.abort();
  }, [projectId, requestKey]);

  // ---- Tìm theo từ khóa (máy chủ, bỏ dấu, E3-3) ----
  const q = qInput.trim();
  useEffect(() => {
    if (!q) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      fetchAllTasks(projectId, { q }, controller.signal)
        .then((result) => {
          if (controller.signal.aborted) return;
          setSearchResult({
            q,
            ids: result.ok ? new Set(result.data.map((x) => x.id)) : null,
          });
        })
        .catch((error: unknown) => {
          if ((error as { name?: string }).name !== "AbortError") {
            setSearchResult({ q, ids: null });
          }
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [projectId, q]);
  const search = !q
    ? "idle"
    : searchResult.q !== q
      ? "searching"
      : searchResult.ids
        ? "done"
        : "error";

  // ---- Bộ lọc hiệu lực (đúng lược đồ v1: q đã cắt, khoảng hạn hợp lệ) ----
  const dueOrderOk = isDateOrderValid(
    view.filters.due_after,
    view.filters.due_before,
  );
  const filters: SavedViewFilters = useMemo(() => {
    const f: SavedViewFilters = { ...view.filters };
    if (q) f.q = q;
    else delete f.q;
    if (!dueOrderOk) {
      delete f.due_after;
      delete f.due_before;
    }
    return f;
  }, [view.filters, q, dueOrderOk]);
  const filtering = hasActiveListFilters(filters);
  const matchIds = search === "done" ? searchResult.ids : null;

  const matched = useMemo(() => {
    if (!filtering) return null;
    const { q: _q, ...rest } = filters;
    void _q;
    return new Set(
      tasks
        .filter((task) => matchesListFilters(task, rest, matchIds))
        .map((task) => task.id),
    );
  }, [filtering, filters, tasks, matchIds]);

  const ctx: ListContext = useMemo(
    () => ({
      statusOrder: new Map((data?.statuses ?? []).map((s, i) => [s.id, i])),
      typeOrder: new Map((data?.types ?? []).map((s, i) => [s.id, i])),
      labelOrder: new Map((data?.labels ?? []).map((s, i) => [s.id, i])),
      memberName: data?.members ?? new Map(),
    }),
    [data],
  );

  const { rows, matchCount } = useMemo(
    () =>
      buildRows({
        tasks,
        matched,
        sort: view.sort,
        groupBy: view.group_by,
        collapsed,
        collapsedGroups,
        ctx,
      }),
    [tasks, matched, view.sort, view.group_by, collapsed, collapsedGroups, ctx],
  );

  const lookups: ListLookups = useMemo(
    () => ({
      statuses: new Map((data?.statuses ?? []).map((s) => [s.id, s])),
      typeNames: new Map((data?.types ?? []).map((s) => [s.id, s.name])),
      labels: new Map((data?.labels ?? []).map((s) => [s.id, s])),
      members: data?.members ?? new Map(),
      titles: new Map(tasks.map((x) => [x.id, x.title])),
    }),
    [data, tasks],
  );
  const today = useMemo(() => todayIso(), []);

  const toggleTask = useCallback((id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }, []);
  const toggleGroup = useCallback((value: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (!next.delete(value)) next.add(value);
      return next;
    });
  }, []);
  const onSort = useCallback((column: ViewColumn) => {
    const field = SORTABLE_COLUMNS[column];
    if (!field) return;
    setView((prev) => ({ ...prev, sort: nextSort(prev.sort, field) }));
  }, []);
  const setFilter = (patch: Partial<SavedViewFilters>) =>
    setView((prev) => {
      const next = { ...prev.filters, ...patch };
      for (const k of Object.keys(next) as (keyof SavedViewFilters)[]) {
        if (next[k] === undefined) delete next[k];
      }
      return { ...prev, filters: next };
    });
  const clearFilters = () => {
    setQInput("");
    setView((prev) => ({ ...prev, filters: {} }));
  };

  const header = (
    <ProjectHeader
      projectId={projectId}
      projectName={projectName}
      active="list"
      meta={readOnly ? <Badge tone="neutral">{t.readOnly}</Badge> : null}
      actions={
        canCreate && load.kind === "ready" ? (
          <Button onClick={() => setCreateOpen(true)} trailing="→">
            {t.create.action}
          </Button>
        ) : null
      }
    />
  );

  if (load.kind === "loading" || (load.kind === "ready" && !data)) {
    return (
      <>
        {header}
        <SkeletonGroup
          label={
            load.kind === "loading" && load.loaded > 0
              ? t.loadingMore(load.loaded)
              : t.loading
          }
          className="gap-2 px-4 py-5 sm:px-7"
        >
          <Skeleton className="h-10 w-full max-w-xl" />
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-9" />
          ))}
        </SkeletonGroup>
      </>
    );
  }

  if (load.kind === "error" || !data) {
    return (
      <>
        {header}
        <div className="px-4 py-6 sm:px-7">
          <EmptyState
            title={t.loadError}
            action={
              <Button
                variant="secondary"
                onClick={() => setRequestKey((k) => k + 1)}
              >
                {t.retry}
              </Button>
            }
          />
        </div>
      </>
    );
  }

  const noMatch = filtering && search !== "searching" && matchCount === 0;
  const statusValue = statusSelectValue(view.filters.status_id, data.statuses);
  const memberOptions = [...data.members.entries()]
    .sort((a, b) => a[1].localeCompare(b[1], "vi"))
    .map(([value, label]) => ({ value, label }));

  return (
    <>
      {header}
      <div className="flex min-w-0 flex-col gap-4 px-4 py-4 sm:px-7">
        <div
          role="search"
          aria-label={t.filters.regionLabel}
          className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4"
        >
          <Field
            label={t.filters.search}
            hint={
              search === "searching"
                ? t.filters.searching
                : search === "error"
                  ? t.filters.searchError
                  : undefined
            }
          >
            {(control) => (
              <Input
                {...control}
                type="search"
                value={qInput}
                placeholder={t.filters.searchPlaceholder}
                maxLength={200}
                onChange={(e) => setQInput(e.target.value)}
              />
            )}
          </Field>
          <Field label={t.filters.status}>
            {(control) => (
              <Select
                {...control}
                value={statusValue}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === STATUS_CUSTOM) return;
                  setFilter({
                    status_id:
                      v === ""
                        ? undefined
                        : v === STATUS_OPEN
                          ? nonEmpty(openStatusIds(data.statuses))
                          : [v],
                  });
                }}
                options={[
                  { value: "", label: t.filters.statusAll },
                  { value: STATUS_OPEN, label: t.filters.statusOpen },
                  ...data.statuses.map((s) => ({ value: s.id, label: s.name })),
                  ...(statusValue === STATUS_CUSTOM
                    ? [
                        {
                          value: STATUS_CUSTOM,
                          label: t.filters.statusCustom(
                            view.filters.status_id?.length ?? 0,
                          ),
                        },
                      ]
                    : []),
                ]}
              />
            )}
          </Field>
          <Field label={t.filters.assignee}>
            {(control) => (
              <Select
                {...control}
                value={view.filters.assignee_id ?? ""}
                onChange={(e) =>
                  setFilter({ assignee_id: e.target.value || undefined })
                }
                options={[
                  { value: "", label: t.filters.assigneeAll },
                  ...memberOptions,
                ]}
              />
            )}
          </Field>
          <Field label={t.filters.priority}>
            {(control) => (
              <Select
                {...control}
                value={view.filters.priority ?? ""}
                onChange={(e) =>
                  setFilter({
                    priority: (e.target.value || undefined) as
                      TaskPriority | undefined,
                  })
                }
                options={[
                  { value: "", label: t.filters.priorityAll },
                  ...[...TASK_PRIORITIES].reverse().map((p) => ({
                    value: p,
                    label: strings.ui.priority[p],
                  })),
                ]}
              />
            )}
          </Field>
          <Field label={t.filters.label}>
            {(control) => (
              <Select
                {...control}
                value={view.filters.label_id ?? ""}
                onChange={(e) =>
                  setFilter({ label_id: e.target.value || undefined })
                }
                options={[
                  { value: "", label: t.filters.labelAll },
                  ...data.labels.map((l) => ({ value: l.id, label: l.name })),
                ]}
              />
            )}
          </Field>
          <Field label={t.filters.dueAfter}>
            {(control) => (
              <Input
                {...control}
                type="date"
                value={view.filters.due_after ?? ""}
                onChange={(e) =>
                  setFilter({ due_after: e.target.value || undefined })
                }
              />
            )}
          </Field>
          <Field
            label={t.filters.dueBefore}
            error={dueOrderOk ? undefined : t.filters.dueOrder}
          >
            {(control) => (
              <Input
                {...control}
                type="date"
                value={view.filters.due_before ?? ""}
                onChange={(e) =>
                  setFilter({ due_before: e.target.value || undefined })
                }
              />
            )}
          </Field>
          <div className="flex items-end">
            {filtering || hasActiveListFilters(view.filters) ? (
              <Button variant="text" onClick={clearFilters}>
                {t.clearFilters}
              </Button>
            ) : null}
          </div>
        </div>

        <div
          role="group"
          aria-label={t.toolbar.label}
          className="flex flex-wrap items-end gap-2"
        >
          <Field label={t.toolbar.groupBy} className="w-full sm:w-56">
            {(control) => (
              <Select
                {...control}
                value={view.group_by ?? ""}
                onChange={(e) => {
                  setCollapsedGroups(new Set());
                  setView((prev) => ({
                    ...prev,
                    group_by: (e.target.value || null) as ViewGroupBy | null,
                  }));
                }}
                options={[
                  { value: "", label: t.toolbar.groupNone },
                  ...VIEW_GROUP_BY.map((g) => ({
                    value: g,
                    label: t.groupBy[g],
                  })),
                ]}
              />
            )}
          </Field>
          <Button
            variant="secondary"
            onClick={() => {
              setCollapsed(new Set());
              setCollapsedGroups(new Set());
            }}
          >
            {t.toolbar.expandAll}
          </Button>
          <Button
            variant="secondary"
            onClick={() => setCollapsed(parentIds(tasks))}
          >
            {t.toolbar.collapseAll}
          </Button>
          <Button
            variant="secondary"
            aria-label={t.toolbar.columns}
            onClick={() => setColumnsOpen(true)}
          >
            {t.toolbar.columnsCount(view.columns.length)}
          </Button>
          <p
            role="status"
            className="m-0 ml-auto self-center font-mono text-label text-text-muted"
          >
            {t.resultCount(matchCount)}
          </p>
        </div>

        {readOnly ? (
          <p className="m-0 text-sm text-text-muted">{t.readOnlyNote}</p>
        ) : null}

        {tasks.length === 0 ? (
          <EmptyState
            title={t.emptyTitle}
            description={t.emptyBody}
            headingLevel={2}
            action={
              canCreate ? (
                <Button onClick={() => setCreateOpen(true)}>
                  {t.emptyAction}
                </Button>
              ) : undefined
            }
          />
        ) : noMatch ? (
          <EmptyState
            title={t.noMatchTitle}
            description={t.noMatchBody}
            headingLevel={2}
            action={
              <Button variant="secondary" onClick={clearFilters}>
                {t.clearFilters}
              </Button>
            }
          />
        ) : (
          <ListTable
            projectId={projectId}
            rows={rows}
            columns={view.columns}
            sort={view.sort}
            groupBy={view.group_by}
            lookups={lookups}
            today={today}
            onSort={onSort}
            onToggleTask={toggleTask}
            onToggleGroup={toggleGroup}
          />
        )}
      </div>
      <ColumnDialog
        open={columnsOpen}
        onOpenChange={setColumnsOpen}
        columns={view.columns}
        onChange={(columns) => setView((prev) => ({ ...prev, columns }))}
      />
      {canCreate ? (
        <CreateTaskDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          projectId={projectId}
          onCreated={(task) => {
            setTasks((prev) => [...prev, task]);
            toast({ title: t.create.created(task.title) });
          }}
        />
      ) : null}
    </>
  );
}

function nonEmpty(ids: string[]): string[] | undefined {
  return ids.length > 0 ? ids : undefined;
}

function openStatusIds(
  statuses: readonly { id: string; category: StatusCategory }[],
): string[] {
  return statuses
    .filter((s) => s.category !== "done")
    .map((s) => s.id)
    .sort();
}

function statusSelectValue(
  selected: readonly string[] | undefined,
  statuses: readonly { id: string; category: StatusCategory }[],
): string {
  if (!selected || selected.length === 0) return "";
  if (selected.length === 1 && statuses.some((s) => s.id === selected[0])) {
    return selected[0];
  }
  const open = openStatusIds(statuses);
  const sorted = [...selected].sort();
  if (
    open.length === sorted.length &&
    open.every((id, i) => id === sorted[i])
  ) {
    return STATUS_OPEN;
  }
  return STATUS_CUSTOM;
}
