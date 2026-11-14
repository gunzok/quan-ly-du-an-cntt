"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiError } from "@/lib/api/errors";
import { fetchUsers, patchUser } from "@/lib/admin/users/client-api";
import {
  displayName,
  formatLastSignIn,
  initials,
  projectSummary,
} from "@/lib/admin/users/format";
import type { AdminUser } from "@/lib/admin/users/model";
import { SEARCH_MAX_LENGTH } from "@/lib/admin/users/validate";
import { strings } from "@/lib/strings";
import styles from "./admin-users.module.css";
import { ConfirmDialog } from "./confirm-dialog";
import { InviteDialog } from "./invite-dialog";

const t = strings.adminUsers;
const SEARCH_DEBOUNCE_MS = 300;

export interface Department {
  id: string;
  name: string;
}

type ListState =
  | { status: "loading"; items: AdminUser[]; nextCursor: null }
  | { status: "ready"; items: AdminUser[]; nextCursor: string | null }
  | { status: "error"; items: AdminUser[]; nextCursor: null; error: ApiError };

type RowAction = "lock" | "unlock" | "grant" | "revoke";

interface PendingAction {
  user: AdminUser;
  action: RowAction;
}

const ACTION_PATCH: Record<
  RowAction,
  { is_active?: boolean; is_admin?: boolean }
> = {
  lock: { is_active: false },
  unlock: { is_active: true },
  grant: { is_admin: true },
  revoke: { is_admin: false },
};

const ACTION_DONE: Record<RowAction, (name: string) => string> = {
  lock: t.done.locked,
  unlock: t.done.unlocked,
  grant: t.done.granted,
  revoke: t.done.revoked,
};

function confirmText(action: RowAction, name: string) {
  switch (action) {
    case "lock":
      return {
        title: t.confirm.lockTitle(name),
        body: t.confirm.lockBody,
        label: t.lock,
        danger: true,
      };
    case "unlock":
      return {
        title: t.confirm.unlockTitle(name),
        body: t.confirm.unlockBody,
        label: t.unlock,
        danger: false,
      };
    case "grant":
      return {
        title: t.confirm.grantTitle(name),
        body: t.confirm.grantBody,
        label: t.grantAdmin,
        danger: false,
      };
    case "revoke":
      return {
        title: t.confirm.revokeTitle(name),
        body: t.confirm.revokeBody,
        label: t.revokeAdmin,
        danger: true,
      };
  }
}

