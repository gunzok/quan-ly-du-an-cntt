"use client";

import { useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { initials } from "@/lib/initials";

export type AvatarSize = "sm" | "md" | "lg";

const sizes: Record<AvatarSize, string> = {
  sm: "size-6 text-[10px]",
  md: "size-8 text-xs",
  lg: "size-10 text-sm",
};

export type AvatarProps = {
  /** Tên người dùng: làm chữ thay thế cho ảnh và nguồn chữ cái đầu. */
  name: string;
  src?: string | null;
  size?: AvatarSize;
  className?: string;
};

/**
 * Ảnh đại diện; không có ảnh hoặc ảnh lỗi thì hiện chữ cái đầu (role="img" kèm tên).
 * Dùng thẻ img thường: ảnh đại diện có thể đến từ Storage hoặc Google, không qua next/image.
 */
export function Avatar({ name, src, size = "md", className }: AvatarProps) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const showImage = Boolean(src) && failedSrc !== src;
  const shape = cn(
    "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-pill border border-solid border-border bg-bg-muted font-sans font-semibold text-primary",
    sizes[size],
    className,
  );

  if (showImage && src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- ảnh ngoài, kích thước nhỏ cố định
      <img
        src={src}
        alt={name}
        className={cn(shape, "object-cover")}
        onError={() => setFailedSrc(src)}
      />
    );
  }

  return (
    <span role="img" aria-label={name} title={name} className={shape}>
      <span aria-hidden="true">{initials(name)}</span>
    </span>
  );
}

/** Nhóm ảnh đại diện chồng nhau; `label` mô tả cả nhóm cho trình đọc màn hình. */
export function AvatarGroup({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        "flex items-center *:-ml-1.5 *:ring-2 *:ring-bg *:first:ml-0",
        className,
      )}
    >
      {children}
    </div>
  );
}
