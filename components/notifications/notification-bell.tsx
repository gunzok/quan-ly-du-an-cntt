"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useCallback, useEffect, useRef, useState } from "react";
import { useStrings } from "@/lib/i18n/client";
import { fetchUnreadCount } from "@/lib/notifications/client-api";
import { badgeLabel } from "@/lib/notifications/format";
import { BellIcon } from "./bell-icon";
import { NotificationPanel } from "./notification-panel";

/** Chu kỳ hỏi số chưa đọc khi tab đang hiện (không dùng realtime ở E4-1). */
export const UNREAD_POLL_MS = 60_000;

/**
 * Chuông thông báo trong khung ứng dụng (Story E4-1, mockup S16 bp-Notifications.dc.html): nút có
 * huy hiệu số chưa đọc, mở ngăn bên phải (Radix Dialog: giữ focus, Esc đóng, trả focus về chuông).
 * Số chưa đọc: hỏi API nhẹ /notifications/unread-count lúc tải, mỗi 60 giây khi tab hiện, ngay khi
 * tab hiện lại và khi mở ngăn. Có thông báo mới thì đọc qua vùng aria-live (polite).
 */
export function NotificationBell() {
  const strings = useStrings();
  const t = strings.notifications;
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(0);
  const [announcement, setAnnouncement] = useState("");
  const previous = useRef<number | null>(null);

  const applyCount = useCallback(
    (next: number) => {
      const before = previous.current;
      if (before !== null && next > before) {
        setAnnouncement(t.announceNew(next - before));
      }
      previous.current = next;
      setCount(next);
    },
    [t],
  );

  const refresh = useCallback(async () => {
    const result = await fetchUnreadCount();
    if (result.ok) applyCount(result.data.data.unread_count);
  }, [applyCount]);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (timer === null)
        timer = setInterval(() => void refresh(), UNREAD_POLL_MS);
    };
    const stop = () => {
      if (timer !== null) clearInterval(timer);
      timer = null;
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        void refresh();
        start();
      } else {
        stop();
      }
    };
    void refresh();
    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refresh]);

  const badge = badgeLabel(count, t.badgeOverflow);

  return (
    <>
      <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
        <DialogPrimitive.Trigger
          aria-label={count > 0 ? t.bellLabelUnread(count) : t.bellLabel}
          data-testid="notification-bell"
          className="relative inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-text hover:bg-bg-muted sm:size-9"
        >
          <BellIcon />
          {badge ? (
            <span
              aria-hidden="true"
              data-testid="notification-badge"
              className="absolute top-1 right-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-pill bg-danger px-1 font-mono text-[10px] leading-none font-medium text-bg sm:top-0 sm:-right-1"
            >
              {badge}
            </span>
          ) : null}
        </DialogPrimitive.Trigger>
        {open ? (
          <NotificationPanel
            unreadCount={count}
            onCountChange={applyCount}
            onNavigate={() => setOpen(false)}
          />
        ) : null}
      </DialogPrimitive.Root>
      <span className="sr-only" role="status" aria-live="polite">
        {announcement}
      </span>
    </>
  );
}
