import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export type EmptyStateProps = {
  title: ReactNode;
  description?: ReactNode;
  /** Hành động chính, thường là một Button. */
  action?: ReactNode;
  /** Cấp tiêu đề theo ngữ cảnh trang (mặc định h2). */
  headingLevel?: 2 | 3 | 4;
  className?: string;
};

/**
 * Trạng thái rỗng (bắt buộc cho mọi danh sách): lưới bản vẽ trang trí, tiêu đề kết thúc bằng
 * chấm hồng aria-hidden (design-system.md mục 0 và 2).
 */
export function EmptyState({
  title,
  description,
  action,
  headingLevel = 2,
  className,
}: EmptyStateProps) {
  const Heading = `h${headingLevel}` as const;
  return (
    <div
      className={cn(
        "blueprint-grid flex flex-col items-center gap-3 rounded-lg border border-dashed border-border px-6 py-12 text-center",
        className,
      )}
    >
      <Heading className="font-display text-display-sm text-text">
        {title}
        <span aria-hidden="true" className="text-accent">
          .
        </span>
      </Heading>
      {description ? (
        <p className="max-w-sm text-sm text-text-muted">{description}</p>
      ) : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
