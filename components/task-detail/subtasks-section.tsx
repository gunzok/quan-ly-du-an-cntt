"use client";

import Link from "next/link";
import { useId, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { CheckIcon, CircleIcon, ErrorIcon } from "@/components/ui/icons";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import type { TaskStatus } from "@/lib/project-config/model";
import { createSubtask } from "@/lib/tasks/client-api";
import { TASK_MAX_DEPTH, type TaskDetail } from "@/lib/tasks/detail";
import { subtaskProgress } from "@/lib/tasks/detail-view";
import { TITLE_MAX_LENGTH } from "@/lib/tasks/validate";
import { apiErrorText } from "@/lib/i18n/api-error";
import { useStrings } from "@/lib/i18n/client";

/**
 * Việc con (mockup bp-TaskDetail mục 02): tiến độ, cây việc con (thụt lề theo cấp, tối đa 3 cấp),
 * mỗi dòng là link tới chi tiết việc con. Thêm nhanh việc con trực tiếp khi có quyền; task đã ở
 * cấp 3 thì giải thích thay vì hiện ô thêm. Máy chủ vẫn kiểm cấp, quyền, BR-04 và trả lỗi dễ hiểu.
 */
export function SubtasksSection({
  number,
  task,
  statuses,
  onAdded,
}: {
  number: string;
  task: TaskDetail;
  statuses: TaskStatus[];
  onAdded: () => void;
}) {
  const strings = useStrings();
  const t = strings.taskDetail.subtasks;
  const { toast } = useToast();
  const headingId = useId();
  const inputId = useId();
  const errorId = useId();
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const { done, total } = subtaskProgress(task.subtasks);
  const statusName = (id: string | null) =>
    statuses.find((s) => s.id === id)?.name ?? strings.taskDetail.unknown;

  async function submit(event: FormEvent) {
    event.preventDefault();
    const value = title.trim();
    if (value === "") return setError(t.required);
    if (value.length > TITLE_MAX_LENGTH) {
      return setError(strings.taskDetail.title.tooLong);
    }
    setPending(true);
    const result = await createSubtask(task.project_id, task.id, value);
    setPending(false);
    if (!result.ok) {
      setError(apiErrorText(strings, result.error));
      return;
    }
    setTitle("");
    setError(null);
    toast({ title: t.added(value) });
    onAdded();
  }

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2">
      <h2 id={headingId} className="label m-0 flex items-center gap-2">
        <span
          aria-hidden="true"
          className="inline-block size-1.5 rounded-pill bg-accent"
        />
        {number} / {t.heading}
        {total > 0 ? ` · ${done}/${total}` : null}
      </h2>
      {task.parent ? (
        <p className="m-0 text-sm">
          <span className="text-text-muted">{t.parent}: </span>
          <Link
            href={`/projects/${task.project_id}/tasks/${task.parent.id}`}
            className="inline-flex min-h-11 items-center [overflow-wrap:anywhere] sm:min-h-0"
          >
            {task.parent.title}
          </Link>
        </p>
      ) : null}
      {total > 0 ? (
        <>
          <div
            role="progressbar"
            aria-valuenow={Math.round((done / total) * 100)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={t.progressLabel(done, total)}
            className="h-1 rounded-sm bg-bg-muted"
          >
            <div
              className="h-1 rounded-sm bg-success"
              style={{ width: `${(done / total) * 100}%` }}
            />
          </div>
          <ul aria-label={t.listLabel} className="m-0 flex list-none flex-col p-0">
            {task.subtasks.map((s) => {
              const isDone = s.completed_at !== null;
              return (
                <li
                  key={s.id}
                  data-subtask={s.id}
                  className="flex min-h-11 items-center gap-2.5 text-sm sm:min-h-8"
                  style={{ paddingLeft: `${(s.depth - task.depth - 1) * 24}px` }}
                >
                  <span
                    aria-hidden="true"
                    className={
                      isDone
                        ? "inline-flex text-success"
                        : "inline-flex text-text-muted"
                    }
                  >
                    {isDone ? (
                      <CheckIcon className="size-4" />
                    ) : (
                      <CircleIcon className="size-4" />
                    )}
                  </span>
                  <Link
                    href={`/projects/${task.project_id}/tasks/${s.id}`}
                    className={
                      isDone
                        ? "inline-flex min-h-11 min-w-0 flex-1 items-center text-text-muted line-through [overflow-wrap:anywhere] sm:min-h-0"
                        : "inline-flex min-h-11 min-w-0 flex-1 items-center [overflow-wrap:anywhere] sm:min-h-0"
                    }
                  >
                    {s.title}
                    {isDone ? (
                      <span className="sr-only"> ({t.doneMark})</span>
                    ) : null}
                  </Link>
                  <span className="shrink-0 text-xs text-text-muted">
                    {statusName(s.status_id)}
                  </span>
                </li>
              );
            })}
          </ul>
          {task.subtasks_truncated ? (
            <p className="m-0 text-xs text-text-muted">{t.truncated}</p>
          ) : null}
        </>
      ) : (
        <p className="m-0 text-sm text-text-muted">{t.empty}</p>
      )}
      {task.permissions.can_add_subtask ? (
        <form
          onSubmit={submit}
          noValidate
          className="flex flex-col gap-1.5"
        >
          <label htmlFor={inputId} className="sr-only">
            {t.addLabel}
          </label>
          <div className="flex flex-wrap gap-2">
            <div className="min-w-0 flex-1 basis-48">
              <Input
                id={inputId}
                value={title}
                placeholder={t.addLabel}
                aria-describedby={error ? errorId : undefined}
                aria-invalid={error ? true : undefined}
                onChange={(e) => {
                  setTitle(e.target.value);
                  setError(null);
                }}
              />
            </div>
            <Button type="submit" variant="secondary" loading={pending}>
              + {t.add}
            </Button>
          </div>
          {error ? (
            <p
              id={errorId}
              role="alert"
              className="flex items-center gap-1.5 text-xs text-danger"
            >
              <ErrorIcon className="size-3.5 shrink-0" />
              {error}
            </p>
          ) : null}
        </form>
      ) : task.permissions.can_edit && task.depth >= TASK_MAX_DEPTH ? (
        <p className="m-0 text-xs text-text-muted">{t.maxDepth}</p>
      ) : null}
    </section>
  );
}
