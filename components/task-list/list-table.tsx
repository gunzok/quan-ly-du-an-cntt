"use client";

import Link from "next/link";
import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Avatar } from "@/components/ui/avatar";
import { PriorityBadge } from "@/components/ui/badge";
import { cn } from "@/lib/cn";
import { formatCalendarDate, formatDateInZone } from "@/lib/i18n/format";
import { useLocale, useStrings } from "@/lib/i18n/client";
import { isOverdue } from "@/lib/kanban/board";
import type { StatusCategory } from "@/lib/project-config/model";
import type {
  SavedViewSort,
  ViewColumn,
  ViewGroupBy,
} from "@/lib/saved-views/model";
import { SORTABLE_COLUMNS } from "@/lib/task-list/model";
import { NONE_GROUP, type ListRow, type TaskRow } from "@/lib/task-list/tree";
import { BlockedBadge } from "@/components/kanban/blocked-badge";
import type { Task } from "@/lib/tasks/model";

/** Chiều cao cố định một hàng (px): đủ vùng bấm 44 px, cho phép chỉ dựng hàng trong khung nhìn. */
export const ROW_HEIGHT = 44;
/** Từ số hàng này trở lên mới ảo hóa (ít hàng thì dựng hết: đơn giản, tìm trong trang được). */
export const VIRTUALIZE_FROM = 200;
const OVERSCAN = 12;
const INDENT_PX = 20;

export interface ListLookups {
  statuses: ReadonlyMap<
    string,
    { name: string; color: string; category: StatusCategory }
  >;
  typeNames: ReadonlyMap<string, string>;
  labels: ReadonlyMap<string, { name: string; color: string }>;
  members: ReadonlyMap<string, string>;
  /** Tiêu đề task theo id (cột Task cha). */
  titles: ReadonlyMap<string, string>;
}

export interface ListTableProps {
  projectId: string;
  rows: readonly ListRow[];
  columns: readonly ViewColumn[];
  sort: readonly SavedViewSort[];
  groupBy: ViewGroupBy | null;
  lookups: ListLookups;
  today: string;
  onSort: (column: ViewColumn) => void;
  onToggleTask: (taskId: string) => void;
  onToggleGroup: (value: string) => void;
}

/**
 * Bảng task phân cấp (mockup v3 bp-List.dc.html, bp-ListViews.dc.html). Thẻ <table> thật trong vùng
 * cuộn riêng (ngang và dọc) nên 360 px không tràn trang; đầu bảng dính trên. Hàng cha có nút thu
 * gọn/mở rộng (aria-expanded); hàng nhóm là <th scope="colgroup"> có nút thu gọn. Nhiều hàng thì
 * chỉ dựng phần trong khung nhìn (aria-rowcount, aria-rowindex giữ đúng số thứ tự cho trình đọc).
 */