export function UsersScreen({
  currentUserId,
  departments,
}: {
  currentUserId: string;
  departments: Department[];
}) {
  const [query, setQuery] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [reloadToken, setReloadToken] = useState(0);
  const [list, setList] = useState<ListState>({
    status: "loading",
    items: [],
    nextCursor: null,
  });
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [pendingError, setPendingError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const inviteButtonRef = useRef<HTMLButtonElement>(null);

  // Tải trang đầu mỗi khi từ khóa (đã chờ gõ xong) đổi hoặc bấm Thử lại.
  useEffect(() => {
    const controller = new AbortController();
    fetchUsers({ q: appliedQuery }, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        setList(
          result.ok
            ? {
                status: "ready",
                items: result.data.data,
                nextCursor: result.data.next_cursor,
              }
            : {
                status: "error",
                items: [],
                nextCursor: null,
                error: result.error,
              },
        );
      })
      .catch(() => {
        // Bị hủy do đổi từ khóa: bỏ qua.
      });
    return () => controller.abort();
  }, [appliedQuery, reloadToken]);

  // Chờ người dùng gõ xong rồi mới tìm.
  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed === appliedQuery) return;
    const timer = setTimeout(() => {
      setList({ status: "loading", items: [], nextCursor: null });
      setAppliedQuery(trimmed);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, appliedQuery]);

  const retry = useCallback(() => {
    setList({ status: "loading", items: [], nextCursor: null });
    setReloadToken((n) => n + 1);
  }, []);

  async function loadMore() {
    if (list.status !== "ready" || !list.nextCursor) return;
    setLoadingMore(true);
    setLoadMoreError(null);
    const result = await fetchUsers({
      q: appliedQuery,
      cursor: list.nextCursor,
    });
    setLoadingMore(false);
    if (!result.ok) {
      setLoadMoreError(result.error.message);
      return;
    }
    setList((prev) => {
      const seen = new Set(prev.items.map((u) => u.id));
      return {
        status: "ready",
        items: [
          ...prev.items,
          ...result.data.data.filter((u) => !seen.has(u.id)),
        ],
        nextCursor: result.data.next_cursor,
      };
    });
  }

  function replaceUser(user: AdminUser) {
    setList((prev) =>
      prev.status === "ready"
        ? {
            ...prev,
            items: prev.items.map((u) => (u.id === user.id ? user : u)),
          }
        : prev,
    );
  }

  function openAction(user: AdminUser, action: RowAction) {
    setPendingError(null);
    setPending({ user, action });
  }

  async function runPending() {
    if (!pending) return;
    setWorking(true);
    setPendingError(null);
    const result = await patchUser(
      pending.user.id,
      ACTION_PATCH[pending.action],
    );
    setWorking(false);
    if (!result.ok) {
      setPendingError(result.error.message);
      return;
    }
    replaceUser(result.data.data);
    setAnnouncement(ACTION_DONE[pending.action](displayName(result.data.data)));
    setPending(null);
  }

  function onInvited(user: AdminUser) {
    setInviteOpen(false);
    setList((prev) =>
      prev.status === "ready"
        ? {
            ...prev,
            items: [user, ...prev.items.filter((u) => u.id !== user.id)],
          }
        : prev,
    );
    setAnnouncement(t.invite.success(user.email ?? ""));
  }

  const count = list.status === "ready" ? list.items.length : 0;
  const confirm = pending
    ? confirmText(pending.action, displayName(pending.user))
    : null;

  return (
    <main className={styles.main}>
      <header className={styles.header}>
        <div className={styles.headerText}>
          <span className="label">
            <span className={styles.dot} aria-hidden="true" />
            {list.status === "ready" && !list.nextCursor && !appliedQuery
              ? t.eyebrowCount(count)
              : t.eyebrow}
          </span>
          <h1 className={styles.title}>
            {t.heading}
            <span className={styles.accentDot} aria-hidden="true">
              .
            </span>
          </h1>
          <p className={styles.intro}>{t.intro}</p>
        </div>
        <button
          ref={inviteButtonRef}
          type="button"
          className={styles.primaryButton}
          onClick={() => setInviteOpen(true)}
        >
          {t.invite.open} <span aria-hidden="true">→</span>
        </button>
      </header>

      <div className={styles.content}>
        <form
          role="search"
          className={styles.toolbar}
          onSubmit={(e) => {
            e.preventDefault();
            const trimmed = query.trim();
            if (trimmed !== appliedQuery) {
              setList({ status: "loading", items: [], nextCursor: null });
              setAppliedQuery(trimmed);
            }
          }}
        >
          <label className={styles.search}>
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="M20 20l-4-4" />
            </svg>
            <span className={styles.visuallyHidden}>{t.searchLabel}</span>
            <input
              type="search"
              value={query}
              maxLength={SEARCH_MAX_LENGTH}
              placeholder={t.searchPlaceholder}
              onChange={(e) => setQuery(e.target.value)}
              className={styles.searchInput}
            />
          </label>
        </form>

        <p role="status" aria-live="polite" className={styles.announcement}>
          {announcement}
        </p>

        <UsersTable
          list={list}
          query={appliedQuery}
          currentUserId={currentUserId}
          onAction={openAction}
          onRetry={retry}
        />

        {list.status === "ready" && list.nextCursor && (
          <div className={styles.loadMore}>
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={loadMore}
              disabled={loadingMore}
              aria-busy={loadingMore || undefined}
            >
              {loadingMore ? t.loadingMore : t.loadMore}
            </button>
            {loadMoreError && (
              <p role="alert" className={styles.errorText}>
                {loadMoreError}
              </p>
            )}
          </div>
        )}
      </div>

      <InviteDialog
        open={inviteOpen}
        departments={departments}
        onClose={() => setInviteOpen(false)}
        onInvited={onInvited}
      />

      <ConfirmDialog
        open={pending !== null}
        title={confirm?.title ?? ""}
        body={confirm?.body ?? ""}
        confirmLabel={working ? t.confirm.working : (confirm?.label ?? "")}
        danger={confirm?.danger ?? false}
        working={working}
        error={pendingError}
        onConfirm={runPending}
        onCancel={() => {
          if (!working) setPending(null);
        }}
      />
    </main>
  );
}

