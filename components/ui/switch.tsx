import type { InputHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";

export type SwitchProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "type" | "children" | "role"
> & {
  label: ReactNode;
};

/**
 * Công tắc bật/tắt: `<input type="checkbox" role="switch">` (mẫu WAI-ARIA), trình đọc màn hình đọc
 * "bật/tắt". Rãnh khi tắt dùng border-strong (đạt 3:1), khi bật dùng primary; núm có viền để vẫn
 * thấy ở cả hai chế độ.
 */
export function Switch({ label, className, ...props }: SwitchProps) {
  return (
    <label
      className={cn(
        "inline-flex min-h-11 cursor-pointer items-center gap-2.5 text-sm text-text has-disabled:cursor-not-allowed has-disabled:text-text-muted sm:min-h-8",
        className,
      )}
    >
      <span className="relative inline-flex h-5 w-9 shrink-0">
        <input
          type="checkbox"
          role="switch"
          className="peer h-5 w-9 cursor-pointer appearance-none rounded-pill bg-border-strong transition-colors checked:bg-primary disabled:cursor-not-allowed disabled:opacity-50"
          {...props}
        />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute top-0.5 left-0.5 size-4 rounded-pill bg-bg transition-transform peer-checked:translate-x-4 peer-disabled:opacity-50"
        />
      </span>
      <span>{label}</span>
    </label>
  );
}
