"use client";

import { useId, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { ErrorIcon } from "@/components/ui/icons";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { normalizeDescription, type DetailField } from "@/lib/tasks/detail-view";
import { DESCRIPTION_MAX_LENGTH, TITLE_MAX_LENGTH } from "@/lib/tasks/validate";
import type { TaskPatch } from "@/lib/tasks/validate";
import { useStrings } from "@/lib/i18n/client";

type Save = (field: DetailField, patch: TaskPatch) => Promise<boolean>;

function FieldError({ id, message }: { id?: string; message?: string }) {
  if (!message) return null;
  return (
    <p
      id={id}
      role="alert"
      className="flex items-center gap-1.5 text-xs text-danger"
    >
      <ErrorIcon className="size-3.5 shrink-0" />
      {message}
    </p>
  );
}

/**
 * Tiêu đề task (h1) sửa tại chỗ: nút "Sửa tiêu đề" mở ô nhập; Enter hoặc nút Lưu để lưu, Esc hoặc
 * Hủy để thôi. Focus trả về nút Sửa sau khi đóng.
 */
export function TitleEditor({
  title,
  editable,
  serverError,
  save,
}: {
  title: string;
  editable: boolean;
  serverError?: string;
  save: Save;
}) {
  const strings = useStrings();
  const t = strings.taskDetail.title;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const editButtonId = useId();
  const errorId = useId();

  function close() {
    setEditing(false);
    setError(null);
    requestAnimationFrame(() => document.getElementById(editButtonId)?.focus());
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const value = draft.trim();
    if (value === "") return setError(t.required);
    if (value.length > TITLE_MAX_LENGTH) return setError(t.tooLong);
    setPending(true);
    const ok = await save("title", { title: value });
    setPending(false);
    if (ok) close();
  }

  if (!editing) {
    return (
      <div className="flex flex-col gap-1">
        <div className="flex items-start gap-2">
          <h1
            id="task-detail-title"
            className="m-0 min-w-0 flex-1 font-display text-display-sm [overflow-wrap:anywhere]"
          >
            {title}
            <span aria-hidden="true" className="text-accent">
              .
            </span>
          </h1>
          {editable ? (
            <Button
              id={editButtonId}
              variant="text"
              onClick={() => {
                setDraft(title);
                setEditing(true);
              }}
            >
              {t.edit}
            </Button>
          ) : null}
        </div>
        <FieldError message={serverError} />
      </div>
    );
  }

  const shown = error ?? serverError;
  return (
    <form onSubmit={submit} className="flex flex-col gap-2" noValidate>
      <h1 id="task-detail-title" className="sr-only">
        {title}
      </h1>
      <Input
        aria-label={t.label}
        aria-describedby={shown ? errorId : undefined}
        aria-invalid={shown ? true : undefined}
        autoFocus
        value={draft}
        maxLength={TITLE_MAX_LENGTH + 1}
        onChange={(e) => {
          setDraft(e.target.value);
          setError(null);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            close();
          }
        }}
        className="font-display text-xl"
      />
      <FieldError id={errorId} message={shown ?? undefined} />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" loading={pending}>
          {t.save}
        </Button>
        <Button variant="secondary" onClick={close} disabled={pending}>
          {t.cancel}
        </Button>
      </div>
    </form>
  );
}

/**
 * Mô tả: VĂN BẢN THUẦN. Hiển thị bằng nút văn bản của React (tự thoát ký tự), giữ xuống dòng bằng
 * white-space: pre-wrap; không render HTML/Markdown nên không có đường chèn mã (XSS). Định dạng
 * giàu (Markdown) để sau nếu cần, phải qua bộ lọc HTML.
 */
export function DescriptionSection({
  number,
  description,
  editable,
  serverError,
  save,
}: {
  number: string;
  description: string | null;
  editable: boolean;
  serverError?: string;
  save: Save;
}) {
  const strings = useStrings();
  const t = strings.taskDetail.description;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(description ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const openButtonId = useId();
  const headingId = useId();
  const hintId = useId();
  const errorId = useId();

  function close() {
    setEditing(false);
    setError(null);
    requestAnimationFrame(() => document.getElementById(openButtonId)?.focus());
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (draft.length > DESCRIPTION_MAX_LENGTH) return setError(t.tooLong);
    setPending(true);
    const ok = await save("description", {
      description: normalizeDescription(draft),
    });
    setPending(false);
    if (ok) close();
  }

  const shown = error ?? serverError;
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={headingId} className="label m-0 flex items-center gap-2">
          <span
            aria-hidden="true"
            className="inline-block size-1.5 rounded-pill bg-accent"
          />
          {number} / {t.heading}
        </h2>
        {editable && !editing ? (
          <Button
            id={openButtonId}
            variant="text"
            onClick={() => {
              setDraft(description ?? "");
              setEditing(true);
            }}
          >
            {description ? t.edit : t.add}
          </Button>
        ) : null}
      </div>
      {editing ? (
        <form onSubmit={submit} className="flex flex-col gap-2" noValidate>
          <Textarea
            aria-label={t.label}
            aria-describedby={[hintId, shown ? errorId : null]
              .filter(Boolean)
              .join(" ")}
            aria-invalid={shown ? true : undefined}
            autoFocus
            rows={6}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                close();
              }
            }}
          />
          <p id={hintId} className="text-xs text-text-muted">
            {t.hint}
          </p>
          <FieldError id={errorId} message={shown ?? undefined} />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" loading={pending}>
              {t.save}
            </Button>
            <Button variant="secondary" onClick={close} disabled={pending}>
              {t.cancel}
            </Button>
          </div>
        </form>
      ) : (
        <>
          {description ? (
            <p
              data-testid="task-description"
              className="m-0 text-sm leading-[22px] whitespace-pre-wrap [overflow-wrap:anywhere]"
            >
              {description}
            </p>
          ) : (
            <p className="m-0 text-sm text-text-muted">{t.empty}</p>
          )}
          <FieldError message={serverError} />
        </>
      )}
    </section>
  );
}
