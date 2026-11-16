"use client";

import { useId, useState, type ReactNode } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Badge, PriorityBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ErrorIcon } from "@/components/ui/icons";
import { Input } from "@/components/ui/input";
import { Select, type SelectProps } from "@/components/ui/select";
import type { Label, TaskStatus, TaskType } from "@/lib/project-config/model";
import type { TaskDetail } from "@/lib/tasks/detail";
import {
  canEditField,
  isOverdue,
  todayIso,
  type AssigneeOption,
  type DetailField,
} from "@/lib/tasks/detail-view";
import { TASK_PRIORITIES, type TaskPriority } from "@/lib/tasks/model";
import type { TaskPatch } from "@/lib/tasks/validate";
import { formatCalendarDate } from "@/lib/i18n/format";
import { useLocale, useStrings } from "@/lib/i18n/client";

export interface PropertiesProps {
  task: TaskDetail;
  statuses: TaskStatus[];
  types: TaskType[];
  labels: Label[];
  assignees: AssigneeOption[];
  fieldErrors: Partial<Record<DetailField, string>>;
  /** Tăng khi một lần lưu lỗi: các ô nhập remount về giá trị đã lưu. */
  resetKey: number;
  /** Trường đang lưu (ô đó hiện aria-busy). */
  savingField: DetailField | null;
  save: (field: DetailField, patch: TaskPatch) => Promise<boolean>;
}

/**
 * Bảng thuộc tính task (mockup bp-TaskDetail: hàng nhãn mono bên trái, giá trị bên phải). Sửa được
 * thì mỗi hàng là một ô chọn/nhập lưu ngay khi đổi (ngày: khi rời ô); không sửa được thì chỉ hiện
 * giá trị. `<dl>`: nhãn là `<dt>` (chứa `<label>` khi sửa được), giá trị là `<dd>`.
 */
export function Properties(props: PropertiesProps) {
  const { task, statuses, types, assignees, fieldErrors, save } = props;
  const strings = useStrings();
  const locale = useLocale();
  const t = strings.taskDetail;
  const p = task.permissions;
  const busy = (field: DetailField) => props.savingField === field;

  const status = statuses.find((s) => s.id === task.status_id);
  const type = types.find((x) => x.id === task.type_id);
  const assignee = assignees.find((a) => a.id === task.assignee_id);
  const date = (iso: string | null) =>
    formatCalendarDate(iso, locale) ?? t.notSet;
  const overdue = isOverdue(task.due_date, task.completed_at, todayIso());

  return (
    <dl
      aria-label={t.propertiesLabel}
      className="m-0 flex flex-col border-0 border-b border-solid border-border"
    >
      <Row
        field="type_id"
        error={fieldErrors.type_id}
        editable={canEditField("type_id", p) && types.length > 0}
        view={<Badge tone="neutral">{type?.name ?? t.unknown}</Badge>}
        control={(id, describedBy) => (
          <DraftSelect
            resetKey={props.resetKey}
            id={id}
            aria-describedby={describedBy}
            aria-invalid={fieldErrors.type_id ? true : undefined}
            aria-busy={busy("type_id") || undefined}
            value={task.type_id ?? ""}
            options={types.map((x) => ({ value: x.id, label: x.name }))}
            onValue={(v) => void save("type_id", { type_id: v })}
          />
        )}
      />
      <Row
        field="status_id"
        error={fieldErrors.status_id}
        editable={canEditField("status_id", p) && statuses.length > 0}
        view={
          <span className="inline-flex items-center gap-1.5 rounded-pill border border-solid border-border-strong px-2.5 py-0.5 text-sm font-medium">
            <span
              aria-hidden="true"
              className="inline-block size-2 rounded-pill"
              style={{ background: status?.color }}
            />
            {status?.name ?? t.unknown}
          </span>
        }
        control={(id, describedBy) => (
          <DraftSelect
            resetKey={props.resetKey}
            id={id}
            aria-describedby={describedBy}
            aria-invalid={fieldErrors.status_id ? true : undefined}
            aria-busy={busy("status_id") || undefined}
            value={task.status_id ?? ""}
            options={statuses.map((s) => ({ value: s.id, label: s.name }))}
            onValue={(v) => void save("status_id", { status_id: v })}
          />
        )}
      />
      <Row
        field="assignee_id"
        error={fieldErrors.assignee_id}
        editable={canEditField("assignee_id", p)}
        hint={p.can_edit && !p.can_reassign ? t.reassignLocked : undefined}
        view={
          assignee ? (
            <span className="inline-flex items-center gap-2">
              <Avatar name={assignee.name} size="sm" />
              <span className="[overflow-wrap:anywhere]">{assignee.name}</span>
            </span>
          ) : (
            <span className="text-text-muted">
              {task.assignee_id ? t.unknown : t.unassigned}
            </span>
          )
        }
        control={(id, describedBy) => (
          <DraftSelect
            resetKey={props.resetKey}
            id={id}
            aria-describedby={describedBy}
            aria-invalid={fieldErrors.assignee_id ? true : undefined}
            aria-busy={busy("assignee_id") || undefined}
            value={task.assignee_id ?? ""}
            options={[
              { value: "", label: t.unassigned },
              ...assignees.map((a) => ({
                value: a.id,
                label: a.assignable ? a.name : t.notAssignable(a.name),
                disabled: !a.assignable,
              })),
            ]}
            onValue={(v) =>
              void save("assignee_id", { assignee_id: v || null })
            }
          />
        )}
      />
      <Row
        field="priority"
        error={fieldErrors.priority}
        editable={canEditField("priority", p)}
        view={<PriorityBadge priority={task.priority} />}
        control={(id, describedBy) => (
          <DraftSelect
            resetKey={props.resetKey}
            id={id}
            aria-describedby={describedBy}
            aria-busy={busy("priority") || undefined}
            value={task.priority}
            options={TASK_PRIORITIES.map((value) => ({
              value,
              label: strings.ui.priority[value],
            }))}
            onValue={(v) =>
              void save("priority", { priority: v as TaskPriority })
            }
          />
        )}
      />
      {(["start_date", "due_date"] as const).map((field) => (
        <Row
          key={field}
          field={field}
          error={fieldErrors[field]}
          editable={canEditField(field, p)}
          view={
            <span
              className={
                field === "due_date" && overdue
                  ? "font-mono text-xs font-semibold text-danger"
                  : "font-mono text-xs"
              }
            >
              {field === "due_date" && overdue
                ? t.overdue(date(task.due_date))
                : date(task[field])}
            </span>
          }
          control={(id, describedBy) => (
            <DateInput
              resetKey={props.resetKey}
              id={id}
              describedBy={describedBy}
              invalid={Boolean(fieldErrors[field])}
              busy={busy(field)}
              value={task[field]}
              onCommit={(value) => void save(field, { [field]: value })}
            />
          )}
        />
      ))}
      <LabelsRow {...props} />
    </dl>
  );
}

