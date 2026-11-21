"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { AlertIcon } from "@/components/ui/icons";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { apiErrorText } from "@/lib/i18n/api-error";
import { useStrings } from "@/lib/i18n/client";
import {
  PROJECT_TEMPLATES_PATH,
  saveProjectAsTemplate,
} from "@/lib/project-templates/client-api";
import {
  normalizeTemplateName,
  PROJECT_TEMPLATE_NAME_MAX,
} from "@/lib/project-templates/model";

/**
 * "Lưu thành template" (Story E7-1, FR-04): PM của dự án hoặc Admin đặt tên rồi lưu cấu trúc dự án.
 * Nơi gọi chỉ hiện nút khi người dùng sửa được cấu hình dự án; API và hàm CSDL kiểm lại quyền.
 */
export function SaveTemplateDialog({
  projectId,
  projectName,
}: {
  projectId: string;
  projectName: string;
}) {
  const strings = useStrings();
  const t = strings.projectTemplates.save;
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary">{t.action}</Button>
      </DialogTrigger>
      {open ? (
        <SaveForm
          projectId={projectId}
          projectName={projectName}
          onDone={() => setOpen(false)}
        />
      ) : null}
    </Dialog>
  );
}

function SaveForm({
  projectId,
  projectName,
  onDone,
}: {
  projectId: string;
  projectName: string;
  onDone: () => void;
}) {
  const strings = useStrings();
  const t = strings.projectTemplates;
  const { toast } = useToast();
  const [name, setName] = useState(
    projectName.slice(0, PROJECT_TEMPLATE_NAME_MAX),
  );
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const value = normalizeTemplateName(name);
    setFormError(null);
    if (!value) {
      setError(t.errors.nameRequired);
      return;
    }
    if (value.length > PROJECT_TEMPLATE_NAME_MAX) {
      setError(t.errors.nameTooLong);
      return;
    }
    setError(null);
    setPending(true);
    const result = await saveProjectAsTemplate(projectId, value);
    setPending(false);
    if (result.ok) {
      toast({ title: t.save.saved(result.data.data.name), tone: "success" });
      onDone();
      return;
    }
    if (
      result.error.code === "conflict" ||
      result.error.details?.some((d) => d.field === "name")
    ) {
      setError(apiErrorText(strings, result.error));
    } else {
      setFormError(apiErrorText(strings, result.error));
    }
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
          {t.save.eyebrow}
        </span>
        <DialogTitle className="font-display text-display-sm">
          {t.save.title}
          <span aria-hidden="true" className="text-accent">
            .
          </span>
        </DialogTitle>
        <DialogDescription>{t.save.description}</DialogDescription>
      </div>
      <form noValidate onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Field label={t.save.nameLabel} error={error ?? undefined}>
          {(control) => (
            <Input
              {...control}
              value={name}
              maxLength={PROJECT_TEMPLATE_NAME_MAX}
              required
              aria-required="true"
              autoComplete="off"
              onChange={(e) => setName(e.target.value)}
            />
          )}
        </Field>
        <ul className="m-0 flex list-none flex-col gap-2 p-0 text-sm text-text">
          <li>{t.save.includes}</li>
          <li className="text-text-muted">{t.save.excludes}</li>
        </ul>
        <p className="flex items-start gap-2 rounded-md border border-solid border-border bg-bg-subtle p-3 text-sm text-text">
          <AlertIcon className="mt-0.5 size-4 shrink-0 text-warning" />
          {t.save.sharedWarning}
        </p>
        {formError ? (
          <p role="alert" className="text-sm text-danger">
            {formError}
          </p>
        ) : null}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
          <Link
            href={PROJECT_TEMPLATES_PATH}
            className="inline-flex min-h-11 items-center text-sm font-medium text-primary underline-offset-2 hover:underline sm:mr-auto sm:min-h-9"
          >
            {t.save.manageLink}
          </Link>
          <DialogClose asChild>
            <Button variant="secondary" disabled={pending}>
              {strings.ui.cancel}
            </Button>
          </DialogClose>
          <Button type="submit" loading={pending} loadingText={t.save.saving}>
            {t.save.submit}
          </Button>
        </div>
      </form>
    </DialogContent>
  );
}
