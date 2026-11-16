"use client";

import {
  closestCorners,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useDroppable,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type DragOverEvent,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import Link from "next/link";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ProjectHeader,
  projectViewHref,
} from "@/components/project-shell/project-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Skeleton, SkeletonGroup } from "@/components/ui/skeleton";
import { ToastProvider, useToast } from "@/components/ui/toast";
import type { ApiError } from "@/lib/api/errors";
import { apiErrorText } from "@/lib/i18n/api-error";
import { useStrings } from "@/lib/i18n/client";
import {
  canMoveTask,
  EMPTY_FILTERS,
  groupByStatus,
  hasActiveFilters,
  isOverdue,
  matchesFilters,
  subtaskCounts,
  todayIso,
  UNASSIGNED,
  type BoardColumnStatus,
  type BoardFilters,
} from "@/lib/kanban/board";
import { fetchAllTasks, moveTask } from "@/lib/kanban/client-api";
import { compareCards, fullIndexFor, planMove } from "@/lib/kanban/position";
import { fetchConfig } from "@/lib/project-config/client-api";
import { compareConfigItems } from "@/lib/project-config/model";
import { fetchMembers } from "@/lib/project-members/client-api";
import type { Actor } from "@/lib/tasks/policy";
import {
  TASK_PRIORITIES,
  type Task,
  type TaskPriority,
} from "@/lib/tasks/model";
import { MoveDialog } from "./move-dialog";
import { TaskCard, type CardLabel } from "./task-card";

/** Số thẻ hiện ban đầu mỗi cột (2.000 task vẫn mượt); "Hiện thêm" mỗi lần thêm chừng này. */
const PAGE_SIZE = 50;
/** Số thẻ hàng xóm tối đa được sửa khi dãn đoạn position trùng nhau (xem lib/kanban/position.ts). */
const MAX_SPREAD = 20;
const SEARCH_DEBOUNCE_MS = 300;
const COLUMN_PREFIX = "column:";

export interface KanbanScreenProps {
  projectId: string;
  projectName: string;
  actor: Actor;
}

/**
 * Bảng Kanban của dự án (Story E3-1; S03, S09, S10). Chỉ dùng API có sẵn: trạng thái, loại, nhãn
 * (E2-3), thành viên (E1-6), danh sách task theo con trỏ (tải hết rồi nhóm theo cột ở trình duyệt)
 * và PATCH /tasks/{id} (status_id, position). Quyền ở giao diện chỉ để ẩn thao tác; API và RLS
 * quyết định, 403/422 thì hoàn tác.
 */
export function KanbanScreen(props: KanbanScreenProps) {
  return (
    <ToastProvider>
      <Board {...props} />
    </ToastProvider>
  );
}

interface BoardData {
  statuses: BoardColumnStatus[];
  typeNames: Map<string, string>;
  labels: Map<string, CardLabel>;
  /** Tên thành viên hiện tại theo user_id. */
  members: Map<string, string>;
}

type LoadState =
  { kind: "loading"; loaded: number } | { kind: "error" } | { kind: "ready" };

type SearchState =
  | { kind: "idle" }
  | { kind: "searching" }
  | { kind: "error" }
  | { kind: "done"; ids: ReadonlySet<string> };

/** Kết quả tìm của một từ khóa (khác từ khóa đang gõ = đang tìm). */
type SearchResult = { q: string; ids: ReadonlySet<string> | null };

