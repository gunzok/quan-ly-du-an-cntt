"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { ErrorIcon } from "@/components/ui/icons";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  createConfig,
  deleteConfig,
  patchConfig,
  type ConfigInput,
} from "@/lib/project-config/client-api";
import {
  CONFIG_COLORS,
  CONFIG_NAME_MAX_LENGTH,
  STATUS_CATEGORIES,
  type ConfigItemByKind,
  type ConfigKind,
  type StatusCategory,
  type TaskStatus,
  type TaskType,
} from "@/lib/project-config/model";
import { apiErrorText } from "@/lib/i18n/api-error";
import { useStrings } from "@/lib/i18n/client";
import type { Messages } from "@/lib/i18n/messages";

type AnyItem = ConfigItemByKind[ConfigKind];

const DEFAULT_COLOR: Record<ConfigKind, string> = {
  statuses: "#2054F0",
  "task-types": "#2054F0",
  labels: "#8A93A6",
};

function colorOptions(strings: Messages, current: string) {
  const t = strings.projectConfig;
  const options: { value: string; label: string }[] = CONFIG_COLORS.map(
    (c) => ({ value: c.value, label: t.colors[c.key] }),
  );
  if (!options.some((o) => o.value === current.toUpperCase())) {
    options.push({ value: current, label: `${t.colors.custom} (${current})` });
  }
  return options;
}

/** Hộp thoại thêm hoặc sửa trạng thái, loại task, nhãn. */
export function ConfigFormDialog({
  kind,
  projectId,
  open,
  item,
  onOpenChange,
  onSaved,
}: {
  kind: ConfigKind;
  projectId: string;
  open: boolean;
  /** null: thêm mới. */
  item: AnyItem | null;
  onOpenChange: (open: boolean) => void;
  onSaved: (item: AnyItem, mode: "created" | "updated") => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open ? (
        <FormBody
          key={item?.id ?? "new"}
          kind={kind}
          projectId={projectId}
          item={item}
          onSaved={onSaved}
        />
      ) : null}
    </Dialog>
  );
}

function FormBody({
  kind,
  projectId,
  item,
  onSaved,
}: {
  kind: ConfigKind;
  projectId: string;
  item: AnyItem | null;
  onSaved: (item: AnyItem, mode: "created" | "updated") => void;
}) {
  const strings = useStrings();
  const t = strings.projectConfig;
  const k = t.kinds[kind];
  const editing = item !== null;
  const [name, setName] = useState(item?.name ?? "");
  const [color, setColor] = useState(item?.color ?? DEFAULT_COLOR[kind]);
  const [category, setCategory] = useState<StatusCategory>(
    kind === "statuses" && item ? (item as TaskStatus).category : "in_progress",
  );
  const [milestone, setMilestone] = useState(
    kind === "task-types" && item ? (item as TaskType).is_milestone : false,
  );
  const [nameError, setNameError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const trimmed = name.trim().replace(/\s+/g, " ");
    setFormError(null);
    if (!trimmed) {
      setNameError(t.form.nameRequired);
      return;
    }
    if (trimmed.length > CONFIG_NAME_MAX_LENGTH) {
      setNameError(t.form.nameTooLong);
      return;
    }
    setNameError(null);
    const body: ConfigInput = { name: trimmed, color };
    if (kind === "statuses") body.category = category;
    if (kind === "task-types") body.is_milestone = milestone;

    setPending(true);
    const result = editing
      ? await patchConfig(kind, item.id, body)
      : await createConfig(kind, projectId, body);
    setPending(false);
    if (result.ok) {
      onSaved(result.data.data, editing ? "updated" : "created");
      return;
    }
    if (result.error.details?.some((d) => d.field === "name")) {
      setNameError(apiErrorText(strings, result.error));
    } else {
      setFormError(apiErrorText(strings, result.error));
    }
  }

  return (
    <DialogContent
      onInteractOutside={(event) => pending && event.preventDefault()}
    >
      <div className="flex flex-col gap-1.5 pr-8">
        <DialogTitle className="font-display text-display-sm">
          {editing ? k.editTitle(item.name) : k.addTitle}
          <span aria-hidden="true" className="text-accent">
            .
          </span>
        </DialogTitle>
        <DialogDescription>{t.canEditNote}</DialogDescription>
      </div>
      <form noValidate onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Field label={t.form.name} error={nameError}>
          {(control) => (
            <Input
              {...control}
              value={name}
              maxLength={CONFIG_NAME_MAX_LENGTH}
              required
              aria-required="true"
              autoComplete="off"
              onChange={(e) => setName(e.target.value)}
            />
          )}
        </Field>
        {kind === "statuses" ? (
          <Field label={t.form.category} hint={t.form.categoryHint}>
            {(control) => (
              <Select
                {...control}
                value={category}
                options={STATUS_CATEGORIES.map((c) => ({
                  value: c,
                  label: t.categories[c],
                }))}
                onChange={(e) => setCategory(e.target.value as StatusCategory)}
              />
            )}
          </Field>
        ) : null}
        <Field label={t.form.color}>
          {(control) => (
            <div className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className="inline-block size-4 shrink-0 rounded-pill border border-solid border-border"
                style={{ backgroundColor: color }}
              />
              <div className="flex-1">
                <Select
                  {...control}
                  value={color}
                  options={colorOptions(strings, color)}
                  onChange={(e) => setColor(e.target.value)}
                />
              </div>
            </div>
          )}
        </Field>
        {kind === "task-types" ? (
          <Checkbox
            label={t.form.milestone}
            checked={milestone}
            onChange={(e) => setMilestone(e.target.checked)}
          />
        ) : null}
        {formError ? (
          <p
            role="alert"
            className="flex items-center gap-1.5 text-sm text-danger"
          >
            <ErrorIcon className="size-4 shrink-0" />
            {formError}
          </p>
        ) : null}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <DialogClose asChild>
            <Button variant="secondary" disabled={pending}>
              {strings.ui.cancel}
            </Button>
          </DialogClose>
          <Button type="submit" loading={pending} loadingText={t.form.saving}>
            {editing ? t.form.save : t.form.add}
          </Button>
        </div>
      </form>
    </DialogContent>
  );
}

