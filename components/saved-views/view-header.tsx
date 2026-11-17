"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CloseIcon } from "@/components/ui/icons";
import { useStrings } from "@/lib/i18n/client";
import {
  VIEW_ME,
  type SavedView,
  type SavedViewFilters,
} from "@/lib/saved-views/model";

/**
 * Đầu khu bảng khi đang dùng một chế độ xem (Story E13-2; mockup bp-ListViews): "Chế độ xem / Mặc
 * định · Chỉ đọc", tên, ghi chú; báo đã đổi so với chế độ xem kèm nút Đặt lại. Lưu thành chế độ xem
 * mới là E13-3.
 */
export function ViewHeader({
  view,
  name,
  modified,
  onReset,
}: {
  view: SavedView;
  name: string;
  modified: boolean;
  onReset: () => void;
}) {
  const strings = useStrings();
  const t = strings.savedViewsMenu;
  const kind = view.is_default ? "default" : view.visibility;
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="flex min-w-0 flex-col gap-1">
        <span className="label flex flex-wrap items-center gap-2">
          {t.eyebrow} / {t.kind[kind]}
          {view.can_edit ? null : <Badge tone="neutral">{t.readOnly}</Badge>}
        </span>
        <h2
          className="m-0 text-lg font-medium [overflow-wrap:anywhere]"
          data-testid="current-view-name"
        >
          {name}
        </h2>
        <p className="m-0 text-sm text-text-muted">
          {view.is_default
            ? t.defaultNote
            : view.visibility === "public"
              ? t.publicNote
              : t.privateNote}
        </p>
      </div>
      {modified ? (
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="warning">{t.modified}</Badge>
          <Button variant="secondary" onClick={onReset}>
            {t.reset}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Bộ lọc của chế độ xem không có ô riêng trên thanh lọc (chưa hoàn thành, quá hạn, người tạo): hiện
 * thành thẻ có nút bỏ, để người dùng luôn thấy vì sao bảng ít task.
 */
export function ViewFilterChips({
  filters,
  memberName,
  onRemove,
}: {
  filters: SavedViewFilters;
  memberName: (id: string) => string | undefined;
  onRemove: (key: "open" | "overdue" | "created_by") => void;
}) {
  const strings = useStrings();
  const t = strings.savedViewsMenu.chips;
  const chips: { key: "open" | "overdue" | "created_by"; label: string }[] = [];
  if (filters.open) chips.push({ key: "open", label: t.open });
  if (filters.overdue) chips.push({ key: "overdue", label: t.overdue });
  if (filters.created_by) {
    chips.push({
      key: "created_by",
      label:
        filters.created_by === VIEW_ME
          ? t.createdByMe
          : t.createdBy(
              memberName(filters.created_by) ??
                strings.taskList.row.formerMember,
            ),
    });
  }
  if (chips.length === 0) return null;
  return (
    <ul aria-label={t.label} className="m-0 flex list-none flex-wrap gap-2 p-0">
      {chips.map((chip) => (
        <li key={chip.key}>
          <span className="inline-flex min-h-11 items-center gap-1 rounded-pill border border-solid border-primary bg-bg-muted py-0 pr-0 pl-3 sm:pr-1 text-sm font-medium text-primary sm:min-h-9">
            {chip.label}
            <button
              type="button"
              aria-label={t.remove(chip.label)}
              onClick={() => onRemove(chip.key)}
              className="inline-flex size-11 cursor-pointer items-center justify-center rounded-pill border-0 bg-transparent text-primary hover:bg-bg sm:size-7"
            >
              <CloseIcon aria-hidden="true" />
            </button>
          </span>
        </li>
      ))}
    </ul>
  );
}