function Board({ projectId, projectName, actor }: KanbanScreenProps) {
  const strings = useStrings();
  const t = strings.kanban;
  const { toast } = useToast();
  const readOnly =
    !actor.isAdmin && (actor.role === "viewer" || actor.role === null);

  /** Lần tải; silent: giữ bảng đang hiện tới khi có dữ liệu mới (sau lỗi 404 hay dãn hàng xóm lỗi). */
  const [request, setRequest] = useState({ key: 0, silent: false });
  const [loaded, setLoaded] = useState<{ key: number; state: LoadState }>({
    key: -1,
    state: { kind: "loading", loaded: 0 },
  });
  const load: LoadState =
    loaded.key === request.key || request.silent
      ? loaded.state
      : { kind: "loading", loaded: 0 };
  const [data, setData] = useState<BoardData | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  // Bản task mới nhất cho trình xử lý sự kiện (commitMove đọc ngoài vòng render).
  const tasksRef = useRef<Task[]>([]);
  useLayoutEffect(() => {
    tasksRef.current = tasks;
  }, [tasks]);
  const [saving, setSaving] = useState<ReadonlySet<string>>(new Set());
  const [filters, setFilters] = useState<BoardFilters>(EMPTY_FILTERS);
  const [searchResult, setSearchResult] = useState<SearchResult>({
    q: "",
    ids: null,
  });
  const [limits, setLimits] = useState<Record<string, number>>({});
  const [moveTarget, setMoveTarget] = useState<Task | null>(null);

  // ---- Tải dữ liệu ----
  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    const { key, silent } = request;
    (async () => {
      const [statuses, types, labels, members, all] = await Promise.all([
        fetchConfig("statuses", projectId, signal),
        fetchConfig("task-types", projectId, signal),
        fetchConfig("labels", projectId, signal),
        fetchMembers(projectId, signal),
        fetchAllTasks(projectId, {}, signal, (n) => {
          if (!silent)
            setLoaded({ key, state: { kind: "loading", loaded: n } });
        }),
      ]);
      if (signal.aborted) return;
      if (!statuses.ok || !types.ok || !labels.ok || !members.ok || !all.ok) {
        setLoaded({ key, state: { kind: "error" } });
        return;
      }
      setData({
        statuses: [...statuses.data.data].sort(compareConfigItems).map((s) => ({
          id: s.id,
          name: s.name,
          category: s.category,
          color: s.color,
          position: s.position,
        })),
        typeNames: new Map(types.data.data.map((x) => [x.id, x.name])),
        labels: new Map(
          [...labels.data.data]
            .sort(compareConfigItems)
            .map((l) => [l.id, { id: l.id, name: l.name, color: l.color }]),
        ),
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
  }, [projectId, request]);

  const reload = useCallback((silent: boolean) => {
    setRequest((prev) => ({ key: prev.key + 1, silent }));
  }, []);

  // ---- Tìm theo từ khóa (máy chủ, bỏ dấu, E3-3) ----
  const q = filters.q.trim();
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

  const search: SearchState = !q
    ? { kind: "idle" }
    : searchResult.q !== q
      ? { kind: "searching" }
      : searchResult.ids
        ? { kind: "done", ids: searchResult.ids }
        : { kind: "error" };

  // ---- Dữ liệu suy ra ----
  const statuses = useMemo(() => data?.statuses ?? [], [data]);
  const categoryOf = useCallback(
    (statusId: string | null) =>
      statuses.find((s) => s.id === statusId)?.category,
    [statuses],
  );
  const columns = useMemo(
    () => groupByStatus(statuses, tasks),
    [statuses, tasks],
  );
  const subtasks = useMemo(
    () => subtaskCounts(tasks, categoryOf),
    [tasks, categoryOf],
  );
  const today = useMemo(() => todayIso(), []);
  const matchIds = search.kind === "done" ? search.ids : null;
  const filtering = hasActiveFilters(filters);

  /** Id thẻ hiển thị mỗi cột (đã lọc, giới hạn "Hiện thêm"). */
  const visible = useMemo(() => {
    const out: Record<string, string[]> = {};
    const totals: Record<string, number> = {};
    for (const status of statuses) {
      const matched = (columns.get(status.id) ?? []).filter((task) =>
        q && search.kind !== "done"
          ? true
          : matchesFilters(task, filters, matchIds),
      );
      totals[status.id] = matched.length;
      out[status.id] = matched
        .slice(0, limits[status.id] ?? PAGE_SIZE)
        .map((task) => task.id);
    }
    return { ids: out, totals };
  }, [statuses, columns, filters, matchIds, limits, q, search.kind]);

  const taskById = useMemo(() => new Map(tasks.map((x) => [x.id, x])), [tasks]);
  const canMove = useCallback(
    (task: Task) => !readOnly && canMoveTask(actor, task),
    [actor, readOnly],
  );

  // ---- Di chuyển: cập nhật lạc quan, gửi PATCH, hoàn tác khi lỗi ----
  const moveError = useCallback(
    (title: string, error: ApiError) => {
      let description: string;
      if (error.code === "forbidden") description = t.move.forbidden;
      else if (error.code === "business_rule_violated" && "task_ids" in error) {
        description = t.move.openSubtasks;
      } else if (error.code === "not_found") description = t.move.notFound;
      else description = apiErrorText(strings, error);
      toast({
        tone: "error",
        title: t.move.failed(title),
        description,
        duration: 8000,
      });
      if (error.code === "not_found") reload(true);
    },
    [t, strings, toast, reload],
  );

  const commitMove = useCallback(
    async (
      taskId: string,
      toStatus: string,
      visibleIds: readonly string[],
      visibleIndex: number,
      announce: boolean,
    ) => {
      const current = tasksRef.current;
      const task = current.find((x) => x.id === taskId);
      if (!task || !canMove(task)) return;
      const byId = new Map(current.map((x) => [x.id, x]));
      const target = current
        .filter((x) => x.status_id === toStatus)
        .sort(compareCards);
      const full = target.filter((x) => x.id !== taskId);
      const index = fullIndexFor(full, visibleIds, visibleIndex);
      const sameColumn = task.status_id === toStatus;
      if (sameColumn && target.findIndex((x) => x.id === taskId) === index) {
        return; // thả lại đúng chỗ cũ
      }
      const plan = planMove(full, index, task.position, {
        canEdit: (id) => {
          const other = byId.get(id);
          return !!other && canMove(other);
        },
        maxOthers: MAX_SPREAD,
      });

      const before = new Map<string, Task>();
      before.set(task.id, task);
      for (const u of plan.others) {
        const other = byId.get(u.id);
        if (other) before.set(u.id, other);
      }
      const updates = new Map<string, Partial<Task>>([
        [task.id, { status_id: toStatus, position: plan.position }],
        ...plan.others.map((u) => [u.id, { position: u.position }] as const),
      ]);
      setTasks((prev) =>
        prev.map((x) =>
          updates.has(x.id) ? { ...x, ...updates.get(x.id) } : x,
        ),
      );
      setSaving((prev) => new Set([...prev, task.id]));

      const columnName = statuses.find((s) => s.id === toStatus)?.name ?? "";
      try {
        const result = await moveTask(task.id, {
          ...(sameColumn ? {} : { status_id: toStatus }),
          position: plan.position,
        });
        if (!result.ok) {
          // Hoàn tác thẻ (và chưa gửi gì cho hàng xóm).
          setTasks((prev) =>
            prev.map((x) => (before.has(x.id) ? before.get(x.id)! : x)),
          );
          moveError(task.title, result.error);
          return;
        }
        const saved = result.data.data;
        setTasks((prev) => prev.map((x) => (x.id === saved.id ? saved : x)));
        if (!plan.exact) {
          toast({ tone: "warning", title: t.move.approximate });
        } else if (announce) {
          toast({ title: t.move.moved(task.title, columnName) });
        }
        // Dãn hàng xóm (hiếm: chỉ khi position trùng nhau). Lỗi thì tải lại để khớp máy chủ.
        for (const u of plan.others) {
          const other = await moveTask(u.id, { position: u.position });
          if (!other.ok) {
            toast({ tone: "warning", title: t.move.reorderFailed });
            reload(true);
            break;
          }
        }
      } finally {
        setSaving((prev) => {
          const next = new Set(prev);
          next.delete(task.id);
          return next;
        });
      }
    },
    [canMove, statuses, moveError, toast, t, reload],
  );

  const moveToColumn = useCallback(
    (task: Task, statusId: string) => {
      setMoveTarget(null);
      // Cuối cột đích: bám thẻ cuối cùng của cột đầy đủ.
      const ids = tasksRef.current
        .filter((x) => x.status_id === statusId && x.id !== task.id)
        .sort(compareCards)
        .map((x) => x.id);
      void commitMove(task.id, statusId, ids, ids.length, true);
    },
    [commitMove],
  );

  // ---- Kéo thả (@dnd-kit) ----
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 250, tolerance: 8 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  const [dragItems, setDragItems] = useState<Record<string, string[]> | null>(
    null,
  );
  const items = dragItems ?? visible.ids;

  const findColumn = useCallback(
    (id: UniqueIdentifier, source: Record<string, string[]>) => {
      const key = String(id);
      if (key.startsWith(COLUMN_PREFIX)) return key.slice(COLUMN_PREFIX.length);
      return Object.keys(source).find((col) => source[col].includes(key));
    },
    [],
  );

  const onDragStart = useCallback(() => {
    setDragItems(
      Object.fromEntries(
        Object.entries(visible.ids).map(([k, v]) => [k, [...v]]),
      ),
    );
  }, [visible.ids]);

  const onDragOver = useCallback(
    ({ active, over }: DragOverEvent) => {
      if (!over) return;
      setDragItems((prev) => {
        if (!prev) return prev;
        const from = findColumn(active.id, prev);
        const to = findColumn(over.id, prev);
        if (!from || !to || from === to) return prev;
        const id = String(active.id);
        const target = prev[to];
        const overIndex = target.indexOf(String(over.id));
        const at = overIndex >= 0 ? overIndex : target.length;
        return {
          ...prev,
          [from]: prev[from].filter((x) => x !== id),
          [to]: [...target.slice(0, at), id, ...target.slice(at)],
        };
      });
    },
    [findColumn],
  );

  const onDragEnd = useCallback(
    ({ active, over }: DragEndEvent) => {
      const snapshot = dragItems;
      setDragItems(null);
      if (!over || !snapshot) return;
      const id = String(active.id);
      const to = findColumn(over.id, snapshot);
      if (!to) return;
      let list = snapshot[to];
      const from = list.indexOf(id);
      const overIndex = list.indexOf(String(over.id));
      if (from >= 0 && overIndex >= 0 && from !== overIndex) {
        list = arrayMove(list, from, overIndex);
      }
      const index = list.indexOf(id);
      if (index < 0) return;
      void commitMove(
        id,
        to,
        list.filter((x) => x !== id),
        index,
        false,
      );
    },
    [dragItems, findColumn, commitMove],
  );

  const columnName = useCallback(
    (id: UniqueIdentifier | undefined) => {
      if (id === undefined || !dragItems) return undefined;
      const col = findColumn(id, dragItems);
      return statuses.find((s) => s.id === col)?.name;
    },
    [dragItems, findColumn, statuses],
  );
  const titleOf = useCallback(
    (id: UniqueIdentifier) => taskById.get(String(id))?.title ?? "",
    [taskById],
  );
  const positionIn = useCallback(
    (id: UniqueIdentifier | undefined, activeId: UniqueIdentifier) => {
      if (id === undefined || !dragItems) return 0;
      const col = findColumn(id, dragItems);
      return col ? dragItems[col].indexOf(String(activeId)) + 1 : 0;
    },
    [dragItems, findColumn],
  );
  const announcements: Announcements = {
    onDragStart: ({ active }) => t.dnd.start(titleOf(active.id)),
    onDragOver: ({ active, over }) => {
      const name = columnName(over?.id);
      return name
        ? t.dnd.over(titleOf(active.id), name, positionIn(over?.id, active.id))
        : t.dnd.overNone(titleOf(active.id));
    },
    onDragEnd: ({ active, over }) => {
      const name = columnName(over?.id);
      return name
        ? t.dnd.end(titleOf(active.id), name, positionIn(over?.id, active.id))
        : t.dnd.cancel(titleOf(active.id));
    },
    onDragCancel: ({ active }) => t.dnd.cancel(titleOf(active.id)),
  };

  // ---- Giao diện ----
  const header = (
    <ProjectHeader
      projectId={projectId}
      projectName={projectName}
      active="board"
      meta={readOnly ? <Badge tone="neutral">{t.readOnly}</Badge> : null}
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
          className="flex-row gap-3 overflow-hidden px-4 py-5 sm:px-7"
        >
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex w-72 shrink-0 flex-col gap-2">
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-24" />
              <Skeleton className="h-24" />
            </div>
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
              <Button variant="secondary" onClick={() => reload(false)}>
                {t.retry}
              </Button>
            }
          />
        </div>
      </>
    );
  }

  if (statuses.length === 0) {
    return (
      <>
        {header}
        <div className="px-4 py-6 sm:px-7">
          <EmptyState
            title={t.noStatusesTitle}
            description={t.noStatusesBody}
            action={
              <Link href={projectViewHref(projectId, "settings")}>
                {t.openSettings}
              </Link>
            }
          />
        </div>
      </>
    );
  }

  const totalShown = Object.values(visible.totals).reduce((a, b) => a + b, 0);
  const noMatch = filtering && search.kind !== "searching" && totalShown === 0;

  return (
    <>
      {header}
      <div className="flex min-w-0 flex-col gap-4 py-4">
        <Filters
          filters={filters}
          onChange={setFilters}
          members={data.members}
          labels={data.labels}
          search={search}
          resultCount={totalShown}
        />

        <p className="px-4 text-sm text-text-muted sm:px-7">
          {readOnly
            ? t.readOnlyNote
            : actor.isAdmin || actor.role === "pm"
              ? null
              : t.memberNote}
        </p>

        {tasks.length === 0 ? (
          <div className="px-4 sm:px-7">
            <EmptyState
              title={t.emptyTitle}
              description={t.emptyBody}
              headingLevel={2}
            />
          </div>
        ) : noMatch ? (
          <div className="px-4 sm:px-7">
            <EmptyState
              title={t.noMatchTitle}
              description={t.noMatchBody}
              action={
                <Button
                  variant="secondary"
                  onClick={() => setFilters(EMPTY_FILTERS)}
                >
                  {t.clearFilters}
                </Button>
              }
            />
          </div>
        ) : null}

        <ColumnJump statuses={statuses} totals={visible.totals} />

        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={onDragStart}
          onDragOver={onDragOver}
          onDragEnd={onDragEnd}
          onDragCancel={() => setDragItems(null)}
          accessibility={{
            announcements,
            screenReaderInstructions: { draggable: t.dnd.instructions },
          }}
        >
          <div
            role="region"
            aria-label={t.boardLabel}
            // relative: phần tử sr-only (absolute) trong cột phải bị vùng cuộn cắt, không đẩy rộng trang ở 360 px.
            // tabIndex 0: cuộn ngang được bằng phím mũi tên kể cả khi cột không có thẻ (WCAG 2.1.1).
            tabIndex={0}
            className="relative flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pb-6 sm:scroll-px-7 sm:px-7"
          >
            {statuses.map((status, i) => {
              const ids = items[status.id] ?? [];
              const total = visible.totals[status.id] ?? 0;
              const shown = visible.ids[status.id]?.length ?? 0;
              return (
                <Column
                  key={status.id}
                  status={status}
                  index={i}
                  count={total}
                  ids={ids}
                  more={dragItems ? 0 : total - shown}
                  onShowMore={() =>
                    setLimits((prev) => ({
                      ...prev,
                      [status.id]: (prev[status.id] ?? PAGE_SIZE) + PAGE_SIZE,
                    }))
                  }
                >
                  {ids.map((id) => {
                    const task = taskById.get(id);
                    if (!task) return null;
                    const cat = categoryOf(task.status_id);
                    return (
                      <TaskCard
                        key={id}
                        task={task}
                        projectId={projectId}
                        typeName={
                          task.type_id
                            ? (data.typeNames.get(task.type_id) ?? null)
                            : null
                        }
                        labels={task.label_ids
                          .map((l) => data.labels.get(l))
                          .filter((l): l is CardLabel => !!l)}
                        assigneeName={
                          task.assignee_id
                            ? data.members.get(task.assignee_id)
                            : null
                        }
                        subtasks={subtasks.get(task.id)}
                        overdue={isOverdue(task.due_date, cat, today)}
                        canMove={canMove(task)}
                        saving={saving.has(task.id)}
                        onOpenMoveMenu={setMoveTarget}
                      />
                    );
                  })}
                </Column>
              );
            })}
          </div>
        </DndContext>
      </div>
      <MoveDialog
        task={moveTarget}
        columns={statuses}
        onClose={() => setMoveTarget(null)}
        onMove={moveToColumn}
      />
    </>
  );
}

