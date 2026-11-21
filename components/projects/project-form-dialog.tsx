"use client";

import { useState, type FormEvent } from "react";
import { TemplatePicker } from "@/components/project-templates/template-picker";
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
import { apiErrorText } from "@/lib/i18n/api-error";
import { useStrings } from "@/lib/i18n/client";
import type { Messages } from "@/lib/i18n/messages";

type FieldName = "name" | "description" | "start_date" | "end_date";
type Errors = Partial<Record<FieldName, string>>;

/** Lỗi từng ô từ phản hồi API (details) hoặc kiểm tra phía trình duyệt. */
function errorsFromApi(strings: Messages, error: ApiError): Errors {
  const t = strings.projects;
  const out: Errors = {};
  // Lỗi template (không còn dùng được, hỏng): hiện ở cuối form, không gắn vào ô ngày.
  if (error.details?.some((d) => d.field === "template_id")) return out;
  if (error.code === "business_rule_violated") {
    out.end_date = apiErrorText(strings, error);
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

function validate(strings: Messages, input: ProjectInput): Errors {
  const t = strings.projects;
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
 * Hộp thoại tạo hoặc sửa dự án (mockup v3 bp-CreateProject.dc.html, S13). Khi tạo mới có phần
 * "Bắt đầu từ": dự án trống hoặc một template dự án (Story E7-1); máy chủ nhân bản cấu trúc template
 * trong cùng giao dịch tạo dự án.
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
  const strings = useStrings();
  const t = strings.projects;
  const editing = project !== null;
  const [name, setName] = useState(project?.name ?? "");
  const [description, setDescription] = useState(project?.description ?? "");
  const [startDate, setStartDate] = useState(project?.start_date ?? "");
  const [endDate, setEndDate] = useState(project?.end_date ?? "");
  const [templateId, setTemplateId] = useState<string | null>(null);
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
    const local = validate(strings, input);
    setErrors(local);
    setFormError(null);
    if (Object.keys(local).length > 0) return;

    setPending(true);
    const result = editing
      ? await patchProject(project.id, input)
      : await createProject({ ...input, template_id: templateId });
    setPending(false);
    if (result.ok) {
      onSaved(result.data.data, editing ? "updated" : "created");
      return;
    }
    const fieldErrors = errorsFromApi(strings, result.error);
    setErrors(fieldErrors);
    if (Object.keys(fieldErrors).length === 0)
      setFormError(apiErrorText(strings, result.error));
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
        {editing ? null : (
          <>
            <TemplatePicker
              value={templateId}
              onChange={setTemplateId}
              disabled={pending}
            />
            {templateId ? (
              <p className="text-xs text-text-muted">
                {strings.projectTemplates.create.datesHint}
              </p>
            ) : null}
          </>
        )}
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
            loadingText={
              templateId && !editing
                ? strings.projectTemplates.create.creating
                : t.form.saving
            }
            trailing={editing ? undefined : "→"}
          >
            {editing ? t.form.submitEdit : t.form.submitCreate}
          </Button>
        </div>
      </form>
    </DialogContent>
  );
}
