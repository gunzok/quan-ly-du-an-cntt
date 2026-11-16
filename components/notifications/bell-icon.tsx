import type { SVGProps } from "react";

/**
 * Biểu tượng chuông nét 1,5 px cùng kiểu components/ui/icons.tsx (để trong thư mục thông báo để
 * không chạm file dùng chung). Trang trí: nghĩa nằm ở aria-label của nút.
 */
export function BellIcon(props: Omit<SVGProps<SVGSVGElement>, "children">) {
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
      className="size-5 shrink-0"
      {...props}
    >
      <path d="M4 6.5a4 4 0 0 1 8 0c0 3.5 1.5 4.5 1.5 4.5h-11S4 10 4 6.5z" />
      <path d="M6.75 13.25a1.4 1.4 0 0 0 2.5 0" />
    </svg>
  );
}
