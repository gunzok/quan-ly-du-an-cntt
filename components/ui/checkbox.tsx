import type { InputHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";
import { CheckIcon } from "./icons";

export type CheckboxProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "type" | "children"
> & {
  /** Nhãn hiển thị: cả dòng là vùng bấm (cao 44 px trên điện thoại). */
  label: ReactNode;
};

/**
 * Ô chọn dùng `<input type="checkbox">` gốc (gửi kèm form, bàn phím Space sẵn có), vẽ lại bằng
 * appearance-none. Vòng focus 2 px lấy từ :focus-visible chung trong globals.css.
 */
export function Checkbox({ label, className, ...props }: CheckboxProps) {
  return (
    <label
      className={cn(
        "inline-flex min-h-11 cursor-pointer items-center gap-2.5 text-sm text-text has-disabled:cursor-not-allowed has-disabled:text-text-muted sm:min-h-8",
        className,
      )}
    >
      <span className="relative inline-flex size-4 shrink-0">
        <input
          type="checkbox"
          className="peer size-4 cursor-pointer appearance-none rounded-sm border border-solid border-border-strong bg-bg checked:border-primary checked:bg-primary disabled:cursor-not-allowed disabled:opacity-50"
          {...props}
        />
        <CheckIcon className="pointer-events-none absolute inset-0 hidden size-4 text-on-primary peer-checked:block" />
      </span>
      <span>{label}</span>
    </label>
  );
}
