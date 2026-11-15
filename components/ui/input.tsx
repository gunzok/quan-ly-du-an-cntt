import type { InputHTMLAttributes } from "react";
import { cn } from "@/lib/cn";
import { controlClass } from "./field";

export type InputProps = InputHTMLAttributes<HTMLInputElement>;

/** Ô nhập một dòng. Dùng trong Field để có nhãn, gợi ý, lỗi. */
export function Input({ className, type = "text", ...props }: InputProps) {
  return (
    <input type={type} className={cn(controlClass, className)} {...props} />
  );
}
