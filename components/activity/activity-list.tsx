"use client";

import { useId } from "react";
import { Avatar } from "@/components/ui/avatar";
import { describeActivity } from "@/lib/activity/message";
import type { ActivityEntry } from "@/lib/activity/model";
import { addDays, groupByVnDay, vnDateOf } from "@/lib/activity/time";
import { useLocale, useStrings } from "@/lib/i18n/client";
import { formatCalendarDate, formatTimeInZone } from "@/lib/i18n/format";

/**
 * Danh sách nhật ký nhóm theo ngày giờ Việt Nam, mới nhất trước (mockup v3 bp-Activity.dc.html):
 * số thứ tự, chữ cái đầu người làm, câu "<người> <việc>", chi tiết trước → sau, giờ. Dùng cho trang
 * nhật ký dự án và mục nhật ký trong chi tiết task (`compact`: không avatar, không số thứ tự).
 */
export function ActivityList({
  entries,
  today,
  compact = false,
  headingLevel = 3,
}: {
  entries: readonly ActivityEntry[];
  /** Ngày hôm nay theo giờ Việt Nam (YYYY-MM-DD), để ghi "Hôm nay", "Hôm qua". */
  today: string;
  compact?: boolean;
  headingLevel?: 3 | 4;
}) {
  const strings = useStrings();
  const t = strings.activity;
  const locale = useLocale();
  const baseId = useId();
  const Heading = `h${headingLevel}` as const;
  // Số thứ tự liên tục qua các nhóm ngày (1 = mới nhất).
  const order = new Map(entries.map((e, i) => [e.id, i + 1]));

  return (
    <div className="flex min-w-0 flex-col gap-5">
      {groupByVnDay(entries).map((group) => {
        const date = formatCalendarDate(group.day, locale) ?? group.day;
        const relative =
          group.day === today
            ? t.today
            : group.day === addDays(today, -1)
              ? t.yesterday
              : null;
        const headingId = `${baseId}-${group.day}`;
        return (
          <section
            key={group.day}
            aria-labelledby={headingId}
            className="flex min-w-0 flex-col gap-2"
          >
            <Heading
              id={headingId}
              className="label flex flex-wrap items-center gap-2"
            >
              {relative ? (
                <>
                  <span>{relative}</span>
                  <span aria-hidden="true">·</span>
                </>
              ) : null}
              <span>{date}</span>
            </Heading>
            <ol className="m-0 flex list-none flex-col p-0">
              {group.items.map((entry) => (
                <ActivityItem
                  key={entry.id}
                  entry={entry}
                  index={order.get(entry.id) ?? 0}
                  compact={compact}
                />
              ))}
            </ol>
          </section>
        );
      })}
    </div>
  );
}

function ActivityItem({
  entry,
  index,
  compact,
}: {
  entry: ActivityEntry;
  index: number;
  compact: boolean;
}) {
  const strings = useStrings();
  const locale = useLocale();
  const message = describeActivity(entry, strings, locale);
  const at = new Date(entry.created_at);
  const time = formatTimeInZone(at, locale);
  const fullTime = `${formatCalendarDate(vnDateOf(at), locale) ?? ""} ${time}`;

  return (
    <li
      className="flex min-w-0 items-start gap-3 border-0 border-b border-solid border-border py-3 last:border-b-0"
      data-activity-id={entry.id}
    >
      {compact ? null : (
        <>
          <span
            aria-hidden="true"
            className="hidden w-6 shrink-0 pt-1.5 font-mono text-label text-text-muted sm:inline"
          >
            {String(index).padStart(2, "0")}
          </span>
          <Avatar name={message.actor} size="md" />
        </>
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="m-0 text-sm text-text [overflow-wrap:anywhere]">
          <strong className="font-semibold">{message.actor}</strong>{" "}
          {message.summary}
        </p>
        {message.details.length > 0 ? (
          <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
            {message.details.map((line, i) => (
              <li
                key={i}
                className="font-mono text-xs text-text-muted [overflow-wrap:anywhere]"
              >
                {line}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <time
        dateTime={entry.created_at}
        title={fullTime}
        className="shrink-0 pt-0.5 font-mono text-xs text-text-muted"
      >
        {time}
      </time>
    </li>
  );
}