function UsersTable({
  list,
  query,
  currentUserId,
  onAction,
  onRetry,
}: {
  list: ListState;
  query: string;
  currentUserId: string;
  onAction: (user: AdminUser, action: RowAction) => void;
  onRetry: () => void;
}) {
  if (list.status === "error") {
    return (
      <div role="alert" className={styles.stateBox}>
        <p className={styles.stateTitle}>{t.loadError}</p>
        <p className={styles.muted}>{list.error.message}</p>
        <button
          type="button"
          className={styles.secondaryButton}
          onClick={onRetry}
        >
          {t.retry}
        </button>
      </div>
    );
  }
  if (list.status === "ready" && list.items.length === 0) {
    return (
      <div className={`${styles.stateBox} blueprint-grid`}>
        <p className={styles.stateTitle}>
          {query ? t.emptySearch(query) : t.empty}
        </p>
      </div>
    );
  }

  return (
    <div className={styles.tableWrap}>
      <table
        className={styles.table}
        aria-busy={list.status === "loading" || undefined}
      >
        <caption className={styles.visuallyHidden}>{t.tableCaption}</caption>
        <thead>
          <tr>
            <th scope="col">
              <span className="label">{t.columns.user}</span>
            </th>
            <th scope="col">
              <span className="label">{t.columns.department}</span>
            </th>
            <th scope="col">
              <span className="label">{t.columns.admin}</span>
            </th>
            <th scope="col">
              <span className="label">{t.columns.projects}</span>
            </th>
            <th scope="col">
              <span className="label">{t.columns.status}</span>
            </th>
            <th scope="col">
              <span className="label">{t.columns.lastSignIn}</span>
            </th>
            <th scope="col">
              <span className={styles.visuallyHidden}>{t.columns.actions}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {list.status === "loading" ? (
            <tr>
              <td colSpan={7} className={styles.loadingCell}>
                <span role="status">{t.loading}</span>
              </td>
            </tr>
          ) : (
            list.items.map((user) => (
              <UserRow
                key={user.id}
                user={user}
                isSelf={user.id === currentUserId}
                onAction={onAction}
              />
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function UserRow({
  user,
  isSelf,
  onAction,
}: {
  user: AdminUser;
  isSelf: boolean;
  onAction: (user: AdminUser, action: RowAction) => void;
}) {
  const name = displayName(user);
  const hintId = `self-hint-${user.id}`;
  return (
    <tr>
      <td>
        <div className={styles.userCell}>
          <span className={styles.avatar} aria-hidden="true">
            {initials(user)}
          </span>
          <span className={styles.userText}>
            <span className={styles.userName}>
              {user.full_name.trim() || t.noName}
              {isSelf && <span className={styles.muted}> {t.you}</span>}
            </span>
            <span className={styles.userEmail}>{user.email}</span>
          </span>
        </div>
      </td>
      <td>
        {user.department ? (
          user.department.name
        ) : (
          <span className={styles.muted}>{t.noDepartment}</span>
        )}
      </td>
      <td>
        <span className={user.is_admin ? styles.badgeAdmin : styles.badge}>
          {user.is_admin ? t.adminYes : t.adminNo}
        </span>
      </td>
      <td className={styles.muted}>{projectSummary(user)}</td>
      <td>
        <span className={`${styles.status} ${styles[`status_${user.status}`]}`}>
          <span className={styles.statusDot} aria-hidden="true" />
          {t.status[user.status]}
        </span>
      </td>
      <td className={styles.mono}>{formatLastSignIn(user.last_sign_in_at)}</td>
      <td className={styles.actionsCell}>
        <div
          role="group"
          aria-label={t.rowActionsLabel(name)}
          className={styles.actions}
        >
          {user.is_admin ? (
            <button
              type="button"
              className={styles.linkButton}
              disabled={isSelf}
              aria-describedby={isSelf ? hintId : undefined}
              onClick={() => onAction(user, "revoke")}
            >
              {t.revokeAdmin}
            </button>
          ) : (
            <button
              type="button"
              className={styles.linkButton}
              disabled={!user.is_active}
              onClick={() => onAction(user, "grant")}
            >
              {t.grantAdmin}
            </button>
          )}
          {user.is_active ? (
            <button
              type="button"
              className={`${styles.linkButton} ${styles.linkDanger}`}
              disabled={isSelf}
              aria-describedby={isSelf ? hintId : undefined}
              onClick={() => onAction(user, "lock")}
            >
              {t.lock}
            </button>
          ) : (
            <button
              type="button"
              className={styles.linkButton}
              onClick={() => onAction(user, "unlock")}
            >
              {t.unlock}
            </button>
          )}
          {isSelf && (
            <span id={hintId} className={styles.visuallyHidden}>
              {t.selfActionHint}
            </span>
          )}
        </div>
      </td>
    </tr>
  );
}
