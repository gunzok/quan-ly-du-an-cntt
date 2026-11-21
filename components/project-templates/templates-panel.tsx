"use client";

import { useCallback, useEffect, useId, useState, type FormEvent } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ConfirmDialog,
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton, SkeletonGroup } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import { apiErrorText } from "@/lib/i18n/api-error";
import { useI18n } from "@/lib/i18n/client";
import { formatDateInZone, formatNumber } from "@/lib/i18n/format";
import {
  deleteProjectTemplate,
  fetchProjectTemplates,
  patchProjectTemplate,
} from "@/lib/project-templates/client-api";
import {
  normalizeTemplateName,
  PROJECT_TEMPLATE_NAME_MAX,
  type ProjectTemplate,
} from "@/lib/project-templates/model";

/**
 * S17 tab "Template dự án" (Story E7-1; mockup v3 bp-Templates.dc.html): danh sách, tóm tắt (số
 * trạng thái, loại, nhãn, task), đổi tên, lưu trữ/khôi phục, xóa có xác nhận. Dòng của người khác
 * (không phải Admin) chỉ đọc. Dùng ở /project-templates (PM, Admin) và /admin/report-templates
 * (Admin). Phải nằm trong ToastProvider.
 */

type ListState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; items: ProjectTemplate[] };

