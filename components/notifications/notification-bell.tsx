"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useCallback, useEffect, useRef, useState } from "react";
import { useStrings } from "@/lib/i18n/client";
import { fetchUnreadCount } from "@/lib/notifications/client-api";
import { badgeLabel } from "@/lib/notifications/format";
import { BellIcon } from "./bell-icon";
import { LiveAnnouncer, type Announcement } from "./live-announcer";
import { NotificationPanel } from "./notification-panel";

/** Chu kỳ hỏi số chưa đọc khi tab đang hiện (không dùng realtime ở E4-1). */
export const UNREAD_POLL_MS = 60_000;

/**
 * Chuông thông báo trong khung ứng dụng (Story E4-1, mockup S16 bp-Notifications.dc.html): nút có
 * huy hiệu số chưa đọc, mở ngăn bên phải (Radix Dialog: giữ focus, Esc đóng, trả focus về chuông).
 * Số chưa đọc: hỏi API nhẹ /notifications/unread-count lúc tải, mỗi 60 giây khi tab hiện, ngay khi
 * tab hiện lại và khi mở ngăn.
 *
 * Thông báo cho trình đọc màn hình (aria-live polite) khi số chưa đọc TĂNG so với lần biết trước:
 *   - Lần đếm đầu tiên sau khi tải trang chỉ làm MỐC, không đọc (số đó đã nằm trong nhãn chuông).
 *     `data-count-ready` bật sau lần đếm đầu (test chờ mốc này trước khi tạo thông báo mới).
 *   - Chỉ nhận phản hồi của lần hỏi MỚI NHẤT: lần hỏi cũ về muộn (mạng chậm) không ghi đè số mới
 *     và không gây đọc hai lần. Số do ngăn báo về (sau khi tải danh sách, đánh dấu đã đọc) cũng
 *     vô hiệu các lần hỏi đang chờ.
 *   - Khi ngăn (modal) mở, Radix đặt aria-hidden cho mọi thứ ngoài ngăn, nên lời thông báo đi qua
 *     vùng live NẰM TRONG ngăn; khi đóng thì qua vùng live cạnh chuông.
 */
export function NotificationBell() {
  const strings = useStrings();
  const t = strings.notifications;
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(0);
  const [ready, setReady] = useState(false);
  const [announcement, setAnnouncement] = useState<Announcement | null>(null);
  const previous = useRef<number | null>(null);
  /** Số thứ tự lần hỏi mới nhất; phản hồi của lần cũ hơn bị bỏ. */
  const latest = useRef(0);

  const applyCount = useCallback(
    (next: number) => {
      const before = previous.current;
      if (before !== null && next > before) {
        const text = t.announceNew(next - before);
        setAnnouncement((prev) => ({ id: (prev?.id ?? 0) + 1, text }));
      }
      previous.current = next;
      setCount(next);
      setReady(true);
    },
    [t],
  );

  /** Số từ ngăn (mới hơn mọi lần hỏi đang chờ). */
  const applyFromPanel = useCallback(
    (next: number) => {
      latest.current += 1;
      applyCount(next);
    },
    [applyCount],
  );

  const refresh = useCallback(async () => {
    const seq = ++latest.current;
    const result = await fetchUnreadCount();
    if (seq !== latest.current) return;
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
          data-count-ready={ready || undefined}
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
            onCountChange={applyFromPanel}
            onNavigate={() => setOpen(false)}
            announcer={
              <LiveAnnouncer
                announcement={announcement}
                testId="notification-live-panel"
              />
            }
          />
        ) : null}
      </DialogPrimitive.Root>
      <LiveAnnouncer announcement={announcement} testId="notification-live" />
    </>
  );
}
