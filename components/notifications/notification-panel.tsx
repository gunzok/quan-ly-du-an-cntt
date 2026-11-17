"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { CheckIcon, CloseIcon } from "@/components/ui/icons";
import { Skeleton, SkeletonGroup } from "@/components/ui/skeleton";
import { cn } from "@/lib/cn";
import { useLocale, useStrings } from "@/lib/i18n/client";
import {
  fetchNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from "@/lib/notifications/client-api";
import {
  formatNotificationTime,
  notificationText,
} from "@/lib/notifications/format";
import { notificationHref, type Notification } from "@/lib/notifications/model";

type Filter = "unread" | "all";
type LoadState = "loading" | "error" | "ready";

const pill =
  "inline-flex min-h-11 cursor-pointer items-center rounded-pill border border-solid px-3.5 font-sans text-sm sm:min-h-8";

/**
 * Ngăn thông báo (mockup S16): tiêu đề kèm số chưa đọc, lọc Chưa đọc/Tất cả, danh sách (chấm hồng
 * và chữ đậm = chưa đọc), đánh dấu đã đọc từng cái và tất cả, bấm vào thì tới ngăn chi tiết task và
 * đánh dấu đã đọc. Thông báo về task không còn quyền xem: câu trung tính, không có liên kết.
 * Phần cài đặt email trong mockup là E4-2, chưa làm.
 */
export function NotificationPanel({
  unreadCount,
  onCountChange,
  onNavigate,
  announcer,
}: {
  unreadCount: number;
  onCountChange: (count: number) => void;
  onNavigate: () => void;
  /** Vùng aria-live đặt TRONG ngăn: khi modal mở, phần ngoài ngăn bị aria-hidden. */
  announcer: ReactNode;
}) {
  const strings = useStrings();
  const locale = useLocale();
  const t = strings.notifications;
  const [filter, setFilter] = useState<Filter>("unread");
  const [items, setItems] = useState<Notification[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [state, setState] = useState<LoadState>("loading");
  const [loadingMore, setLoadingMore] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [actionError, setActionError] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const linkRefs = useRef(new Map<string, HTMLElement>());

  const [reloadKey, setReloadKey] = useState(0);

  // Tải trang đầu khi mở ngăn, đổi bộ lọc, bấm Thử lại. Trạng thái "đang tải" đặt ở nơi gọi.
  useEffect(() => {
    const controller = new AbortController();
    fetchNotifications({ unread: filter === "unread" }, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        if (!result.ok) {
          setState("error");
          return;
        }
        setItems(result.data.data);
        setNextCursor(result.data.next_cursor);
        onCountChange(result.data.unread_count);
        setNow(new Date());
        setState("ready");
      })
      .catch(() => {
        // Bị hủy khi đóng ngăn hoặc đổi bộ lọc: bỏ qua.
      });
    return () => controller.abort();
  }, [filter, reloadKey, onCountChange]);

  async function loadMore() {
    if (!nextCursor) return;
    setLoadingMore(true);
    const result = await fetchNotifications({
      unread: filter === "unread",
      cursor: nextCursor,
    });
    setLoadingMore(false);
    if (!result.ok) {
      setActionError(true);
      return;
    }
    setItems((prev) => {
      const seen = new Set(prev.map((n) => n.id));
      return [...prev, ...result.data.data.filter((n) => !seen.has(n.id))];
    });
    setNextCursor(result.data.next_cursor);
    onCountChange(result.data.unread_count);
  }

  async function markOne(n: Notification) {
    setBusy((prev) => new Set(prev).add(n.id));
    setActionError(false);
    const result = await markNotificationRead(n.id);
    setBusy((prev) => {
      const next = new Set(prev);
      next.delete(n.id);
      return next;
    });
    if (!result.ok) {
      setActionError(true);
      return;
    }
    setItems((prev) =>
      prev.map((x) =>
        x.id === n.id ? { ...x, read_at: result.data.data.read_at } : x,
      ),
    );
    onCountChange(result.data.unread_count);
    // Nút đánh dấu biến mất: chuyển focus về chính thông báo đó để không mất vị trí.
    linkRefs.current.get(n.id)?.focus();
  }

  async function markAll() {
    setMarkingAll(true);
    setActionError(false);
    const result = await markAllNotificationsRead();
    setMarkingAll(false);
    if (!result.ok) {
      setActionError(true);
      return;
    }
    const at = new Date().toISOString();
    setItems((prev) =>
      prev.map((x) => (x.read_at ? x : { ...x, read_at: at })),
    );
    onCountChange(result.data.data.unread_count);
  }

  function openTask(n: Notification) {
    if (!n.read_at) {
      // Không chờ: điều hướng ngay; số chưa đọc cập nhật lần hỏi tới.
      void markNotificationRead(n.id).then((r) => {
        if (r.ok) onCountChange(r.data.unread_count);
      });
    }
    onNavigate();
  }

  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-text/40 data-[state=open]:animate-fade-in" />
      <DialogPrimitive.Content
        aria-describedby={undefined}
        data-testid="notification-panel"
        className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[500px] flex-col gap-4 overflow-y-auto border-0 border-l border-solid border-border bg-bg px-4 py-5 font-sans text-sm text-text shadow-pop data-[state=open]:animate-fade-in sm:px-6"
      >
        {announcer}
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1.5">
            <span className="label flex items-center gap-2">
              <span
                aria-hidden="true"
                className="inline-block size-1.5 rounded-pill bg-accent"
              />
              {t.eyebrow(unreadCount)}
            </span>
            <DialogPrimitive.Title className="m-0 font-display text-display-sm font-normal text-text">
              {t.heading}
              <span aria-hidden="true" className="text-accent">
                .
              </span>
            </DialogPrimitive.Title>
          </div>
          <DialogPrimitive.Close
            aria-label={strings.ui.close}
            className="inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-text-muted hover:bg-bg-muted hover:text-text sm:size-8"
          >
            <CloseIcon />
          </DialogPrimitive.Close>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div role="group" aria-label={t.filterLabel} className="flex gap-2">
            {(["unread", "all"] as const).map((f) => (
              <button
                key={f}
                type="button"
                aria-pressed={filter === f}
                onClick={() => {
                  if (f === filter) return;
                  setState("loading");
                  setActionError(false);
                  setFilter(f);
                }}
                className={cn(
                  pill,
                  filter === f
                    ? "border-primary bg-bg-muted font-semibold text-primary"
                    : "border-border-strong bg-bg text-text-muted hover:bg-bg-muted",
                )}
              >
                {f === "unread" ? t.filterUnread(unreadCount) : t.filterAll}
              </button>
            ))}
          </div>
          <Button
            variant="text"
            onClick={() => void markAll()}
            disabled={unreadCount === 0}
            loading={markingAll}
          >
            {t.markAllRead}
          </Button>
        </div>

        {actionError ? (
          <p role="alert" className="m-0 text-sm text-danger">
            {t.actionFailed}
          </p>
        ) : null}

        {state === "loading" ? (
          <SkeletonGroup label={t.loading}>
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="flex flex-col gap-2 border-0 border-t border-solid border-border py-3"
              >
                <Skeleton className="w-4/5" />
                <Skeleton className="h-3 w-24" />
              </div>
            ))}
          </SkeletonGroup>
        ) : state === "error" ? (
          <div
            role="alert"
            className="flex flex-col items-start gap-3 rounded-lg border border-solid border-border p-4"
          >
            <p className="m-0 text-sm text-text">{t.loadError}</p>
            <Button
              variant="secondary"
              onClick={() => {
                setState("loading");
                setReloadKey((k) => k + 1);
              }}
            >
              {t.retry}
            </Button>
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            headingLevel={3}
            title={filter === "unread" ? t.emptyUnreadTitle : t.emptyAllTitle}
            description={
              filter === "unread" ? t.emptyUnreadBody : t.emptyAllBody
            }
          />
        ) : (
          <>
            <ul
              className="m-0 flex list-none flex-col p-0"
              data-testid="notification-list"
            >
              {items.map((n) => {
                const text = notificationText(n, t);
                const unread = n.read_at === null;
                const when = formatNotificationTime(
                  n.created_at,
                  now,
                  locale,
                  t,
                );
                const body = (
                  <>
                    {unread ? (
                      <span className="sr-only">{t.unreadMark}: </span>
                    ) : null}
                    {text}
                  </>
                );
                const textClass = cn(
                  "text-sm leading-5 [overflow-wrap:anywhere]",
                  unread ? "font-semibold text-text" : "font-normal text-text",
                );
                return (
                  <li
                    key={n.id}
                    data-testid="notification-item"
                    data-unread={unread || undefined}
                    className="flex items-start gap-3 border-0 border-t border-solid border-border py-2"
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        "mt-4 inline-block size-2 shrink-0 rounded-pill",
                        unread ? "bg-accent" : "bg-border",
                      )}
                    />
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      {n.task_visible ? (
                        <Link
                          href={notificationHref(n)}
                          onClick={() => openTask(n)}
                          ref={(el) => {
                            if (el) linkRefs.current.set(n.id, el);
                            else linkRefs.current.delete(n.id);
                          }}
                          className={cn(
                            textClass,
                            "flex min-h-11 items-center rounded-sm no-underline hover:underline sm:min-h-8",
                          )}
                        >
                          <span>{body}</span>
                        </Link>
                      ) : (
                        <p
                          tabIndex={-1}
                          ref={(el) => {
                            if (el) linkRefs.current.set(n.id, el);
                            else linkRefs.current.delete(n.id);
                          }}
                          className={cn(
                            textClass,
                            "m-0 flex min-h-11 items-center text-text-muted sm:min-h-8",
                          )}
                        >
                          <span>{body}</span>
                        </p>
                      )}
                      <time
                        dateTime={n.created_at}
                        className="font-mono text-xs text-text-muted"
                      >
                        {when}
                      </time>
                    </div>
                    {unread ? (
                      <button
                        type="button"
                        aria-label={t.markReadOf(text)}
                        title={t.markRead}
                        aria-busy={busy.has(n.id) || undefined}
                        onClick={() => void markOne(n)}
                        className="mt-0.5 inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-text-muted hover:bg-bg-muted hover:text-primary sm:size-8"
                      >
                        <CheckIcon />
                      </button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
            {nextCursor ? (
              <Button
                variant="secondary"
                onClick={() => void loadMore()}
                loading={loadingMore}
              >
                {t.loadMore}
              </Button>
            ) : null}
          </>
        )}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
