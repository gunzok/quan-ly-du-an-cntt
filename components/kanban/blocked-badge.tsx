"use client";

import { Badge } from "@/components/ui/badge";
import { AlertIcon } from "@/components/ui/icons";
import { useStrings } from "@/lib/i18n/client";

/**
 * Huy hiệu "Bị chặn" (Story E8-3, BR-06): biểu tượng cảnh báo + chữ, không chỉ dựa vào màu
 * (design-system.md: thẻ task trạng thái bị chặn). `count` = blocked_by_count (tổng số task chặn
 * còn mở).
 */
export function BlockedBadge({
  count,
  className,
}: {
  count: number;
  className?: string;
}) {
  const strings = useStrings();
  const t = strings.blockedTask;
  const title = t.badgeTitle(count);
  return (
    <Badge
      tone="warning"
      icon={<AlertIcon className="size-3" />}
      title={title}
      data-testid="blocked-badge"
      className={className}
    >
      {t.badge}
      <span className="sr-only">: {title}</span>
    </Badge>
  );
}
