"use client";

import { useEffect, useId, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { AlertIcon, ErrorIcon } from "@/components/ui/icons";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { putMember, searchUsers } from "@/lib/project-members/client-api";
import {
  PROJECT_ROLES,
  SEARCH_Q_MAX,
  SEARCH_Q_MIN,
  displayName,
  type ProjectMember,
  type ProjectRole,
  type UserCandidate,
} from "@/lib/project-members/model";
import type { ApiError } from "@/lib/api/errors";
import { apiErrorText } from "@/lib/i18n/api-error";
import { useStrings } from "@/lib/i18n/client";
import type { Messages } from "@/lib/i18n/messages";

function roleOptions(roles: Messages["projects"]["roles"]) {
  return PROJECT_ROLES.map((role) => ({ value: role, label: roles[role] }));
}
/** Chờ người dùng ngừng gõ rồi mới tìm (đỡ tốn lượt giới hạn tần suất). */
const SEARCH_DEBOUNCE_MS = 250;

function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="flex items-center gap-1.5 text-sm text-danger">
      <ErrorIcon className="size-4 shrink-0" />
      {message}
    </p>
  );
}

type SearchState =
  | { status: "idle" }
  | { status: "searching" }
  | { status: "ready"; q: string; users: UserCandidate[] }
  | { status: "error"; error: ApiError };

/** Hộp thoại thêm thành viên: tìm người (họ tên/email), chọn một người, chọn vai trò. */
export function AddMemberDialog({
  projectId,
  open,
  onOpenChange,
  onAdded,
}: {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdded: (member: ProjectMember) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open ? <AddBody projectId={projectId} onAdded={onAdded} /> : null}
    </Dialog>
  );
}

