"use client";

import {
  useEffect,
  useId,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { ErrorIcon } from "@/components/ui/icons";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import type { ApiError } from "@/lib/api/errors";
import { cn } from "@/lib/cn";
import type { TaskStatus } from "@/lib/project-config/model";
import {
  createRelation,
  searchRelationTargets,
} from "@/lib/task-relations/client-api";
import type { TaskRelationView } from "@/lib/task-relations/model";
import {
  RELATION_CHOICES,
  canEditTarget,
  choiceHasLag,
  createdView,
  parseLagDays,
  toCreateRequest,
  type RelationChoice,
} from "@/lib/task-relations/relation-ui";
import { SEARCH_Q_MAX_LENGTH } from "@/lib/tasks/search";
import type { Actor } from "@/lib/tasks/policy";
import type { Task } from "@/lib/tasks/model";
import { useStrings } from "@/lib/i18n/client";
import { relationErrorText } from "./relation-errors";

/** Chờ người dùng ngừng gõ rồi mới gọi API tìm (giảm request, giới hạn 300 request/phút). */
const SEARCH_DEBOUNCE_MS = 250;

export interface AddRelationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  task: { id: string; title: string };
  actor: Actor;
  statuses: TaskStatus[];
  /** Quan hệ vừa tạo, nhìn từ task đang xem: thêm ngay vào danh sách. */
  onCreated: (view: TaskRelationView) => void;
  /** Task hoặc quan hệ không còn (404): tải lại phần quan hệ. */
  onStale: () => void;
}

/**
 * Hộp thoại "Thêm quan hệ" (Story E8-2): chọn kiểu (theo góc nhìn task đang xem), độ trễ cho đứng
 * trước / đứng sau, và task đích qua ô tìm (combobox ARIA 1.2: phím mũi tên, Enter). Nội dung chỉ
 * gắn khi mở nên mỗi lần mở là trạng thái mới.
 */
