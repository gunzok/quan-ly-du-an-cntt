"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { apiErrorText } from "@/lib/i18n/api-error";
import { useStrings } from "@/lib/i18n/client";
import { DEFAULT_VIEW_COLUMNS, type ViewColumn } from "@/lib/saved-views/model";
import { createTask } from "@/lib/task-list/client-api";
import { normalizeColumns, OPTIONAL_COLUMNS } from "@/lib/task-list/model";
import type { Task } from "@/lib/tasks/model";
import { TITLE_MAX_LENGTH } from "@/lib/tasks/validate";

/** Chọn cột hiển thị (S12 "Cột: …"). Đổi là áp ngay; tên task luôn hiện. */
export function ColumnDialog({
  open,
  onOpenChange,
  columns,
  onChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  columns: readonly ViewColumn[];
  onChange: (columns: ViewColumn[]) => void;
}) {
  const strings = useStrings();
  const t = strings.taskList;
  const set = new Set(columns);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>{t.columnDialog.title}</DialogTitle>
        <DialogDescription>{t.columnDialog.description}</DialogDescription>
        <fieldset className="m-0 grid grid-cols-1 gap-x-4 border-0 p-0 sm:grid-cols-2">
          <legend className="sr-only">{t.columnDialog.title}</legend>
          {OPTIONAL_COLUMNS.map((c) => (
            <Checkbox
              key={c}
              label={t.columns[c]}
              checked={set.has(c)}
              onChange={(e) => {
                const next = new Set(columns);
                if (e.target.checked) next.add(c);
                else next.delete(c);
                onChange(normalizeColumns([...next]));
              }}
            />
          ))}
        </fieldset>
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            variant="text"
            onClick={() => onChange([...DEFAULT_VIEW_COLUMNS])}
          >
            {t.columnDialog.reset}
          </Button>
          <Button onClick={() => onOpenChange(false)}>
            {t.columnDialog.done}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Tạo task nhanh (nút "Tạo task" của mockup): chỉ tên, dùng POST có sẵn. */
export function CreateTaskDialog({
  open,
  onOpenChange,
  projectId,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  onCreated: (task: Task) => void;
}) {
  const strings = useStrings();
  const t = strings.taskList.create;
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const close = (next: boolean) => {
    if (!next) {
      setTitle("");
      setError(null);
    }
    onOpenChange(next);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || title.trim() === "") return;
    setBusy(true);
    setError(null);
    try {
      const result = await createTask(projectId, title.trim());
      if (!result.ok) {
        setError(`${t.failed} ${apiErrorText(strings, result.error)}`);
        return;
      }
      onCreated(result.data.data);
      close(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent>
        <DialogTitle>{t.title}</DialogTitle>
        <DialogDescription>{t.description}</DialogDescription>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <Field label={t.name} error={error ?? undefined}>
            {(control) => (
              <Input
                {...control}
                value={title}
                required
                maxLength={TITLE_MAX_LENGTH}
                autoComplete="off"
                onChange={(e) => setTitle(e.target.value)}
              />
            )}
          </Field>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="text" onClick={() => close(false)}>
              {strings.ui.cancel}
            </Button>
            <Button
              type="submit"
              loading={busy}
              loadingText={t.submitting}
              disabled={title.trim() === ""}
            >
              {t.submit}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
