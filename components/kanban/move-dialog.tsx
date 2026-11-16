"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { CheckIcon } from "@/components/ui/icons";
import { useStrings } from "@/lib/i18n/client";
import type { BoardColumnStatus } from "@/lib/kanban/board";
import type { Task } from "@/lib/tasks/model";

/**
 * Hộp thoại "Chuyển đến cột" (AC2, S09): thay kéo thả trên điện thoại và bằng bàn phím. Radix
 * Dialog giữ focus trong hộp, Esc đóng, trả focus về nút mở; mỗi cột là một nút cao 44 px. Task
 * được đặt ở cuối cột đích.
 */
export function MoveDialog({
  task,
  columns,
  onClose,
  onMove,
}: {
  task: Task | null;
  columns: readonly BoardColumnStatus[];
  onClose: () => void;
  onMove: (task: Task, statusId: string) => void;
}) {
  const strings = useStrings();
  const t = strings.kanban.move;
  return (
    <Dialog open={task !== null} onOpenChange={(open) => !open && onClose()}>
      {task ? (
        <DialogContent>
          <DialogTitle>{t.title}</DialogTitle>
          <DialogDescription>{t.description(task.title)}</DialogDescription>
          <ul
            aria-label={t.listLabel}
            className="m-0 flex list-none flex-col gap-1.5 p-0"
          >
            {columns.map((column) => {
              const current = column.id === task.status_id;
              return (
                <li key={column.id}>
                  <button
                    type="button"
                    disabled={current}
                    aria-current={current ? "true" : undefined}
                    onClick={() => onMove(task, column.id)}
                    className="flex min-h-11 w-full cursor-pointer items-center gap-2.5 rounded-md border border-solid border-border bg-bg px-3 text-left font-sans text-sm text-text hover:bg-bg-muted disabled:cursor-default disabled:bg-bg-subtle disabled:text-text-muted"
                  >
                    <span
                      aria-hidden="true"
                      className="size-2.5 shrink-0 rounded-pill"
                      style={{ backgroundColor: column.color }}
                    />
                    <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
                      {column.name}
                    </span>
                    {current ? (
                      <span className="inline-flex items-center gap-1 text-xs">
                        <CheckIcon className="size-3" />
                        {t.current}
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </DialogContent>
      ) : null}
    </Dialog>
  );
}
