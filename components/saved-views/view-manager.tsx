"use client";

import { useId, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import {
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import type { ApiError } from "@/lib/api/errors";
import { apiErrorText } from "@/lib/i18n/api-error";
import { useStrings } from "@/lib/i18n/client";
import {
  createView,
  deleteView,
  updateView,
} from "@/lib/saved-views/client-api";
import {
  canChoosePublic,
  canSaveViews,
  checkViewName,
  classifyWriteError,
  suggestCopyName,
  viewActions,
  type ManageActor,
} from "@/lib/saved-views/manage";
import {
  SAVED_VIEW_NAME_MAX_LENGTH,
  type SavedView,
  type SavedViewQuery,
  type SavedViewVisibility,
} from "@/lib/saved-views/model";

export interface ViewManagerProps {
  projectId: string;
  actor: ManageActor;
  /** Chế độ xem đang chọn (null: cách xem tự chỉnh). */
  view: SavedView | null;
  /** Tên hiển thị (mặc định dùng chung dịch theo ngôn ngữ). */
  label: (view: SavedView) => string;
  /** Cách xem đang hiện trên bảng, theo lược đồ query v1 (toSavedViewQuery). */
  currentQuery: () => SavedViewQuery;
  /** Cách xem đang hiện khác chế độ xem đang chọn. */
  modified: boolean;
  onCreated: (view: SavedView) => void;
  onUpdated: (view: SavedView) => void;
  onDeleted: (view: SavedView) => void;
  /** Danh sách chế độ xem có thể đã cũ (404, 403): tải lại. */
  onStale: () => void;
}

type DialogMode = { kind: "create" } | { kind: "rename" } | null;

/**
 * Nút quản lý chế độ xem (Story E13-3; mockup v3 bp-ListViews.dc.html "Lưu thành chế độ xem
 * mới"): lưu mới, lưu thay đổi, đổi tên, công khai/riêng tư, xóa. Chế độ xem mặc định và chế độ
 * xem công khai của người khác (với Thành viên, Người xem) chỉ đọc: ẩn nút sửa, kèm giải thích.
 * Ẩn nút chỉ là hiển thị; API và RLS kiểm lại (403 được báo thân thiện, rồi tải lại danh sách).
 */
export function ViewManager({
  projectId,
  actor,
  view,
  label,
  currentQuery,
  modified,
  onCreated,
  onUpdated,
  onDeleted,
  onStale,
}: ViewManagerProps) {
  const strings = useStrings();
  const t = strings.savedViewsManage;
  const { toast } = useToast();
  const [dialog, setDialog] = useState<DialogMode>(null);
  const [busy, setBusy] = useState<"save" | "visibility" | null>(null);

  if (!canSaveViews(actor)) return null;
  const actions = view ? viewActions(view, actor) : null;

  /** Lỗi của thao tác ngoài hộp thoại (lưu thay đổi, đổi công khai, xóa). */
  const reportError = (error: ApiError, fallback: string) => {
    const problem = classifyWriteError(error);
    if (problem === "not_found") {
      toast({ title: t.errors.notFound, tone: "error" });
      onStale();
    } else if (problem === "forbidden") {
      toast({
        title: apiErrorText(strings, error),
        description: t.errors.forbiddenReloaded,
        tone: "error",
      });
      onStale();
    } else if (problem === "name_conflict" || problem === "invalid") {
      toast({ title: apiErrorText(strings, error), tone: "error" });
    } else {
      toast({ title: fallback, tone: "error" });
    }
  };

  const patch = async (
    target: SavedView,
    body: Parameters<typeof updateView>[1],
    kind: "save" | "visibility",
    success: string,
  ) => {
    if (busy) return;
    setBusy(kind);
    try {
      const result = await updateView(target.id, body);
      if (!result.ok) {
        reportError(result.error, t.errors.failed);
        return;
      }
      onUpdated(result.data.data);
      toast({ title: success });
    } finally {
      setBusy(null);
    }
  };

  const remove = async (target: SavedView) => {
    const result = await deleteView(target.id);
    if (!result.ok) {
      // Đã bị xóa từ trước: coi như xong, vẫn về chế độ thường.
      if (classifyWriteError(result.error) === "not_found") {
        toast({ title: t.errors.notFound, tone: "error" });
        onDeleted(target);
        onStale();
        return;
      }
      reportError(result.error, t.errors.deleteFailed);
      return;
    }
    toast({ title: t.toast.deleted(label(target)) });
    onDeleted(target);
  };

  return (
    <div className="flex min-w-0 flex-col items-stretch gap-2 sm:items-end">
      <div
        role="group"
        aria-label={t.actionsLabel}
        className="flex flex-wrap items-center gap-2 sm:justify-end"
      >
        {view && actions?.canEdit && modified ? (
          <Button
            loading={busy === "save"}
            loadingText={t.dialog.saving}
            onClick={() =>
              void patch(view, { query: currentQuery() }, "save", t.toast.saved)
            }
          >
            {t.saveChanges}
          </Button>
        ) : null}
        <Button
          variant="secondary"
          onClick={() => setDialog({ kind: "create" })}
        >
          {t.saveNew}
        </Button>
        {view && actions?.canEdit ? (
          <Button
            variant="secondary"
            onClick={() => setDialog({ kind: "rename" })}
          >
            {t.rename}
          </Button>
        ) : null}
        {view && actions?.canPublish ? (
          <Button
            variant="secondary"
            loading={busy === "visibility"}
            loadingText={t.dialog.saving}
            onClick={() =>
              void patch(
                view,
                { visibility: "public" },
                "visibility",
                t.toast.published,
              )
            }
          >
            {t.publish}
          </Button>
        ) : null}
        {view && actions?.canPrivatize ? (
          <Button
            variant="secondary"
            loading={busy === "visibility"}
            loadingText={t.dialog.saving}
            onClick={() =>
              void patch(
                view,
                { visibility: "private" },
                "visibility",
                t.toast.privatized,
              )
            }
          >
            {t.privatize}
          </Button>
        ) : null}
        {view && actions?.canEdit ? (
          <ConfirmDialog
            trigger={<Button variant="text">{t.delete}</Button>}
            title={t.deleteTitle(label(view))}
            description={t.deleteDescription}
            confirmLabel={t.deleteConfirm}
            onConfirm={() => remove(view)}
          />
        ) : null}
      </div>
      {actions?.readOnlyReason ? (
        <p
          className="m-0 max-w-md text-sm text-text-muted sm:text-right"
          data-testid="view-read-only-reason"
        >
          {t.readOnly[actions.readOnlyReason]}
        </p>
      ) : null}
      {dialog ? (
        <ViewNameDialog
          key={dialog.kind}
          mode={dialog.kind}
          initialName={
            dialog.kind === "rename" && view
              ? view.name
              : view
                ? suggestCopyName(label(view), t.dialog.copySuffix)
                : ""
          }
          choosePublic={canChoosePublic(actor)}
          onClose={() => setDialog(null)}
          onSubmit={async (name, visibility) => {
            if (dialog.kind === "rename" && view) {
              const result = await updateView(view.id, { name });
              if (result.ok) {
                onUpdated(result.data.data);
                toast({ title: t.toast.renamed });
              }
              return result;
            }
            const result = await createView(projectId, {
              name,
              query: currentQuery(),
              visibility,
            });
            if (result.ok) {
              onCreated(result.data.data);
              toast({ title: t.toast.created(result.data.data.name) });
            }
            return result;
          }}
          onStale={onStale}
        />
      ) : null}
    </div>
  );
}

/**
 * Hộp thoại tên (lưu mới hoặc đổi tên). Kiểm tên như API trước khi gửi; 409 trùng tên báo ngay
 * dưới ô tên và giữ hộp thoại mở để sửa.
 */
function ViewNameDialog({
  mode,
  initialName,
  choosePublic,
  onClose,
  onSubmit,
  onStale,
}: {
  mode: "create" | "rename";
  initialName: string;
  choosePublic: boolean;
  onClose: () => void;
  onSubmit: (
    name: string,
    visibility: SavedViewVisibility,
  ) => Promise<{ ok: true } | { ok: false; error: ApiError }>;
  onStale: () => void;
}) {
  const strings = useStrings();
  const t = strings.savedViewsManage;
  const d = t.dialog;
  const [name, setName] = useState(initialName);
  const [visibility, setVisibility] = useState<SavedViewVisibility>("private");
  const [nameError, setNameError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const groupId = useId();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const checked = checkViewName(name);
    if (checked.problem) {
      setNameError(
        checked.problem === "required"
          ? d.nameRequired
          : d.nameTooLong(SAVED_VIEW_NAME_MAX_LENGTH),
      );
      return;
    }
    setBusy(true);
    setNameError(null);
    setFormError(null);
    try {
      const result = await onSubmit(
        checked.name,
        choosePublic ? visibility : "private",
      );
      if (result.ok) {
        onClose();
        return;
      }
      const problem = classifyWriteError(result.error);
      const text = apiErrorText(strings, result.error);
      if (problem === "name_conflict") {
        setNameError(text);
      } else if (problem === "not_found") {
        setFormError(t.errors.notFound);
        onStale();
      } else if (problem === "forbidden") {
        setFormError(`${text} ${t.errors.forbiddenReloaded}`);
        onStale();
      } else if (problem === "invalid") {
        setFormError(text);
      } else {
        setFormError(t.errors.failed);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent>
        <DialogTitle>
          {mode === "create" ? d.createTitle : d.renameTitle}
        </DialogTitle>
        <DialogDescription>
          {mode === "create" ? d.createDescription : d.renameDescription}
        </DialogDescription>
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          <Field
            label={d.name}
            hint={d.nameHint(SAVED_VIEW_NAME_MAX_LENGTH)}
            error={nameError ?? undefined}
          >
            {(control) => (
              <Input
                {...control}
                value={name}
                required
                maxLength={SAVED_VIEW_NAME_MAX_LENGTH}
                autoComplete="off"
                autoFocus
                onChange={(e) => {
                  setName(e.target.value);
                  setNameError(null);
                }}
              />
            )}
          </Field>
          {mode === "create" ? (
            choosePublic ? (
              <fieldset className="m-0 flex flex-col gap-1 border-0 p-0">
                <legend className="mb-1 p-0 text-sm font-medium text-text">
                  {d.visibility}
                </legend>
                {(["private", "public"] as const).map((value) => (
                  <label
                    key={value}
                    className="flex min-h-11 cursor-pointer items-start gap-2.5 py-1 text-sm text-text sm:min-h-9"
                  >
                    <input
                      type="radio"
                      name={groupId}
                      value={value}
                      checked={visibility === value}
                      onChange={() => setVisibility(value)}
                      aria-describedby={`${groupId}-${value}`}
                      className="mt-0.5 size-4 shrink-0 cursor-pointer accent-primary"
                    />
                    <span className="flex flex-col">
                      <span className="font-medium">{d[value]}</span>
                      <span
                        id={`${groupId}-${value}`}
                        className="text-xs text-text-muted"
                      >
                        {value === "private" ? d.privateHint : d.publicHint}
                      </span>
                    </span>
                  </label>
                ))}
              </fieldset>
            ) : (
              <p className="m-0 text-sm text-text-muted">{d.privateOnly}</p>
            )
          ) : null}
          {formError ? (
            <p role="alert" className="m-0 text-sm text-danger">
              {formError}
            </p>
          ) : null}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="secondary" disabled={busy} onClick={onClose}>
              {strings.ui.cancel}
            </Button>
            <Button type="submit" loading={busy} loadingText={d.saving}>
              {d.save}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
