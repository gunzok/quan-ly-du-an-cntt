"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * Biểu đồ tự viết bằng CSS cho dashboard (Story E5-1), không kéo thư viện biểu đồ.
 * Nguyên tắc trợ năng: số liệu luôn có chữ (không chỉ dựa vào màu); thanh là trang trí
 * (aria-hidden), ngữ nghĩa nằm ở bảng HTML (<table>) để trình đọc màn hình đọc theo hàng/cột.
 * Màu thanh lấy từ token (đạt ≥ 3:1 với nền ở cả sáng và tối, design-system.md).
 */

/** Lớp nền theo tông của thanh; đều là token giao diện, đổi theo chế độ sáng/tối. */
export type BarTone = "todo" | "in_progress" | "done" | "danger" | "primary";

export const BAR_TONE: Record<BarTone, string> = {
  todo: "bg-text-muted",
  in_progress: "bg-primary",
  done: "bg-success",
  danger: "bg-danger",
  primary: "bg-primary",
};

/** Thanh ngang tỉ lệ value/max; max 0 thì rỗng. */
export function Bar({
  value,
  max,
  tone,
  className,
}: {
  value: number;
  max: number;
  tone: BarTone;
  className?: string;
}) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div
      aria-hidden="true"
      className={cn(
        "h-2 w-full overflow-hidden rounded-pill bg-bg-muted",
        className,
      )}
    >
      <div
        className={cn("h-full rounded-pill", BAR_TONE[tone])}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

/** Thanh chồng nhiều đoạn (một hàng), có tóm tắt cho trình đọc màn hình. */
export function StackedBar({
  segments,
  label,
}: {
  segments: { key: string; value: number; tone: BarTone }[];
  /** Tóm tắt đầy đủ bằng chữ (role="img"). */
  label: string;
}) {
  const total = segments.reduce((n, s) => n + s.value, 0);
  return (
    <div
      role="img"
      aria-label={label}
      className="flex h-3 w-full gap-0.5 overflow-hidden rounded-pill bg-bg-muted"
    >
      {total > 0
        ? segments
            .filter((s) => s.value > 0)
            .map((s) => (
              <div
                key={s.key}
                className={BAR_TONE[s.tone]}
                style={{ width: `${(s.value / total) * 100}%` }}
              />
            ))
        : null}
    </div>
  );
}

export interface BarRow {
  key: string;
  /** Ô đầu (tên); có thể kèm huy hiệu. */
  label: ReactNode;
  value: number;
  tone: BarTone;
  /** Các ô số sau thanh (đã định dạng). */
  cells: ReactNode[];
}

/**
 * Bảng có thanh ngang: cột tên, cột thanh (trang trí), các cột số. `caption` là tiêu đề bảng cho
 * trình đọc màn hình (thẻ hiển thị đã có tiêu đề h2 nên caption ẩn).
 */
export function BarTable({
  caption,
  headers,
  rows,
  max,
}: {
  caption: string;
  /** Tên cột: [tên, ...cột số]. Cột thanh không có tên (trang trí). */
  headers: string[];
  rows: BarRow[];
  max: number;
}) {
  return (
    <table className="w-full table-fixed border-collapse text-sm">
      <caption className="sr-only">{caption}</caption>
      <thead>
        <tr className="text-left">
          <th scope="col" className="label pb-2 font-medium sm:w-[38%]">
            {headers[0]}
          </th>
          {/* Cột thanh: trang trí, ẩn dưới `sm` để 360 px không tràn (số vẫn đủ ở các cột sau). */}
          <td className="hidden pb-2 sm:table-cell" />
          {headers.slice(1).map((h) => (
            <th
              key={h}
              scope="col"
              className="label w-16 pb-2 text-right font-medium sm:w-20"
            >
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr
            key={r.key}
            className="border-0 border-t border-solid border-border"
          >
            <th
              scope="row"
              className="py-2 pr-2 text-left font-normal [overflow-wrap:anywhere]"
            >
              {r.label}
              {/* Dưới `sm` thanh nằm dưới tên thay cho cột thanh. */}
              <Bar
                value={r.value}
                max={max}
                tone={r.tone}
                className="mt-1.5 sm:hidden"
              />
            </th>
            <td className="hidden py-2 pr-2 align-middle sm:table-cell">
              <Bar value={r.value} max={max} tone={r.tone} />
            </td>
            {r.cells.map((c, i) => (
              <td key={i} className="py-2 text-right font-mono tabular-nums">
                {c}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
