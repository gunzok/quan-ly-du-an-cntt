"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { ApiError } from "@/lib/api/errors";
import {
  createProject,
  patchProject,
  type ProjectInput,
} from "@/lib/projects/client-api";
import type { Project } from "@/lib/projects/model";
import {
  DESCRIPTION_MAX_LENGTH,
  NAME_MAX_LENGTH,
} from "@/lib/projects/constants";
import { strings } from "@/lib/strings";

const t = strings.projects;

type FieldName = "name" | "description" | "start_date" | "end_date";
type Errors = Partial<Record<FieldName, string>>;

/** Lỗi từng ô từ phản hồi API (details) hoặc kiểm tra phía trình duyệt. */
function errorsFromApi(error: ApiError): Errors {
  const out: Errors = {};
  if (error.code === "business_rule_violated") {
    out.end_date = error.message;
    return out;
  }
  for (const d of error.details ?? []) {
    const field = d.field as FieldName;
    if (field === "name") {
      out.name =
        d.issue === "too_long" ? t.form.nameTooLong : t.form.nameRequired;
    } else if (field === "description") {
      out.description = t.form.descriptionTooLong;
    } else if (field === "start_date" || field === "end_date") {
      out[field] = t.form.invalidDate;
    }
  }
  return out;
}

function validate(input: ProjectInput): Errors {
  const errors: Errors = {};
  if (!input.name) errors.name = t.form.nameRequired;
  else if (input.name.length > NAME_MAX_LENGTH)
    errors.name = t.form.nameTooLong;
  if ((input.description ?? "").length > DESCRIPTION_MAX_LENGTH) {
    errors.description = t.form.descriptionTooLong;
  }
  if (input.start_date && input.end_date && input.start_date > input.end_date) {
    errors.end_date = t.errors.dateOrder;
  }
  return errors;
}

/**
 * Hộp thoại tạo hoặc sửa dự án (mockup v3 bp-CreateProject.dc.html, S13). Phần "Bắt đầu từ"
 * (chọn template) thuộc Story E7-1, chưa có ở đây.
 */
export function ProjectFormDialog({
  open,
  project,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  /** null: tạo mới; có giá trị: sửa dự án đó. */
  project: Project | null;
  onOpenChange: (open: boolean) => void;
  onSaved: (project: Project, mode: "created" | "updated") => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open ? (
        <FormBody
          key={project?.id ?? "new"}
          project={project}
          onSaved={onSaved}
        />
      ) : null}
    </Dialog>
  );
}

function FormBody({
  project,
  onSaved,
}: {
  project: Project | null;
  onSaved: (project: Project, mode: "created" | "updated") => void;
}) {
  const editing = project !== null;
  const [name, setName] = useState(project?.name ?? "");
  const [description, setDescription] = useState(project?.description ?? "");
  const [startDate, setStartDate] = useState(project?.start_date ?? "");
  const [endDate, setEndDate] = useState(project?.end_date ?? "");
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const input: ProjectInput = {
      name: name.trim(),
      description: description.trim() === "" ? null : description,
      start_date: startDate || null,
      end_date: endDate || null,
    };
    const local = validate(input);
    setErrors(local);
    setFormError(null);
    if (Object.keys(local).length > 0) return;

    setPending(true);
    const result = editing
      ? await patchProject(project.id, input)
      : await createProject(input);
    setPending(false);
    if (result.ok) {
      onSaved(result.data.data, editing ? "updated" : "created");
      return;
    }
    const fieldErrors = errorsFromApi(result.error);
    setErrors(fieldErrors);
    if (Object.keys(fieldErrors).length === 0)
      setFormError(result.error.message);
  }

  return (
    <DialogContent
      className="max-w-lg"
      onInteractOutside={(event) => pending && event.preventDefault()}
    >
      <div className="flex flex-col gap-1.5 pr-8">
        <span className="label flex items-center gap-2">
          <span
            aria-hidden="true"
            className="inline-block size-1.5 rounded-pill bg-accent"
          />
          {editing ? t.form.editEyebrow : t.form.createEyebrow}
        </span>
        <DialogTitle className="font-display text-display-sm">
          {editing ? t.form.editTitle : t.form.createTitle}
          <span aria-hidden="true" className="text-accent">
            .
          </span>
        </DialogTitle>
        <DialogDescription>
          {editing ? t.form.editDescription : t.form.description}
        </DialogDescription>
      </div>
      <form noValidate onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Field label={t.form.name} error={errors.name}>
          {(control) => (
            <Input
              {...control}
              value={name}
              maxLength={NAME_MAX_LENGTH}
              required
              aria-required="true"
              autoComplete="off"
              onChange={(e) => setName(e.target.value)}
            />
          )}
        </Field>
        <Field
          label={t.form.descriptionLabel}
          hint={t.form.descriptionHint}
          error={errors.description}
        >
          {(control) => (
            <Textarea
              {...control}
              rows={3}
              value={description}
              maxLength={DESCRIPTION_MAX_LENGTH}
              onChange={(e) => setDescription(e.target.value)}
            />
          )}
        </Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={t.form.startDate} error={errors.start_date}>
            {(control) => (
              <Input
                {...control}
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            )}
          </Field>
          <Field label={t.form.endDate} error={errors.end_date}>
            {(control) => (
              <Input
                {...control}
                type="date"
                value={endDate}
                min={startDate || undefined}
                onChange={(e) => setEndDate(e.target.value)}
              />
            )}
          </Field>
        </div>
        {formError ? (
          <p role="alert" className="text-sm text-danger">
            {formError}
          </p>
        ) : null}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <DialogClose asChild>
            <Button variant="secondary" disabled={pending}>
              {strings.ui.cancel}
            </Button>
          </DialogClose>
          <Button
            type="submit"
            loading={pending}
            loadingText={t.form.saving}
            trailing={editing ? undefined : "→"}
          >
            {editing ? t.form.submitEdit : t.form.submitCreate}
          </Button>
        </div>
      </form>
    </DialogContent>
  );
}