export function ListTable(props: ListTableProps) {
  const strings = useStrings();
  const t = strings.taskList;
  const { rows, columns } = props;
  const scrollRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLTableSectionElement>(null);
  const virtual = rows.length >= VIRTUALIZE_FROM;
  const [range, setRange] = useState({ start: 0, end: VIRTUALIZE_FROM });

  const measure = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const head = headRef.current?.offsetHeight ?? ROW_HEIGHT;
    const top = Math.max(0, el.scrollTop - head);
    const first = Math.floor(top / ROW_HEIGHT);
    const visible = Math.ceil(el.clientHeight / ROW_HEIGHT);
    const start = Math.max(0, first - OVERSCAN);
    const end = first + visible + OVERSCAN;
    setRange((prev) =>
      prev.start === start && prev.end === end ? prev : { start, end },
    );
  }, []);

  useEffect(() => {
    if (!virtual) return;
    const el = scrollRef.current;
    if (!el) return;
    measure();
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    const observer = new ResizeObserver(onScroll);
    observer.observe(el);
    return () => {
      cancelAnimationFrame(frame);
      el.removeEventListener("scroll", onScroll);
      observer.disconnect();
    };
  }, [virtual, measure]);

  const start = virtual ? Math.min(range.start, rows.length) : 0;
  const end = virtual ? Math.min(range.end, rows.length) : rows.length;
  const slice = rows.slice(start, end);

  return (
    <div
      ref={scrollRef}
      role="region"
      aria-label={t.tableLabel}
      // tabIndex 0: cuộn bằng phím mũi tên khi không có phần tử nào để focus (WCAG 2.1.1).
      tabIndex={0}
      data-testid="task-list-scroll"
      className="relative max-h-[calc(100dvh-12rem)] min-h-48 overflow-auto rounded-lg border border-solid border-border"
    >
      <table
        aria-label={t.tableLabel}
        aria-rowcount={rows.length + 1}
        className="w-full min-w-max border-collapse text-sm"
      >
        <thead ref={headRef} className="sticky top-0 z-10 bg-bg-subtle">
          <tr aria-rowindex={1}>
            {columns.map((c) => (
              <HeaderCell
                key={c}
                column={c}
                sort={props.sort}
                onSort={props.onSort}
              />
            ))}
          </tr>
        </thead>
        <tbody>
          {start > 0 ? (
            <tr aria-hidden="true" style={{ height: start * ROW_HEIGHT }} />
          ) : null}
          {slice.map((row, i) =>
            row.kind === "group" ? (
              <GroupRowView
                key={row.key}
                rowIndex={start + i + 2}
                value={row.value}
                count={row.count}
                collapsed={row.collapsed}
                colSpan={columns.length}
                groupBy={props.groupBy!}
                lookups={props.lookups}
                onToggle={props.onToggleGroup}
              />
            ) : (
              <TaskRowView
                key={row.key}
                row={row}
                rowIndex={start + i + 2}
                projectId={props.projectId}
                columns={columns}
                lookups={props.lookups}
                today={props.today}
                onToggle={props.onToggleTask}
              />
            ),
          )}
          {end < rows.length ? (
            <tr
              aria-hidden="true"
              style={{ height: (rows.length - end) * ROW_HEIGHT }}
            />
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

function HeaderCell({
  column,
  sort,
  onSort,
}: {
  column: ViewColumn;
  sort: readonly SavedViewSort[];
  onSort: (column: ViewColumn) => void;
}) {
  const strings = useStrings();
  const t = strings.taskList;
  const label = t.columns[column];
  const field = SORTABLE_COLUMNS[column];
  const active = field && sort[0]?.field === field ? sort[0] : null;
  const cls =
    "h-11 border-0 border-b border-solid border-border px-3 text-left font-mono text-label font-medium uppercase text-text-muted whitespace-nowrap";
  if (!field) {
    return (
      <th scope="col" className={cls}>
        {label}
      </th>
    );
  }
  return (
    <th
      scope="col"
      aria-sort={
        active
          ? active.direction === "asc"
            ? "ascending"
            : "descending"
          : undefined
      }
      className={cn(cls, "p-0")}
    >
      <button
        type="button"
        onClick={() => onSort(column)}
        className="inline-flex min-h-11 w-full cursor-pointer items-center gap-1 border-0 bg-transparent px-3 text-left font-mono text-label font-medium uppercase text-text-muted hover:text-text"
      >
        {label}
        <span className="sr-only">{t.sort.by(label)}</span>
        <span aria-hidden="true" className={active ? "text-primary" : ""}>
          {active ? (active.direction === "asc" ? "↑" : "↓") : "↕"}
        </span>
      </button>
    </th>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      focusable="false"
      className={cn("size-4 transition-transform", open ? "rotate-90" : "")}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
    >
      <path d="M6 3.5 10.5 8 6 12.5" />
    </svg>
  );
}

const toggleClass =
  "inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-text-muted hover:bg-bg-muted hover:text-text sm:size-8";

const GroupRowView = memo(function GroupRowView({
  rowIndex,
  value,
  count,
  collapsed,
  colSpan,
  groupBy,
  lookups,
  onToggle,
}: {
  rowIndex: number;
  value: string;
  count: number;
  collapsed: boolean;
  colSpan: number;
  groupBy: ViewGroupBy;
  lookups: ListLookups;
  onToggle: (value: string) => void;
}) {
  const strings = useStrings();
  const t = strings.taskList;
  const name = groupName(groupBy, value, lookups, strings);
  const color =
    groupBy === "status_id"
      ? lookups.statuses.get(value)?.color
      : groupBy === "label_ids"
        ? lookups.labels.get(value)?.color
        : undefined;
  return (
    <tr
      aria-rowindex={rowIndex}
      style={{ height: ROW_HEIGHT }}
      className="bg-bg-muted"
      data-testid="task-list-group"
    >
      <th
        scope="colgroup"
        colSpan={colSpan}
        className="border-0 border-b border-solid border-border px-1 text-left font-medium"
      >
        <button
          type="button"
          aria-expanded={!collapsed}
          onClick={() => onToggle(value)}
          className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-md border-0 bg-transparent px-2 text-sm text-text hover:bg-bg-subtle sm:min-h-8"
        >
          <ChevronIcon open={!collapsed} />
          {color ? (
            <span
              aria-hidden="true"
              className="size-2 shrink-0 rounded-pill"
              style={{ backgroundColor: color }}
            />
          ) : null}
          <span>{name}</span>
          <span
            aria-hidden="true"
            className="font-mono text-label text-text-muted"
          >
            {String(count).padStart(2, "0")}
          </span>
          <span className="sr-only">{t.groupCount(count)}</span>
        </button>
      </th>
    </tr>
  );
});

type Strings = ReturnType<typeof useStrings>;

function groupName(
  groupBy: ViewGroupBy,
  value: string,
  lookups: ListLookups,
  strings: Strings,
): string {
  const t = strings.taskList;
  if (value === NONE_GROUP) return t.groupNone[groupBy];
  switch (groupBy) {
    case "status_id":
      return lookups.statuses.get(value)?.name ?? t.groupNone.status_id;
    case "type_id":
      return lookups.typeNames.get(value) ?? t.groupNone.type_id;
    case "label_ids":
      return lookups.labels.get(value)?.name ?? t.groupNone.label_ids;
    case "assignee_id":
      return lookups.members.get(value) ?? t.row.formerMember;
    case "priority":
      return strings.ui.priority[value as Task["priority"]];
  }
}

const TaskRowView = memo(function TaskRowView({
  row,
  rowIndex,
  projectId,
  columns,
  lookups,
  today,
  onToggle,
}: {
  row: TaskRow;
  rowIndex: number;
  projectId: string;
  columns: readonly ViewColumn[];
  lookups: ListLookups;
  today: string;
  onToggle: (taskId: string) => void;
}) {
  return (
    <tr
      aria-rowindex={rowIndex}
      style={{ height: ROW_HEIGHT }}
      data-testid="task-list-row"
      data-task-id={row.task.id}
      data-level={row.level}
      className={cn(
        "border-0 border-b border-solid border-border hover:bg-bg-subtle",
        row.context ? "text-text-muted" : "",
      )}
    >
      {columns.map((c) => (
        <td key={c} className="px-3 py-0 whitespace-nowrap">
          {c === "title" ? (
            <TitleCell row={row} projectId={projectId} onToggle={onToggle} />
          ) : (
            <Cell column={c} task={row.task} lookups={lookups} today={today} />
          )}
        </td>
      ))}
    </tr>
  );
});

function TitleCell({
  row,
  projectId,
  onToggle,
}: {
  row: TaskRow;
  projectId: string;
  onToggle: (taskId: string) => void;
}) {
  const strings = useStrings();
  const t = strings.taskList;
  const { task, level, childCount, expanded } = row;
  return (
    <div
      className="flex min-w-64 items-center gap-1"
      style={{ paddingLeft: (level - 1) * INDENT_PX }}
    >
      {childCount > 0 ? (
        <button
          type="button"
          aria-expanded={expanded}
          aria-label={
            expanded
              ? t.row.collapse(task.title, childCount)
              : t.row.expand(task.title, childCount)
          }
          onClick={() => onToggle(task.id)}
          className={toggleClass}
        >
          <ChevronIcon open={expanded} />
        </button>
      ) : (
        <span aria-hidden="true" className="size-11 shrink-0 sm:size-8" />
      )}
      <Link
        href={`/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(task.id)}`}
        className={cn(
          "inline-flex min-h-11 max-w-[28rem] items-center truncate sm:min-h-0",
          level === 1 ? "font-medium" : "",
          row.context ? "text-text-muted" : "",
        )}
      >
        <span className="truncate">{task.title}</span>
        <span className="sr-only">
          {" · "}
          {t.row.level(level)}
          {row.context ? ` · ${t.contextHint}` : ""}
        </span>
      </Link>
      {task.blocked ? (
        <BlockedBadge
          count={task.blocked_by_count ?? task.blocked_by?.length ?? 0}
        />
      ) : null}
      {childCount > 0 ? (
        <span
          aria-hidden="true"
          className="font-mono text-label text-text-muted"
        >
          {childCount}
        </span>
      ) : null}
    </div>
  );
}

function PersonCell({
  userId,
  lookups,
}: {
  userId: string | null;
  lookups: ListLookups;
}): ReactNode {
  const t = useStrings().taskList.row;
  if (!userId) return <span className="text-text-muted">{t.unassigned}</span>;
  const name = lookups.members.get(userId);
  if (!name) return <span className="text-text-muted">{t.formerMember}</span>;
  return (
    <span className="inline-flex items-center gap-2">
      <Avatar name={name} size="sm" />
      {name}
    </span>
  );
}

function Cell({
  column,
  task,
  lookups,
  today,
}: {
  column: Exclude<ViewColumn, "title">;
  task: Task;
  lookups: ListLookups;
  today: string;
}): ReactNode {
  const strings = useStrings();
  const locale = useLocale();
  const t = strings.taskList.row;
  const none = <span className="text-text-muted">{t.none}</span>;
  switch (column) {
    case "status_id": {
      const s = task.status_id ? lookups.statuses.get(task.status_id) : null;
      if (!s) return none;
      return (
        <span className="inline-flex items-center gap-2">
          <span
            aria-hidden="true"
            className="size-2 shrink-0 rounded-pill"
            style={{ backgroundColor: s.color }}
          />
          {s.name}
        </span>
      );
    }
    case "type_id":
      return task.type_id
        ? (lookups.typeNames.get(task.type_id) ?? none)
        : none;
    case "priority":
      return <PriorityBadge priority={task.priority} />;
    case "assignee_id":
      return <PersonCell userId={task.assignee_id} lookups={lookups} />;
    case "created_by":
      return <PersonCell userId={task.created_by} lookups={lookups} />;
    case "start_date":
      return formatCalendarDate(task.start_date, locale) ?? none;
    case "due_date": {
      const date = formatCalendarDate(task.due_date, locale);
      if (!date) return none;
      const category = task.status_id
        ? lookups.statuses.get(task.status_id)?.category
        : undefined;
      return isOverdue(task.due_date, category, today) ? (
        <span className="font-semibold text-danger">{t.overdue(date)}</span>
      ) : (
        date
      );
    }
    case "label_ids": {
      const labels = task.label_ids
        .map((id) => lookups.labels.get(id))
        .filter((l): l is { name: string; color: string } => !!l);
      if (labels.length === 0) return none;
      return (
        <span className="inline-flex max-w-64 gap-1 overflow-hidden">
          {labels.map((l) => (
            <span
              key={l.name}
              className="inline-flex items-center gap-1 rounded-pill border border-solid border-border px-2 text-xs"
            >
              <span
                aria-hidden="true"
                className="size-1.5 shrink-0 rounded-pill"
                style={{ backgroundColor: l.color }}
              />
              {l.name}
            </span>
          ))}
        </span>
      );
    }
    case "parent_id":
      return task.parent_id ? (
        <span className="inline-block max-w-56 truncate align-middle">
          {lookups.titles.get(task.parent_id) ?? t.none}
        </span>
      ) : (
        none
      );
    case "created_at":
    case "updated_at":
    case "completed_at": {
      const v = task[column];
      return v ? formatDateInZone(new Date(v), locale) : none;
    }
  }
}