function AddBody({
  projectId,
  onAdded,
}: {
  projectId: string;
  onAdded: (member: ProjectMember) => void;
}) {
  const strings = useStrings();
  const t = strings.projectMembers;
  const resultsId = useId();
  const [q, setQ] = useState("");
  const [search, setSearch] = useState<SearchState>({ status: "idle" });
  const [picked, setPicked] = useState<string | null>(null);
  const [role, setRole] = useState<ProjectRole>("member");
  const [pickError, setPickError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const trimmed = q.trim().replace(/\s+/g, " ");

  useEffect(() => {
    if (trimmed.length < SEARCH_Q_MIN) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setSearch({ status: "searching" });
      searchUsers(trimmed, projectId, controller.signal)
        .then((result) => {
          if (controller.signal.aborted) return;
          setSearch(
            result.ok
              ? { status: "ready", q: trimmed, users: result.data.data }
              : { status: "error", error: result.error },
          );
        })
        .catch((error: unknown) => {
          if ((error as { name?: string }).name !== "AbortError") throw error;
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [trimmed, projectId]);

  const tooShort = trimmed.length < SEARCH_Q_MIN;
  const users = !tooShort && search.status === "ready" ? search.users : [];
  const pickedUser = users.find((u) => u.id === picked) ?? null;
  const statusText = tooShort
    ? t.addDialog.searchHint
    : search.status === "searching"
      ? t.addDialog.searching
      : search.status === "ready"
        ? search.users.length === 0
          ? t.addDialog.noResults
          : t.addDialog.resultCount(search.users.length)
        : "";

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setFormError(null);
    if (!pickedUser) {
      setPickError(t.addDialog.pickRequired);
      return;
    }
    setPickError(null);
    setPending(true);
    const result = await putMember(projectId, pickedUser.id, role);
    setPending(false);
    if (result.ok) {
      onAdded(result.data.data);
      return;
    }
    setFormError(apiErrorText(strings, result.error));
  }

  return (
    <DialogContent>
      <DialogTitle>{t.addDialog.title}</DialogTitle>
      <DialogDescription>{t.addDialog.description}</DialogDescription>
      <form noValidate onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Field label={t.addDialog.search}>
          {(control) => (
            <Input
              {...control}
              type="search"
              autoComplete="off"
              maxLength={SEARCH_Q_MAX}
              placeholder={t.addDialog.searchPlaceholder}
              value={q}
              aria-controls={resultsId}
              onChange={(e) => {
                setQ(e.target.value);
                setPicked(null);
              }}
            />
          )}
        </Field>
        <p role="status" className="min-h-5 text-xs text-text-muted">
          {statusText}
        </p>
        {search.status === "error" && !tooShort ? (
          <FormError message={apiErrorText(strings, search.error)} />
        ) : null}
        <fieldset
          id={resultsId}
          className="m-0 flex min-w-0 flex-col gap-1 border-0 p-0"
          aria-describedby={pickError ? `${resultsId}-error` : undefined}
        >
          <legend className="mb-1 text-sm font-medium text-text">
            {t.addDialog.results}
          </legend>
          {users.length > 0 ? (
            <ul className="m-0 flex max-h-60 list-none flex-col overflow-y-auto rounded-md border border-solid border-border p-0">
              {users.map((user) => (
                <li
                  key={user.id}
                  className="border-0 border-t border-solid border-border first:border-t-0"
                >
                  <label className="flex min-h-11 cursor-pointer items-start gap-3 px-3 py-2 hover:bg-bg-muted">
                    <input
                      type="radio"
                      name={`${resultsId}-user`}
                      value={user.id}
                      checked={picked === user.id}
                      onChange={() => {
                        setPicked(user.id);
                        setPickError(null);
                      }}
                      className="mt-1 size-4 shrink-0 accent-primary"
                    />
                    <span className="flex min-w-0 flex-col">
                      <span className="font-medium [overflow-wrap:anywhere]">
                        {displayName(user)}
                      </span>
                      <span className="text-xs text-text-muted [overflow-wrap:anywhere]">
                        {user.email ?? t.noEmail}
                        {user.department ? ` · ${user.department.name}` : null}
                      </span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          ) : null}
          {pickError ? (
            <p
              id={`${resultsId}-error`}
              className="flex items-center gap-1.5 text-xs text-danger"
            >
              <ErrorIcon className="size-3.5 shrink-0" />
              {pickError}
            </p>
          ) : null}
        </fieldset>
        <Field label={t.addDialog.role}>
          {(control) => (
            <Select
              {...control}
              options={roleOptions(strings.projects.roles)}
              value={role}
              onChange={(e) => setRole(e.target.value as ProjectRole)}
            />
          )}
        </Field>
        <FormError message={formError} />
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <DialogClose asChild>
            <Button variant="secondary" type="button" disabled={pending}>
              {strings.ui.cancel}
            </Button>
          </DialogClose>
          <Button type="submit" loading={pending}>
            {t.addDialog.submit}
          </Button>
        </div>
      </form>
    </DialogContent>
  );
}

/** Hộp thoại đổi vai trò một thành viên (cảnh báo khi đổi chính mình, khi là PM cuối cùng). */
export function ChangeRoleDialog({
  projectId,
  member,
  isSelf,
  isLastPm,
  onOpenChange,
  onSaved,
}: {
  projectId: string;
  member: ProjectMember | null;
  isSelf: boolean;
  isLastPm: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (member: ProjectMember, changed: boolean) => void;
}) {
  return (
    <Dialog open={member !== null} onOpenChange={onOpenChange}>
      {member ? (
        <RoleBody
          key={member.user_id}
          projectId={projectId}
          member={member}
          isSelf={isSelf}
          isLastPm={isLastPm}
          onSaved={onSaved}
        />
      ) : null}
    </Dialog>
  );
}

function RoleBody({
  projectId,
  member,
  isSelf,
  isLastPm,
  onSaved,
}: {
  projectId: string;
  member: ProjectMember;
  isSelf: boolean;
  isLastPm: boolean;
  onSaved: (member: ProjectMember, changed: boolean) => void;
}) {
  const strings = useStrings();
  const t = strings.projectMembers;
  const name = displayName(member.user);
  const [role, setRole] = useState<ProjectRole>(member.role);
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setFormError(null);
    setPending(true);
    const result = await putMember(projectId, member.user_id, role);
    setPending(false);
    if (result.ok) {
      onSaved(result.data.data, result.data.data.role !== member.role);
      return;
    }
    setFormError(apiErrorText(strings, result.error));
  }

  return (
    <DialogContent>
      <DialogTitle>{t.roleDialog.title(name)}</DialogTitle>
      <DialogDescription>{t.roleDialog.description}</DialogDescription>
      <form noValidate onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Field label={t.roleDialog.role}>
          {(control) => (
            <Select
              {...control}
              options={roleOptions(strings.projects.roles)}
              value={role}
              onChange={(e) => setRole(e.target.value as ProjectRole)}
            />
          )}
        </Field>
        {isLastPm || (isSelf && member.role === "pm") ? (
          <p className="flex items-start gap-2 rounded-md border border-solid border-border bg-bg-subtle p-3 text-sm text-text">
            <AlertIcon className="mt-0.5 size-4 shrink-0 text-warning" />
            {isLastPm ? t.roleDialog.lastPmWarning : t.roleDialog.selfWarning}
          </p>
        ) : null}
        <FormError message={formError} />
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <DialogClose asChild>
            <Button variant="secondary" type="button" disabled={pending}>
              {strings.ui.cancel}
            </Button>
          </DialogClose>
          <Button type="submit" loading={pending}>
            {t.roleDialog.save}
          </Button>
        </div>
      </form>
    </DialogContent>
  );
}
