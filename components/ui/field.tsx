"use client";

import { useId, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { ErrorIcon } from "./icons";

/** Thuộc tính trợ năng Field truyền cho ô nhập bên trong. */
export type FieldControlProps = {
  id: string;
  "aria-describedby"?: string;
  "aria-invalid"?: true;
};

export type FieldProps = {
  label: ReactNode;
  /** Gợi ý dưới ô (luôn hiện). */
  hint?: ReactNode;
  /** Thông báo lỗi: có giá trị thì ô ở trạng thái lỗi, có biểu tượng và chữ (không chỉ màu). */
  error?: ReactNode;
  className?: string;
  children: (control: FieldControlProps) => ReactNode;
};

/**
 * Nhãn, gợi ý, lỗi cho một ô nhập. Nối id bằng useId: nhãn `htmlFor`, gợi ý và lỗi qua
 * `aria-describedby`, lỗi bật `aria-invalid`.
 */
export function Field({ label, hint, error, className, children }: FieldProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-sm font-medium text-text">
        {label}
      </label>
      {children({
        id,
        "aria-describedby": describedBy,
        "aria-invalid": error ? true : undefined,
      })}
      {hint ? (
        <p id={hintId} className="text-xs font-normal text-text-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p
          id={errorId}
          className="flex items-center gap-1.5 text-xs text-danger"
        >
          <ErrorIcon className="size-3.5 shrink-0" />
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Kiểu chung của Input, Textarea, Select: viền border-strong (4,76:1, đạt 3:1 cho điều khiển),
 * lỗi viền danger, disabled mờ. Chữ 16 px trên điện thoại (tránh trình duyệt tự phóng to),
 * 14 px từ `sm`; cao tối thiểu 44 px trên điện thoại.
 */
export const controlClass =
  "block w-full min-h-11 rounded-md border border-solid border-border-strong bg-bg px-3 py-2 font-sans text-base text-text placeholder:text-text-muted sm:min-h-9 sm:text-sm " +
  "hover:border-text-muted aria-invalid:border-danger aria-invalid:hover:border-danger " +
  "disabled:cursor-not-allowed disabled:bg-bg-subtle disabled:text-text-muted disabled:hover:border-border-strong";