/**
 * Nút Xóa và hộp thoại xác nhận. Trạng thái/loại đang có task: bắt chọn mục thay thế, API chuyển
 * task rồi xóa trong cùng giao dịch (AC2). Nhãn: xóa thẳng, gỡ khỏi task.
 */
export function DeleteConfigDialog({
  kind,
  item,
  others,
  onDeleted,
}: {
  kind: ConfigKind;
  item: AnyItem;
  others: AnyItem[];
  onDeleted: (item: AnyItem, moved: number) => void;
}) {
  const strings = useStrings();
  const t = strings.projectConfig;
  const k = t.kinds[kind];
  const needsReplacement = kind !== "labels" && item.task_count > 0;
  const [open, setOpen] = useState(false);
  const [replaceWith, setReplaceWith] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function handleOpenChange(next: boolean) {
    if (pending) return;
    setOpen(next);
    if (next) {
      setReplaceWith("");
      setError(null);
    }
  }

  async function handleConfirm() {
    if (pending) return;
    if (needsReplacement && !replaceWith) {
      setError(t.errors.replaceRequired);
      return;
    }
    setPending(true);
    const result = await deleteConfig(
      kind,
      item.id,
      needsReplacement ? replaceWith : null,
    );
    setPending(false);
    if (!result.ok) {
      setError(apiErrorText(strings, result.error));
      return;
    }
    setOpen(false);
    onDeleted(item, needsReplacement ? item.task_count : 0);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="text" className="text-danger">
          {t.actions.delete}
          <span className="sr-only"> {item.name}</span>
        </Button>
      </DialogTrigger>
      <DialogContent
        role="alertdialog"
        showClose={false}
        onInteractOutside={(event) => event.preventDefault()}
      >
        <DialogTitle>{k.deleteTitle(item.name)}</DialogTitle>
        <DialogDescription>
          {item.task_count > 0 ? k.inUseBody(item.task_count) : k.unusedBody}
        </DialogDescription>
        {needsReplacement ? (
          <Field label={k.replaceLabel} error={error}>
            {(control) => (
              <Select
                {...control}
                value={replaceWith}
                placeholder={t.errors.replaceRequired}
                options={others.map((o) => ({
                  value: o.id,
                  label:
                    kind === "statuses"
                      ? `${o.name} · ${t.categories[(o as TaskStatus).category]}`
                      : o.name,
                }))}
                onChange={(e) => {
                  setReplaceWith(e.target.value);
                  setError(null);
                }}
              />
            )}
          </Field>
        ) : error ? (
          <p
            role="alert"
            className="flex items-center gap-1.5 text-sm text-danger"
          >
            <ErrorIcon className="size-4 shrink-0" />
            {error}
          </p>
        ) : null}
        {needsReplacement && error && error !== t.errors.replaceRequired ? (
          <p role="alert" className="sr-only">
            {error}
          </p>
        ) : null}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <DialogClose asChild>
            <Button variant="secondary" disabled={pending}>
              {strings.ui.cancel}
            </Button>
          </DialogClose>
          <Button variant="danger" loading={pending} onClick={handleConfirm}>
            {needsReplacement
              ? t.actions.moveAndDelete
              : t.actions.confirmDelete}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
