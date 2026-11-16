"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import Link from "next/link";
import { Avatar } from "@/components/ui/avatar";
import { Badge, PriorityBadge } from "@/components/ui/badge";
import { ClockIcon, SpinnerIcon } from "@/components/ui/icons";
import { cn } from "@/lib/cn";
import { formatCalendarDate } from "@/lib/i18n/format";
import { useLocale, useStrings } from "@/lib/i18n/client";
import type { SubtaskCount } from "@/lib/kanban/board";
import type { Task } from "@/lib/tasks/model";

export interface CardLabel {
  id: string;
  name: string;
  color: string;
}

export interface TaskCardProps {
  task: Task;
  projectId: string;
  typeName: string | null;
  labels: readonly CardLabel[];
  /** Tên người phụ trách; undefined = không còn trong dự án (đã bị gỡ). */
  assigneeName: string | null | undefined;
  subtasks: SubtaskCount | undefined;
  overdue: boolean;
  /** Người dùng kéo/chuyển được thẻ này (vai trò, BR-03). Không: không có tay nắm, không có menu. */
  canMove: boolean;
  saving: boolean;
  /** Mở hộp thoại "Chuyển đến cột". */
  onOpenMoveMenu: (task: Task) => void;
}

/** Biểu tượng tay nắm kéo (6 chấm), trang trí. */
function GripIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
      className="size-4"
    >
      {[4, 8, 12].map((y) => (
        <g key={y}>
          <circle cx="6" cy={y} r="1.2" />
          <circle cx="10" cy={y} r="1.2" />
        </g>
      ))}
    </svg>
  );
}

/** Biểu tượng "⋯" của menu chuyển cột, trang trí. */
function MoreIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
      className="size-4"
    >
      <circle cx="3.5" cy="8" r="1.4" />
      <circle cx="8" cy="8" r="1.4" />
      <circle cx="12.5" cy="8" r="1.4" />
    </svg>
  );
}

const iconButton =
  "inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-text-muted hover:bg-bg-muted hover:text-text sm:size-8";

/**
 * Thẻ task trên bảng Kanban (mockup v3 bp-Kanban.dc.html): ưu tiên, tiêu đề (liên kết tới chi tiết
 * task), loại, nhãn, hạn hoặc trễ hạn, số việc con, người phụ trách. Kéo bằng tay nắm (chuột, chạm
 * giữ, hoặc bàn phím Space + mũi tên); menu "Chuyển đến cột" là lối thay thế không cần kéo (AC2).
 */
export function TaskCard({
  task,
  projectId,
  typeName,
  labels,
  assigneeName,
  subtasks,
  overdue,
  canMove,
  saving,
  onOpenMoveMenu,
}: TaskCardProps) {
  const strings = useStrings();
  const locale = useLocale();
  const t = strings.kanban.card;
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id, disabled: !canMove });

  const due = formatCalendarDate(task.due_date, locale);
  const href = `/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(task.id)}`;
  const who =
    assigneeName === null
      ? null
      : assigneeName === undefined
        ? t.formerMember
        : assigneeName;

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      data-task-id={task.id}
      aria-busy={saving || undefined}
      className={cn(
        "relative flex flex-col gap-2 rounded-md border border-solid bg-bg p-3 text-sm",
        isDragging ? "z-10 border-primary shadow-pop" : "border-border",
      )}
    >
      <div className="flex items-start justify-between gap-1">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5 pt-1">
          <PriorityBadge priority={task.priority} />
          {typeName ? (
            <span className="font-mono text-label text-text-muted uppercase [overflow-wrap:anywhere]">
              {typeName}
            </span>
          ) : null}
        </div>
        {canMove ? (
          <div className="-mt-1 -mr-1 flex shrink-0">
            <button
              type="button"
              ref={setActivatorNodeRef}
              {...attributes}
              {...listeners}
              aria-label={t.dragHandle(task.title)}
              className={cn(iconButton, "cursor-grab touch-none")}
            >
              <GripIcon />
            </button>
            <button
              type="button"
              aria-label={t.moveMenu(task.title)}
              aria-haspopup="dialog"
              onClick={() => onOpenMoveMenu(task)}
              className={iconButton}
            >
              <MoreIcon />
            </button>
          </div>
        ) : null}
      </div>

      <Link
        href={href}
        className="font-medium text-text no-underline [overflow-wrap:anywhere] hover:text-primary hover:underline"
      >
        {task.title}
      </Link>

      {labels.length > 0 ? (
        <ul
          aria-label={t.labels}
          className="m-0 flex list-none flex-wrap gap-1.5 p-0"
        >
          {labels.map((label) => (
            <li key={label.id}>
              <Badge
                icon={
                  <span
                    className="block size-1.5 rounded-pill"
                    style={{ backgroundColor: label.color }}
                  />
                }
              >
                {label.name}
              </Badge>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-text-muted">
        {due ? (
          overdue ? (
            <span className="inline-flex items-center gap-1 font-semibold text-danger">
              <ClockIcon className="size-3" />
              <span className="sr-only">{t.overdueLabel}: </span>
              {t.overdue(due)}
            </span>
          ) : (
            <span>{t.due(due)}</span>
          )
        ) : (
          <span />
        )}
        <span className="inline-flex items-center gap-2">
          {saving ? (
            <span className="inline-flex items-center gap-1">
              <SpinnerIcon className="size-3" />
              {t.saving}
            </span>
          ) : null}
          {subtasks && subtasks.total > 0 ? (
            <span
              className="font-mono"
              title={t.subtasks(subtasks.done, subtasks.total)}
            >
              <span aria-hidden="true">
                {subtasks.done}/{subtasks.total}
              </span>
              <span className="sr-only">
                {t.subtasks(subtasks.done, subtasks.total)}
              </span>
            </span>
          ) : null}
          {who ? (
            <span title={t.assignee(who)} className="inline-flex">
              <Avatar name={who} size="sm" />
            </span>
          ) : (
            <span>{t.unassigned}</span>
          )}
        </span>
      </div>
    </li>
  );
}