function Row({
  field,
  editable,
  view,
  control,
  error,
  hint,
}: {
  field: DetailField;
  editable: boolean;
  view: ReactNode;
  control: (id: string, describedBy: string | undefined) => ReactNode;
  error?: string;
  hint?: string;
}) {
  const strings = useStrings();
  const id = useId();
  const errorId = error ? `${id}-error` : undefined;
  const hintId = hint ? `${id}-hint` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;
  const name = strings.taskDetail.fields[field];
  return (
    // dt, dd là con trực tiếp của div nhóm (con trực tiếp của dl) theo quy tắc của <dl>.
    <div
      data-field={field}
      className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-0 border-t border-solid border-border py-2"
    >
      <dt className="label">
        {editable ? <label htmlFor={id}>{name}</label> : name}
      </dt>
      <dd
        className={
          editable
            ? "m-0 w-full min-w-0 text-sm sm:w-64"
            : "m-0 flex min-w-0 justify-end text-right text-sm sm:max-w-[60%]"
        }
      >
        {editable ? (
          <div className="w-full text-left">{control(id, describedBy)}</div>
        ) : (
          view
        )}
      </dd>
      {hint ? (
        <dd id={hintId} className="m-0 w-full text-xs text-text-muted">
          {hint}
        </dd>
      ) : null}
      {error ? (
        <dd
          id={errorId}
          role="alert"
          className="m-0 flex w-full items-center gap-1.5 text-xs text-danger"
        >
          <ErrorIcon className="size-3.5 shrink-0" />
          {error}
        </dd>
      ) : null}
    </div>
  );
}

/** Ô ngày lưu khi rời ô hoặc nhấn Enter (gõ từng phần ngày không gửi nhiều PATCH). */
function DateInput({
  id,
  describedBy,
  invalid,
  busy,
  value,
  resetKey,
  onCommit,
}: {
  resetKey: number;
  id: string;
  describedBy: string | undefined;
  invalid: boolean;
  busy: boolean;
  value: string | null;
  onCommit: (value: string | null) => void;
}) {
  const [draft, setDraft] = useDraft(value ?? "", resetKey);
  const commit = () => {
    const next = draft === "" ? null : draft;
    if (next !== value) onCommit(next);
  };
  return (
    <Input
      id={id}
      type="date"
      aria-describedby={describedBy}
      aria-invalid={invalid || undefined}
      aria-busy={busy || undefined}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        }
      }}
    />
  );
}