export function ProjectTemplatesPanel() {
  const { t: strings, locale } = useI18n();
  const t = strings.projectTemplates;
  const { toast } = useToast();
  const [list, setList] = useState<ListState>({ status: "loading" });
  const [includeArchived, setIncludeArchived] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<ProjectTemplate | null>(null);
  const captionId = useId();

  useEffect(() => {
    const controller = new AbortController();
    fetchProjectTemplates({ includeArchived }, controller.signal)
      .then((result) => {
        setList(
          result.ok
            ? { status: "ready", items: result.data.data }
            : { status: "error", message: apiErrorText(strings, result.error) },
        );
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [includeArchived, reloadToken, strings]);

  const reload = useCallback(() => {
    setList({ status: "loading" });
    setReloadToken((n) => n + 1);
  }, []);

  function replace(item: ProjectTemplate) {
    setList((prev) =>
      prev.status === "ready"
        ? {
            ...prev,
            items: prev.items
              .map((x) => (x.id === item.id ? item : x))
              .filter((x) => includeArchived || !x.archived),
          }
        : prev,
    );
  }

  async function toggleArchive(item: ProjectTemplate) {
    setBusyId(item.id);
    const result = await patchProjectTemplate(item.id, {
      archived: !item.archived,
    });
    setBusyId(null);
    if (!result.ok) {
      toast({ title: apiErrorText(strings, result.error), tone: "error" });
      return;
    }
    toast({
      title: item.archived
        ? t.restoredToast(item.name)
        : t.archivedToast(item.name),
      tone: "success",
    });
    replace(result.data.data);
  }

  async function remove(item: ProjectTemplate) {
    const result = await deleteProjectTemplate(item.id);
    if (!result.ok) {
      toast({ title: apiErrorText(strings, result.error), tone: "error" });
      return;
    }
    toast({ title: t.deleted(item.name), tone: "success" });
    setList((prev) =>
      prev.status === "ready"
        ? { ...prev, items: prev.items.filter((x) => x.id !== item.id) }
        : prev,
    );
  }

  const n = (value: number) => formatNumber(value, locale);
  const summary = (item: ProjectTemplate) =>
    t.summary(
      n(item.summary.statuses),
      n(item.summary.task_types),
      n(item.summary.labels),
      n(item.summary.tasks),
    );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-2xl text-sm text-text-muted">{t.intro}</p>
        <Switch
          label={t.showArchived}
          checked={includeArchived}
          onChange={(e) => {
            setList({ status: "loading" });
            setIncludeArchived(e.currentTarget.checked);
          }}
        />
      </div>

      {list.status === "loading" ? (
        <SkeletonGroup label={t.loading}>
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
        </SkeletonGroup>
      ) : list.status === "error" ? (
        <div
          role="alert"
          className="flex flex-col items-start gap-3 rounded-lg border border-solid border-border p-4"
        >
          <p className="text-sm text-text">{t.loadFailed}</p>
          <p className="text-sm text-text-muted">{list.message}</p>
          <Button variant="secondary" onClick={reload}>
            {t.retry}
          </Button>
        </div>
      ) : list.items.length === 0 ? (
        <EmptyState title={t.empty.title} description={t.empty.description} />
      ) : (
        <div
          role="region"
          aria-labelledby={captionId}
          tabIndex={0}
          className="overflow-x-auto rounded-lg border border-solid border-border"
        >
          <table className="w-full border-collapse text-sm">
            <caption id={captionId} className="sr-only">
              {t.tableCaption}
            </caption>
            <thead>
              <tr className="border-b border-solid border-border bg-bg-subtle text-left">
                {[
                  t.columns.name,
                  t.columns.contents,
                  t.columns.createdBy,
                  t.columns.date,
                  t.columns.status,
                  t.columns.actions,
                ].map((label) => (
                  <th
                    key={label}
                    scope="col"
                    className="px-3 py-2 font-mono text-label font-normal tracking-[0.04em] whitespace-nowrap text-text-muted uppercase"
                  >
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {list.items.map((item) => (
                <tr
                  key={item.id}
                  className="border-b border-solid border-border last:border-b-0"
                >
                  <th
                    scope="row"
                    className="max-w-64 px-3 py-2 text-left font-medium break-words text-text"
                  >
                    {item.name}
                  </th>
                  <td className="min-w-48 px-3 py-2 text-text-muted">
                    {summary(item)}
                  </td>
                  <td className="px-3 py-2 text-text-muted">
                    {item.created_by?.name || t.unknownCreator}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-text-muted">
                    {formatDateInZone(new Date(item.created_at), locale)}
                  </td>
                  <td className="px-3 py-2">
                    <Badge tone={item.archived ? "neutral" : "success"}>
                      {item.archived ? t.status.archived : t.status.active}
                    </Badge>
                  </td>
                  <td className="px-3 py-1">
                    {item.can_manage ? (
                      <div className="flex flex-wrap items-center gap-1">
                        <Button
                          variant="text"
                          aria-label={t.actions.renameLabel(item.name)}
                          disabled={busyId !== null}
                          onClick={() => setRenaming(item)}
                        >
                          {t.actions.rename}
                        </Button>
                        <Button
                          variant="text"
                          loading={busyId === item.id}
                          disabled={busyId !== null && busyId !== item.id}
                          aria-label={
                            item.archived
                              ? t.actions.restoreLabel(item.name)
                              : t.actions.archiveLabel(item.name)
                          }
                          onClick={() => void toggleArchive(item)}
                        >
                          {item.archived
                            ? t.actions.restore
                            : t.actions.archive}
                        </Button>
                        <ConfirmDialog
                          trigger={
                            <Button
                              variant="text"
                              className="text-danger"
                              aria-label={t.actions.deleteLabel(item.name)}
                            >
                              {t.actions.delete}
                            </Button>
                          }
                          title={t.confirmDelete.title(item.name)}
                          description={t.confirmDelete.description}
                          confirmLabel={t.confirmDelete.confirm}
                          onConfirm={() => remove(item)}
                        />
                      </div>
                    ) : (
                      <span className="inline-flex min-h-11 items-center text-xs text-text-muted sm:min-h-9">
                        {t.readOnlyHint}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <RenameDialog
        item={renaming}
        onClose={() => setRenaming(null)}
        onRenamed={(item) => {
          setRenaming(null);
          toast({ title: t.renamed(item.name), tone: "success" });
          replace(item);
        }}
      />
    </div>
  );
}

function RenameDialog({
  item,
  onClose,
  onRenamed,
}: {
  item: ProjectTemplate | null;
  onClose: () => void;
  onRenamed: (item: ProjectTemplate) => void;
}) {
  return (
    <Dialog open={item !== null} onOpenChange={(open) => !open && onClose()}>
      {item ? (
        <RenameForm key={item.id} item={item} onRenamed={onRenamed} />
      ) : null}
    </Dialog>
  );
}

function RenameForm({
  item,
  onRenamed,
}: {
  item: ProjectTemplate;
  onRenamed: (item: ProjectTemplate) => void;
}) {
  const { t: strings } = useI18n();
  const t = strings.projectTemplates;
  const [name, setName] = useState(item.name);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const value = normalizeTemplateName(name);
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
    const result = await patchProjectTemplate(item.id, { name: value });
    setPending(false);
    if (result.ok) {
      onRenamed(result.data.data);
      return;
    }
    setError(apiErrorText(strings, result.error));
  }

  return (
    <DialogContent
      aria-describedby={undefined}
      onInteractOutside={(event) => pending && event.preventDefault()}
    >
      <DialogTitle className="pr-8 font-display text-display-sm">
        {t.renameDialog.title}
        <span aria-hidden="true" className="text-accent">
          .
        </span>
      </DialogTitle>
      <form noValidate onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Field label={t.renameDialog.nameLabel} error={error ?? undefined}>
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
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <DialogClose asChild>
            <Button variant="secondary" disabled={pending}>
              {strings.ui.cancel}
            </Button>
          </DialogClose>
          <Button
            type="submit"
            loading={pending}
            loadingText={t.renameDialog.saving}
          >
            {t.renameDialog.submit}
          </Button>
        </div>
      </form>
    </DialogContent>
  );
}
