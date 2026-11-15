"use client";

import type { ButtonHTMLAttributes, MouseEvent, ReactNode } from "react";
import { cn } from "@/lib/cn";
import { strings } from "@/lib/strings";
import { SpinnerIcon } from "./icons";

export type ButtonVariant = "primary" | "secondary" | "danger" | "text";

/**
 * Lớp chung cho mọi điều khiển bấm được: vùng bấm 44 px trên điện thoại (NFR-10), 36 px từ
 * màn `sm`; chữ, viền, nền đặt rõ vì không dùng preflight của Tailwind.
 */
const base =
  "relative inline-flex min-h-11 select-none items-center justify-center gap-2 whitespace-nowrap rounded-md border border-solid px-3.5 py-2 font-sans text-sm font-medium transition-colors sm:min-h-9 " +
  "cursor-pointer aria-disabled:cursor-not-allowed aria-disabled:opacity-50 aria-busy:cursor-progress " +
  "active:translate-y-px aria-disabled:active:translate-y-0";

const variants: Record<ButtonVariant, string> = {
  primary:
    "border-transparent bg-primary text-on-primary hover:bg-primary-hover active:bg-primary-hover aria-disabled:hover:bg-primary",
  secondary:
    "border-border-strong bg-bg text-primary hover:bg-bg-muted active:bg-bg-muted aria-disabled:hover:bg-bg",
  // Chữ dùng --color-bg: trắng trên đỏ (sáng, 5,90:1), gần đen trên đỏ nhạt (tối, 7,32:1).
  // Chưa có token danger-hover: trộn với --color-text để hover/nhấn TĂNG tương phản ở cả hai
  // chế độ (sáng thì đậm hơn, tối thì sáng hơn). Kiểm tra trong lib/design/tokens.test.ts.
  danger:
    "border-transparent bg-danger text-bg hover:bg-[color-mix(in_srgb,var(--color-danger)_85%,var(--color-text))] active:bg-[color-mix(in_srgb,var(--color-danger)_75%,var(--color-text))] aria-disabled:hover:bg-danger",
  text: "border-transparent bg-transparent text-primary hover:bg-bg-muted active:bg-bg-muted aria-disabled:hover:bg-transparent",
};

export type ButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "disabled"
> & {
  variant?: ButtonVariant;
  /** Không bấm được. Dùng aria-disabled để nút vẫn nhận focus và trình đọc màn hình đọc được. */
  disabled?: boolean;
  /** Đang xử lý: hiện vòng quay, chặn bấm lặp, aria-busy. */
  loading?: boolean;
  /** Chữ thay thế khi đang tải (mặc định giữ chữ cũ). */
  loadingText?: ReactNode;
  /** Biểu tượng hoặc "→" sau chữ (nút điều hướng). */
  trailing?: ReactNode;
};

export function Button({
  variant = "primary",
  disabled = false,
  loading = false,
  loadingText,
  trailing,
  type = "button",
  className,
  children,
  onClick,
  ...props
}: ButtonProps) {
  const blocked = disabled || loading;

  function handleClick(event: MouseEvent<HTMLButtonElement>) {
    if (blocked) {
      // aria-disabled không chặn submit như thuộc tính disabled, nên chặn tại đây.
      event.preventDefault();
      return;
    }
    onClick?.(event);
  }

  return (
    <button
      type={type}
      aria-disabled={blocked || undefined}
      aria-busy={loading || undefined}
      className={cn(base, variants[variant], className)}
      onClick={handleClick}
      {...props}
    >
      {loading ? (
        <>
          <SpinnerIcon />
          <span>{loadingText ?? children}</span>
          {loadingText ? null : (
            <span className="sr-only">{strings.ui.loading}</span>
          )}
        </>
      ) : (
        <>
          {children}
          {trailing ? <span aria-hidden="true">{trailing}</span> : null}
        </>
      )}
    </button>
  );
}
