import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";
import { strings } from "@/lib/strings";
import {
  AlertIcon,
  CheckIcon,
  CircleIcon,
  ClockIcon,
  HalfCircleIcon,
  PriorityIcon,
} from "./icons";

export type BadgeTone =
  "neutral" | "primary" | "success" | "warning" | "danger" | "new";

/** Màu chữ và viền theo token; tất cả đạt 4,5:1 trên bg, bg-subtle, bg-muted (design-system.md). */
const tones: Record<BadgeTone, string> = {
  neutral: "border-border text-text-muted",
  primary: "border-current text-primary",
  success: "border-current text-success",
  warning: "border-current text-warning",
  danger: "border-current text-danger",
  // Viền hồng trang trí, chữ accent-text (6,30:1).
  new: "border-accent text-accent-text",
};

export type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
  tone?: BadgeTone;
  /** Biểu tượng trước chữ (trang trí). Chữ là bắt buộc: không dùng màu làm tín hiệu duy nhất. */
  icon?: ReactNode;
  children: ReactNode;
};

/** Huy hiệu dạng viên thuốc, phông mono in hoa (Blueprint). */
export function Badge({
  tone = "neutral",
  icon,
  className,
  children,
  ...props
}: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-pill border border-solid px-2 py-0.5 font-mono text-label tracking-[0.04em] whitespace-nowrap uppercase",
        tones[tone],
        className,
      )}
      {...props}
    >
      {icon ? (
        <span aria-hidden="true" className="inline-flex">
          {icon}
        </span>
      ) : null}
      {children}
    </span>
  );
}

const smallIcon = "size-3 shrink-0";

/** Huy hiệu "Mới": chấm hồng trang trí + chữ. */
export function NewBadge({ className }: { className?: string }) {
  return (
    <Badge
      tone="new"
      className={className}
      icon={<span className="block size-1.5 rounded-pill bg-accent" />}
    >
      {strings.ui.badgeNew}
    </Badge>
  );
}

export type TaskStatus = keyof typeof strings.ui.status;

const statusMeta: Record<TaskStatus, { tone: BadgeTone; icon: ReactNode }> = {
  todo: { tone: "neutral", icon: <CircleIcon className={smallIcon} /> },
  in_progress: {
    tone: "primary",
    icon: <HalfCircleIcon className={smallIcon} />,
  },
  done: { tone: "success", icon: <CheckIcon className={smallIcon} /> },
  blocked: { tone: "warning", icon: <AlertIcon className={smallIcon} /> },
  overdue: { tone: "danger", icon: <ClockIcon className={smallIcon} /> },
};

/** Trạng thái task theo nhóm trạng thái (todo, in_progress, done) và cờ bị chặn, trễ hạn. */
export function StatusBadge({
  status,
  className,
}: {
  status: TaskStatus;
  className?: string;
}) {
  const meta = statusMeta[status];
  return (
    <Badge tone={meta.tone} icon={meta.icon} className={className}>
      {strings.ui.status[status]}
    </Badge>
  );
}

export type TaskPriority = keyof typeof strings.ui.priority;

const priorityMeta: Record<
  TaskPriority,
  { tone: BadgeTone; level: 1 | 2 | 3 | 4 }
> = {
  low: { tone: "neutral", level: 1 },
  medium: { tone: "primary", level: 2 },
  high: { tone: "warning", level: 3 },
  urgent: { tone: "danger", level: 4 },
};

/** Mức ưu tiên task (enum task_priority): số vạch + chữ, không chỉ màu. */
export function PriorityBadge({
  priority,
  className,
}: {
  priority: TaskPriority;
  className?: string;
}) {
  const meta = priorityMeta[priority];
  return (
    <Badge
      tone={meta.tone}
      icon={<PriorityIcon level={meta.level} className={smallIcon} />}
      className={className}
    >
      {strings.ui.priority[priority]}
    </Badge>
  );
}
