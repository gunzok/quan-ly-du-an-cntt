import type { TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/cn";
import { controlClass } from "./field";

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement>;

/** Ô nhập nhiều dòng, kéo giãn theo chiều dọc. */
export function Textarea({ className, rows = 4, ...props }: TextareaProps) {
  return (
    <textarea
      rows={rows}
      className={cn(controlClass, "min-h-24 resize-y sm:min-h-20", className)}
      {...props}
    />
  );
}