export function AddRelationDialog({
  open,
  onOpenChange,
  ...props
}: AddRelationDialogProps) {
  const strings = useStrings();
  const t = strings.taskRelationsUi;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="add-relation-dialog" className="max-w-lg">
        <DialogTitle className="m-0 pr-10">{t.dialogTitle}</DialogTitle>
        <DialogDescription className="m-0">
          {t.dialogDescription(props.task.title)}
        </DialogDescription>
        <AddRelationForm {...props} onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

type SearchState =
  | { query: string; status: "ready"; items: Task[] }
  | { query: string; status: "error"; error: ApiError };

function AddRelationForm({
  projectId,
  task,
  actor,
  statuses,
  onCreated,
  onStale,
  onDone,
}: Omit<AddRelationDialogProps, "open" | "onOpenChange"> & {
  onDone: () => void;
}) {
  const strings = useStrings();
  const t = strings.taskRelationsUi;
  const kinds = strings.taskDetail.relations.kinds;
  const baseId = useId();
  const listId = `${baseId}-list`;
  const hintId = `${baseId}-hint`;
  const targetErrorId = `${baseId}-target-error`;
  const comboId = `${baseId}-combo`;

  const [choice, setChoice] = useState<RelationChoice>("relates");
  const [lagText, setLagText] = useState("0");
  const [lagError, setLagError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Task | null>(null);
  const [active, setActive] = useState(-1);
  const [targetError, setTargetError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [search, setSearch] = useState<SearchState | null>(null);

  // Tìm task đích (bỏ dấu ở CSDL). Kết quả gắn với từ khóa của nó: khác từ khóa hiện tại là đang tải.
  const keyword = query.trim().slice(0, SEARCH_Q_MAX_LENGTH);
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(
      () => {
        searchRelationTargets(projectId, keyword, controller.signal)
          .then((result) => {
            if (controller.signal.aborted) return;
            setSearch(
              result.ok
                ? {
                    query: keyword,
                    status: "ready",
                    items: result.data.data.filter((x) => x.id !== task.id),
                  }
                : { query: keyword, status: "error", error: result.error },
            );
          })
          .catch((error: unknown) => {
            if ((error as { name?: string }).name !== "AbortError") throw error;
          });
      },
      keyword === "" ? 0 : SEARCH_DEBOUNCE_MS,
    );
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [projectId, keyword, task.id]);

  const loading = !search || search.query !== keyword;
  const items = !loading && search.status === "ready" ? search.items : [];
  const expanded = selected === null;
  const statusName = (id: string | null) =>
    statuses.find((s) => s.id === id)?.name ?? strings.taskDetail.unknown;
  const optionId = (index: number) => `${baseId}-opt-${index}`;
  const editable = (x: Task) => canEditTarget(actor, x);

  function pick(item: Task) {
    if (!editable(item)) return;
    setSelected(item);
    setQuery(item.title);
    setActive(-1);
    setTargetError(null);
    setSubmitError(null);
  }

  function moveActive(next: number) {
    if (items.length === 0) return;
    const index = (next + items.length) % items.length;
    setActive(index);
    document
      .getElementById(optionId(index))
      ?.scrollIntoView({ block: "nearest" });
  }

  function onComboKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (selected) {
        // Mở lại danh sách để đổi task đã chọn.
        setSelected(null);
        return;
      }
      moveActive(active + 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (!selected) moveActive(active <= 0 ? items.length - 1 : active - 1);
    } else if (event.key === "Enter") {
      if (expanded && active >= 0 && items[active]) {
        event.preventDefault();
        pick(items[active]);
      }
    } else if (event.key === "Escape" && expanded && active >= 0) {
      // Esc lần đầu bỏ dòng đang trỏ; lần sau Radix đóng hộp thoại.
      event.preventDefault();
      event.stopPropagation();
      setActive(-1);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    const lag = choiceHasLag(choice) ? parseLagDays(lagText) : 0;
    setTargetError(selected ? null : t.targetRequired);
    setLagError(lag === null ? t.lagInvalid : null);
    if (!selected) {
      document.getElementById(comboId)?.focus();
      return;
    }
    if (lag === null) return;
    setPending(true);
    setSubmitError(null);
    const result = await createRelation(
      toCreateRequest(choice, task.id, selected.id, lag),
    );
    setPending(false);
    if (!result.ok) {
      setSubmitError(relationErrorText(strings, result.error));
      if (result.error.code === "not_found") onStale();
      return;
    }
    onCreated(createdView(result.data.data, choice, selected));
    onDone();
  }

  const kindOptions = RELATION_CHOICES.map((c) => ({
    value: c,
    label: kinds[c],
  }));

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <Field label={t.kindLabel}>
        {(control) => (
          <Select
            {...control}
            name="kind"
            value={choice}
            options={kindOptions}
            onChange={(e) => {
              setChoice(e.target.value as RelationChoice);
              setSubmitError(null);
            }}
          />
        )}
      </Field>

      {choiceHasLag(choice) ? (
        <Field label={t.lagLabel} hint={t.lagHint} error={lagError}>
          {(control) => (
            <Input
              {...control}
              name="lag_days"
              type="number"
              inputMode="numeric"
              min={-365}
              max={365}
              step={1}
              value={lagText}
              onChange={(e) => {
                setLagText(e.target.value);
                setLagError(null);
              }}
            />
          )}
        </Field>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <label htmlFor={comboId} className="text-sm font-medium text-text">
          {t.targetLabel}
        </label>
        <Input
          id={comboId}
          role="combobox"
          autoComplete="off"
          maxLength={SEARCH_Q_MAX_LENGTH}
          aria-expanded={expanded}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={
            expanded && active >= 0 && items[active]
              ? optionId(active)
              : undefined
          }
          aria-describedby={
            [hintId, targetError ? targetErrorId : null]
              .filter(Boolean)
              .join(" ") || undefined
          }
          aria-invalid={targetError ? true : undefined}
          placeholder={t.searchPlaceholder}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSelected(null);
            setActive(-1);
            setTargetError(null);
            setSubmitError(null);
          }}
          onKeyDown={onComboKeyDown}
        />
        <p id={hintId} className="m-0 text-xs text-text-muted">
          {t.searchHint}
        </p>
        {targetError ? (
          <p
            id={targetErrorId}
            className="m-0 flex items-center gap-1.5 text-xs text-danger"
          >
            <ErrorIcon className="size-3.5 shrink-0" />
            {targetError}
          </p>
        ) : null}

        {selected ? (
          <p
            data-testid="relation-target-selected"
            className="m-0 rounded-md border border-solid border-border bg-bg-subtle px-3 py-2 text-sm [overflow-wrap:anywhere]"
          >
            {t.selected(selected.title)}
            <span className="text-text-muted">
              {" "}
              · {statusName(selected.status_id)}
            </span>
          </p>
        ) : null}

        {/* Danh sách luôn có trong DOM để aria-controls trỏ tới; ẩn khi đã chọn. */}
        <ul
          id={listId}
          role="listbox"
          aria-label={t.resultsLabel}
          hidden={!expanded}
          className="m-0 flex list-none flex-col rounded-md border border-solid border-border p-0"
        >
          {items.map((item, index) => {
            const canPick = editable(item);
            return (
              <li
                key={item.id}
                id={optionId(index)}
                role="option"
                aria-selected={index === active}
                aria-disabled={canPick ? undefined : true}
                data-task-id={item.id}
                // Giữ focus ở ô tìm khi bấm chuột (combobox giữ focus).
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(item)}
                className={cn(
                  "flex min-h-11 flex-wrap items-center justify-between gap-x-3 gap-y-0.5 border-0 border-b border-solid border-border px-3 py-1.5 text-sm last:border-b-0 sm:min-h-9",
                  canPick
                    ? "cursor-pointer hover:bg-bg-muted"
                    : "cursor-not-allowed text-text-muted",
                  index === active &&
                    "bg-bg-muted outline-2 -outline-offset-2 outline-primary outline-solid",
                )}
              >
                <span className="min-w-0 [overflow-wrap:anywhere]">
                  {item.title}
                </span>
                <span className="text-xs text-text-muted">
                  {canPick
                    ? statusName(item.status_id)
                    : `${statusName(item.status_id)} · ${t.cannotEditTarget}`}
                </span>
              </li>
            );
          })}
        </ul>
        {expanded ? (
          <p role="status" className="m-0 text-xs text-text-muted empty:hidden">
            {loading
              ? t.searching
              : search?.status === "error"
                ? `${t.searchError} ${relationErrorText(strings, search.error)}`
                : items.length === 0
                  ? t.noResults
                  : ""}
          </p>
        ) : null}
      </div>

      {selected ? (
        <p className="m-0 text-sm text-text-muted [overflow-wrap:anywhere]">
          {t.preview[choice](task.title, selected.title)}
        </p>
      ) : null}

      {submitError ? (
        <p
          role="alert"
          data-testid="add-relation-error"
          className="m-0 flex items-start gap-2 rounded-md border border-solid border-danger bg-bg-subtle px-3 py-2 text-sm text-danger"
        >
          <ErrorIcon className="mt-0.5 size-4 shrink-0" />
          <span>
            {t.addFailed} {submitError}
          </span>
        </p>
      ) : null}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={onDone} disabled={pending}>
          {strings.ui.cancel}
        </Button>
        <Button type="submit" loading={pending}>
          {t.submit}
        </Button>
      </div>
    </form>
  );
}