function Column({
  status,
  index,
  count,
  ids,
  more,
  onShowMore,
  children,
}: {
  status: BoardColumnStatus;
  index: number;
  count: number;
  ids: string[];
  more: number;
  onShowMore: () => void;
  children: ReactNode;
}) {
  const strings = useStrings();
  const t = strings.kanban;
  const { setNodeRef, isOver } = useDroppable({
    id: `${COLUMN_PREFIX}${status.id}`,
  });
  const headingId = `kanban-col-${status.id}`;
  return (
    <section
      id={`kanban-column-${status.id}`}
      aria-labelledby={headingId}
      className="flex w-[calc(100vw-2rem)] max-w-80 shrink-0 snap-start flex-col gap-2 sm:w-72"
    >
      <div
        className="flex items-center justify-between gap-2 border-0 border-t-2 border-solid pt-2"
        style={{ borderTopColor: status.color }}
      >
        <h2
          id={headingId}
          className="m-0 flex min-w-0 items-center gap-2 font-mono text-label uppercase"
        >
          <span aria-hidden="true" className="text-text-muted">
            {String(index + 1).padStart(2, "0")} /
          </span>
          <span className="[overflow-wrap:anywhere]">{status.name}</span>
        </h2>
        <span className="font-mono text-label text-text-muted">
          <span aria-hidden="true">{String(count).padStart(2, "0")}</span>
          <span className="sr-only">{t.columnCount(count)}</span>
        </span>
      </div>
      <SortableContext
        id={status.id}
        items={ids}
        strategy={verticalListSortingStrategy}
      >
        <ol
          ref={setNodeRef}
          aria-labelledby={headingId}
          className={`m-0 flex min-h-24 list-none flex-col gap-2 rounded-md p-1 ${isOver ? "bg-bg-muted" : "bg-bg-subtle"}`}
        >
          {children}
          {ids.length === 0 ? (
            <li className="px-2 py-6 text-center text-xs text-text-muted">
              {t.columnEmpty}
            </li>
          ) : null}
        </ol>
      </SortableContext>
      {more > 0 ? (
        <Button variant="text" onClick={onShowMore}>
          {t.showMore(Math.min(more, PAGE_SIZE))}
        </Button>
      ) : null}
    </section>
  );
}

