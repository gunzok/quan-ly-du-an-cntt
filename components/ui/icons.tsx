import type { ReactNode, SVGProps } from "react";

/**
 * Biểu tượng nét 1,5 px tự vẽ cho component nền. Chưa cài bộ Lucide vì design-system.md mục 4
 * còn đánh dấu [CẦN XÁC NHẬN]. Luôn trang trí (aria-hidden): nghĩa phải có ở chữ đi kèm.
 */
type IconProps = Omit<SVGProps<SVGSVGElement>, "children">;

function Icon({
  children,
  className,
  ...props
}: IconProps & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className ?? "size-4 shrink-0"}
      {...props}
    >
      {children}
    </svg>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3 8.5l3 3 7-7" />
    </Icon>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 4l8 8M12 4l-8 8" />
    </Icon>
  );
}

export function AlertIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M8 2l6.5 11.5h-13z" />
      <path d="M8 6.5v3M8 11.5v.01" />
    </Icon>
  );
}

export function ErrorIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="8" cy="8" r="6.25" />
      <path d="M8 4.5v4M8 11v.01" />
    </Icon>
  );
}

export function CircleIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="8" cy="8" r="5.25" />
    </Icon>
  );
}

export function HalfCircleIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="8" cy="8" r="5.25" />
      <path d="M8 2.75v10.5a5.25 5.25 0 000-10.5z" fill="currentColor" />
    </Icon>
  );
}

export function ClockIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="8" cy="8" r="6.25" />
      <path d="M8 4.75V8l2.25 1.5" />
    </Icon>
  );
}

/** Mũi tên tăng dần theo mức ưu tiên: số vạch = mức (1..4). */
export function PriorityIcon({
  level,
  ...props
}: IconProps & { level: 1 | 2 | 3 | 4 }) {
  const bars = [
    { x: 2.5, h: 3 },
    { x: 6, h: 6 },
    { x: 9.5, h: 9 },
    { x: 13, h: 12 },
  ];
  return (
    <Icon {...props}>
      {bars.map((bar, index) => (
        <path
          key={bar.x}
          d={`M${bar.x} 14v-${bar.h}`}
          strokeOpacity={index < level ? 1 : 0.3}
        />
      ))}
    </Icon>
  );
}

export function SpinnerIcon({ className, ...props }: IconProps) {
  return (
    <Icon className={className ?? "size-4 shrink-0 animate-spin"} {...props}>
      <path d="M8 1.75A6.25 6.25 0 1 1 1.75 8" />
    </Icon>
  );
}