function LabelsRow({
  task,
  labels,
  fieldErrors,
  resetKey,
  savingField,
  save,
}: PropertiesProps) {
  const strings = useStrings();
  const t = strings.taskDetail;
  const [editing, setEditing] = useState(false);
  const legendId = useId();
  const editable = canEditField("label_ids", task.permissions);
  const byId = new Map(labels.map((l) => [l.id, l]));
  const current = task.label_ids
    .map((id) => byId.get(id))
    .filter((l): l is Label => Boolean(l));
  const error = fieldErrors.label_ids;
  const [checked, setChecked] = useDraft(task.label_ids.join(","), resetKey);
  const checkedIds = checked === "" ? [] : checked.split(",");

  const chips =
    current.length === 0 ? (
      <span className="text-text-muted">{t.labels.none}</span>
    ) : (
      <ul className="m-0 flex list-none flex-wrap justify-end gap-1.5 p-0">
        {current.map((l) => (
          <li
            key={l.id}
            className="rounded-pill border border-solid border-border px-2 py-0.5 text-xs text-text-muted"
          >
            {l.name}
          </li>
        ))}
      </ul>
    );

  function toggle(labelId: string, on: boolean) {
    const next = [
      ...new Set(
        on
          ? [...checkedIds, labelId]
          : checkedIds.filter((id) => id !== labelId),
      ),
    ].sort();
    setChecked(next.join(","));
    void save("label_ids", { label_ids: next });
  }

  return (
    <div
      data-field="label_ids"
      className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-0 border-t border-solid border-border py-2"
    >
      <dt className="label">{t.fields.label_ids}</dt>
      <dd className="m-0 flex min-w-0 flex-wrap items-center justify-end gap-2 text-sm">
        {chips}
        {editable && labels.length > 0 ? (
          <Button
            variant="text"
            aria-expanded={editing}
            onClick={() => setEditing((v) => !v)}
          >
            {editing ? t.labels.done : t.labels.edit}
          </Button>
        ) : null}
      </dd>
      {editable && labels.length === 0 ? (
        <dd className="m-0 w-full text-xs text-text-muted">
          {t.labels.projectEmpty}
        </dd>
      ) : null}
      {editable && editing ? (
        <dd className="m-0 w-full">
          <fieldset
            aria-labelledby={legendId}
            aria-busy={savingField === "label_ids" || undefined}
            className="m-0 flex flex-col gap-0.5 rounded-md border border-solid border-border px-3 py-2"
          >
            <legend id={legendId} className="sr-only">
              {t.labels.legend}
            </legend>
            {labels.map((l) => (
              <Checkbox
                key={l.id}
                label={l.name}
                checked={checkedIds.includes(l.id)}
                onChange={(e) => toggle(l.id, e.target.checked)}
              />
            ))}
          </fieldset>
        </dd>
      ) : null}
      {error ? (
        <dd
          role="alert"
          className="m-0 flex w-full items-center gap-1.5 text-xs text-danger"
        >
          <ErrorIcon className="size-3.5 shrink-0" />
          {error}
        </dd>
      ) : null}
    </div>
  );
}

/**
 * Giá trị nháp của một ô: theo giá trị đã lưu khi giá trị đó đổi (lưu xong, hoàn tác, tải lại) hoặc
 * khi resetKey tăng (lưu lỗi), không remount ô nên focus bàn phím giữ nguyên.
 */
function useDraft<T>(value: T, resetKey: number) {
  const [draft, setDraft] = useState(value);
  const [synced, setSynced] = useState({ value, resetKey });
  if (synced.value !== value || synced.resetKey !== resetKey) {
    setSynced({ value, resetKey });
    setDraft(value);
  }
  return [draft, setDraft] as const;
}

/** Ô chọn lưu ngay khi đổi; hiện lựa chọn mới trong lúc lưu, lỗi thì về giá trị đã lưu. */
function DraftSelect({
  value,
  resetKey,
  onValue,
  ...props
}: Omit<SelectProps, "value" | "onChange" | "defaultValue"> & {
  value: string;
  resetKey: number;
  onValue: (value: string) => void;
}) {
  const [draft, setDraft] = useDraft(value, resetKey);
  return (
    <Select
      {...props}
      value={draft}
      onChange={(e) => {
        setDraft(e.target.value);
        onValue(e.target.value);
      }}
    />
  );
}