/** Dải chip chọn cột trên điện thoại (S09): bấm để cuộn tới cột, không cần vuốt ngang. */
function ColumnJump({
  statuses,
  totals,
}: {
  statuses: readonly BoardColumnStatus[];
  totals: Record<string, number>;
}) {
  const strings = useStrings();
  return (
    <nav aria-label={strings.kanban.chooseColumn} className="sm:hidden">
      <ul className="relative m-0 flex list-none gap-2 overflow-x-auto p-0">
        {statuses.map((status) => (
          <li key={status.id} className="shrink-0 first:pl-4 last:pr-4">
            <a
              href={`#kanban-column-${status.id}`}
              onClick={(event) => {
                event.preventDefault();
                document
                  .getElementById(`kanban-column-${status.id}`)
                  ?.scrollIntoView({
                    behavior: "smooth",
                    inline: "start",
                    block: "nearest",
                  });
              }}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-pill border border-solid border-border px-3 text-sm text-text no-underline"
            >
              <span
                aria-hidden="true"
                className="size-2 rounded-pill"
                style={{ backgroundColor: status.color }}
              />
              {status.name}
              <span className="font-mono text-label text-text-muted">
                {totals[status.id] ?? 0}
              </span>
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function Filters({
  filters,
  onChange,
  members,
  labels,
  search,
  resultCount,
}: {
  filters: BoardFilters;
  onChange: (next: BoardFilters) => void;
  members: Map<string, string>;
  labels: Map<string, CardLabel>;
  search: SearchState;
  resultCount: number;
}) {
  const strings = useStrings();
  const t = strings.kanban.filters;
  const set = (patch: Partial<BoardFilters>) =>
    onChange({ ...filters, ...patch });
  const memberOptions = [...members.entries()]
    .sort((a, b) => a[1].localeCompare(b[1], "vi"))
    .map(([value, label]) => ({ value, label }));
  return (
    <div
      role="search"
      aria-label={t.label}
      className="grid grid-cols-1 gap-3 px-4 sm:grid-cols-2 sm:px-7 lg:grid-cols-4"
    >
      <Field label={t.assignee}>
        {(control) => (
          <Select
            {...control}
            value={filters.assignee}
            onChange={(e) => set({ assignee: e.target.value })}
            options={[
              { value: "", label: t.assigneeAll },
              { value: UNASSIGNED, label: t.unassigned },
              ...memberOptions,
            ]}
          />
        )}
      </Field>
      <Field label={t.priority}>
        {(control) => (
          <Select
            {...control}
            value={filters.priority}
            onChange={(e) =>
              set({ priority: e.target.value as TaskPriority | "" })
            }
            options={[
              { value: "", label: t.priorityAll },
              ...TASK_PRIORITIES.map((p) => ({
                value: p,
                label: strings.ui.priority[p],
              })),
            ]}
          />
        )}
      </Field>
      <Field label={t.labelFilter}>
        {(control) => (
          <Select
            {...control}
            value={filters.label}
            onChange={(e) => set({ label: e.target.value })}
            options={[
              { value: "", label: t.labelAll },
              ...[...labels.values()].map((l) => ({
                value: l.id,
                label: l.name,
              })),
            ]}
          />
        )}
      </Field>
      <Field
        label={t.search}
        hint={
          search.kind === "searching"
            ? t.searching
            : search.kind === "error"
              ? t.searchError
              : search.kind === "done"
                ? t.resultCount(resultCount)
                : undefined
        }
      >
        {(control) => (
          <Input
            {...control}
            type="search"
            value={filters.q}
            placeholder={t.searchPlaceholder}
            maxLength={200}
            onChange={(e) => set({ q: e.target.value })}
          />
        )}
      </Field>
    </div>
  );
}
