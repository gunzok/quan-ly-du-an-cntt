"use client";

import Link from "next/link";
import { AlertIcon } from "@/components/ui/icons";
import { useStrings } from "@/lib/i18n/client";
import type { BlockerItem } from "@/lib/tasks/blocked-view";

/** Số task chặn hiện tên trong banner; còn lại gộp "và N task khác" (xem đủ ở mục Quan hệ). */
const SHOWN = 5;

/**
 * Banner cảnh báo task bị chặn ở chi tiết task (Story E8-3, BR-06, mockup S05): biểu tượng + tiêu
 * đề chữ (không chỉ màu), danh sách task chặn chưa xong dạng liên kết. Chỉ cảnh báo: không có bước
 * nào cản hoàn thành task.
 */
export function BlockedBanner({
  projectId,
  items,
}: {
  projectId: string;
  items: readonly BlockerItem[];
}) {
  const strings = useStrings();
  const t = strings.blockedTask;
  if (items.length === 0) return null;
  const shown = items.slice(0, SHOWN);
  const more = items.length - shown.length;
  return (
    <section
      role="note"
      aria-labelledby="blocked-banner-title"
      data-testid="blocked-banner"
      className="flex items-start gap-2 rounded-md border border-solid border-warning bg-bg-subtle px-3 py-2 text-sm"
    >
      <AlertIcon className="mt-0.5 size-4 shrink-0 text-warning" />
      <div className="flex min-w-0 flex-col gap-1">
        <h2
          id="blocked-banner-title"
          className="m-0 text-sm font-semibold text-warning"
        >
          {t.bannerTitle}
        </h2>
        <p className="m-0 text-text-muted">{t.bannerBody}</p>
        <ul
          aria-label={t.listLabel}
          className="m-0 flex list-none flex-col gap-0.5 p-0"
        >
          {shown.map((item, i) => (
            <li key={item.id} className="[overflow-wrap:anywhere]">
              <Link
                href={`/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(item.id)}`}
                className="inline-flex min-h-11 items-center sm:min-h-0"
              >
                {item.title ?? t.unknownTask(i + 1)}
              </Link>
            </li>
          ))}
          {more > 0 ? (
            <li className="text-text-muted">{t.more(more)}</li>
          ) : null}
        </ul>
      </div>
    </section>
  );
}
