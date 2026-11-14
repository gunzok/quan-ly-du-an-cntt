import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * Khối giữ chỗ khi đang tải (trang trí, aria-hidden). Đặt các Skeleton trong SkeletonGroup để
 * trình đọc màn hình nghe được một thông báo "đang tải" duy nhất.
 */
export function Skeleton({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden="true"
      className={cn("h-4 animate-pulse rounded-sm bg-bg-muted", className)}
      {...props}
    />
  );
}

export function SkeletonGroup({
  label,
  className,
  children,
}: {
  /** Ví dụ "Đang tải danh sách task". */
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      role="status"
      aria-busy="true"
      className={cn("flex flex-col gap-2", className)}
    >
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}
