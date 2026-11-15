"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { strings } from "@/lib/strings";
import { Button } from "./button";
import { CloseIcon } from "./icons";

/**
 * Hộp thoại dựa trên Radix Dialog (giữ focus trong hộp, Esc để đóng, trả focus về nút mở,
 * khóa cuộn nền, aria-labelledby/aria-describedby tự nối).
 */
export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogTitle({
  className,
  ...props
}: DialogPrimitive.DialogTitleProps) {
  return (
    <DialogPrimitive.Title
      className={cn("text-lg text-text", className)}
      {...props}
    />
  );
}

export function DialogDescription({
  className,
  ...props
}: DialogPrimitive.DialogDescriptionProps) {
  return (
    <DialogPrimitive.Description
      className={cn("text-sm text-text-muted", className)}
      {...props}
    />
  );
}

export type DialogContentProps = DialogPrimitive.DialogContentProps & {
  /** Hiện nút X ở góc (mặc định có). */
  showClose?: boolean;
};

export function DialogContent({
  className,
  children,
  showClose = true,
  ...props
}: DialogContentProps) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-text/40 data-[state=open]:animate-fade-in" />
      <DialogPrimitive.Content
        className={cn(
          "fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 flex-col gap-4 overflow-y-auto rounded-lg border border-solid border-border bg-bg p-6 font-sans text-sm text-text shadow-pop",
          "data-[state=open]:animate-fade-in",
          className,
        )}
        {...props}
      >
        {children}
        {showClose ? (
          <DialogPrimitive.Close
            aria-label={strings.ui.close}
            className="absolute top-2 right-2 inline-flex size-11 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-text-muted hover:bg-bg-muted hover:text-text sm:size-8"
          >
            <CloseIcon />
          </DialogPrimitive.Close>
        ) : null}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export type ConfirmDialogProps = {
  /** Phần tử mở hộp thoại (thường là Button), bọc bằng Radix Trigger asChild. */
  trigger: ReactNode;
  title: ReactNode;
  description: ReactNode;
  confirmLabel: ReactNode;
  cancelLabel?: ReactNode;
  /** "danger" cho xóa vĩnh viễn (BR-11). */
  tone?: "primary" | "danger";
  /** Chạy khi xác nhận; trả Promise thì nút hiện đang tải tới khi xong rồi đóng hộp thoại. */
  onConfirm: () => void | Promise<void>;
};

/**
 * Hộp thoại xác nhận (role="alertdialog"): không đóng khi bấm ra ngoài, focus mặc định vào nút
 * Hủy để tránh xác nhận nhầm bằng Enter.
 */
export function ConfirmDialog({
  trigger,
  title,
  description,
  confirmLabel,
  cancelLabel = strings.ui.cancel,
  tone = "danger",
  onConfirm,
}: ConfirmDialogProps) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);

  async function handleConfirm() {
    setPending(true);
    try {
      await onConfirm();
      setOpen(false);
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && setOpen(next)}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent
        role="alertdialog"
        showClose={false}
        onInteractOutside={(event) => event.preventDefault()}
      >
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <DialogClose asChild>
            <Button variant="secondary" disabled={pending}>
              {cancelLabel}
            </Button>
          </DialogClose>
          <Button
            variant={tone === "danger" ? "danger" : "primary"}
            loading={pending}
            onClick={handleConfirm}
          >
            {confirmLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
