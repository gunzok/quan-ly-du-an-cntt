"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { cn } from "@/lib/cn";
import { strings } from "@/lib/strings";
import { AlertIcon, CheckIcon, CloseIcon, ErrorIcon } from "./icons";

export type ToastTone = "success" | "error" | "warning";

export type ToastOptions = {
  title: string;
  description?: string;
  tone?: ToastTone;
  /** Thời gian tự đóng (ms). Mặc định 5000; 0 = không tự đóng. */
  duration?: number;
};

type ToastItem = Required<Omit<ToastOptions, "description">> & {
  id: number;
  description?: string;
};

type ToastContextValue = {
  toast: (options: ToastOptions) => number;
  dismiss: (id: number) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

const DEFAULT_DURATION = 5000;

/**
 * Bọc ứng dụng (hoặc một vùng) để dùng useToast(). Vùng thông báo luôn có sẵn trong DOM với
 * role="status" (aria-live="polite") nên trình đọc màn hình đọc được toast mới chèn vào.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);

  const toast = useCallback((options: ToastOptions) => {
    const id = nextId.current++;
    setItems((current) => [
      ...current,
      {
        id,
        title: options.title,
        description: options.description,
        tone: options.tone ?? "success",
        duration: options.duration ?? DEFAULT_DURATION,
      },
    ]);
    return id;
  }, []);

  const value = useMemo(() => ({ toast, dismiss }), [toast, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <section
        aria-label={strings.ui.toast.region}
        className="pointer-events-none fixed inset-x-4 bottom-4 z-50 flex justify-center sm:inset-x-auto sm:right-4"
      >
        <div
          role="status"
          aria-live="polite"
          className="flex w-full max-w-sm flex-col gap-2"
        >
          {items.map((item) => (
            <ToastCard key={item.id} item={item} onDismiss={dismiss} />
          ))}
        </div>
      </section>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast phải dùng bên trong <ToastProvider>.");
  }
  return context;
}

const toneMeta: Record<ToastTone, { icon: ReactNode; className: string }> = {
  success: { icon: <CheckIcon />, className: "text-success" },
  error: { icon: <ErrorIcon />, className: "text-danger" },
  warning: { icon: <AlertIcon />, className: "text-warning" },
};

function ToastCard({
  item,
  onDismiss,
}: {
  item: ToastItem;
  onDismiss: (id: number) => void;
}) {
  // Tạm dừng đếm giờ khi rê chuột hoặc focus vào toast (đủ thời gian đọc, WCAG 2.2.1).
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (item.duration <= 0 || paused) {
      return;
    }
    const timer = window.setTimeout(() => onDismiss(item.id), item.duration);
    return () => window.clearTimeout(timer);
  }, [item.id, item.duration, paused, onDismiss]);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      onDismiss(item.id);
    }
  }

  const meta = toneMeta[item.tone];

  return (
    <div
      className="pointer-events-auto flex items-start gap-3 rounded-lg border border-solid border-border bg-bg p-3 pr-1 font-sans text-sm text-text shadow-pop data-[tone]:animate-fade-in"
      data-tone={item.tone}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      onKeyDown={handleKeyDown}
    >
      <span className={cn("mt-0.5 inline-flex", meta.className)}>
        {meta.icon}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5 py-0.5">
        <p className="font-medium">{item.title}</p>
        {item.description ? (
          <p className="text-text-muted">{item.description}</p>
        ) : null}
      </div>
      <button
        type="button"
        aria-label={strings.ui.toast.dismiss}
        onClick={() => onDismiss(item.id)}
        className="inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-text-muted hover:bg-bg-muted hover:text-text sm:size-8"
      >
        <CloseIcon />
      </button>
    </div>
  );
}
