import type { SelectHTMLAttributes } from "react";
import { cn } from "@/lib/cn";
import { controlClass } from "./field";

export type SelectOption = { value: string; label: string; disabled?: boolean };

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & {
  options: readonly SelectOption[];
  /** Dòng gợi ý đầu danh sách (giá trị rỗng, không chọn được lại). */
  placeholder?: string;
};

/**
 * Danh sách chọn dùng thẻ `<select>` gốc (không dùng Radix Select): bàn phím, trình đọc màn hình
 * và bộ chọn của điện thoại hoạt động sẵn, không thêm gói. Mũi tên vẽ bằng nền SVG.
 */
export function Select({
  options,
  placeholder,
  className,
  ...props
}: SelectProps) {
  return (
    <div className="relative">
      <select
        className={cn(controlClass, "appearance-none pr-9", className)}
        {...props}
      >
        {placeholder ? (
          <option value="" disabled>
            {placeholder}
          </option>
        ) : null}
        {options.map((option) => (
          <option
            key={option.value}
            value={option.value}
            disabled={option.disabled}
          >
            {option.label}
          </option>
        ))}
      </select>
      <svg
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
        className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-text-muted"
      >
        <path d="M4 6l4 4 4-4" />
      </svg>
    </div>
  );
}
