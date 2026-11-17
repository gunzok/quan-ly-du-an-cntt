"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton, SkeletonGroup } from "@/components/ui/skeleton";
import { cn } from "@/lib/cn";
import { useStrings } from "@/lib/i18n/client";
import { viewSections, type ViewSections } from "@/lib/saved-views/menu";
import type { SavedView } from "@/lib/saved-views/model";

export type ViewsState =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "ready"; views: SavedView[] };

export interface ViewMenuProps {
  state: ViewsState;
  selectedId: string | null;
  /** Tên hiển thị (mặc định dùng chung dịch theo ngôn ngữ). */
  label: (view: SavedView) => string;
  onSelect: (view: SavedView) => void;
  onToggleFavorite: (view: SavedView) => void;
  onRetry: () => void;
}

const SECTION_ORDER: readonly (keyof ViewSections)[] = [
  "favorites",
  "defaults",
  "shared",
  "mine",
];

/**
 * Menu chế độ xem S12 (Story E13-2; mockup v3 bp-ListViews.dc.html): ô tìm, các mục Yêu thích,
 * Mặc định, Công khai, Riêng tư. Màn rộng (lg) là cột trái luôn mở; màn hẹp gom sau nút "Chế độ
 * xem: …" (aria-expanded) để bảng không bị đẩy xuống. Mọi vai trò (kể cả Người xem) chọn và đánh
 * dấu yêu thích được; lưu, sửa, xóa là Story E13-3.
 */
export function ViewMenu({
  state,
  selectedId,
  label,
  onSelect,
  onToggleFavorite,
  onRetry,
}: ViewMenuProps) {
  const strings = useStrings();
  const t = strings.savedViewsMenu;
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const panelId = useId();
  const searchId = useId();

  const selected =
    state.kind === "ready"
      ? (state.views.find((v) => v.id === selectedId) ?? null)
      : null;

  return (
    <aside
      aria-label={t.regionLabel}
      className="border-0 border-b border-solid border-border bg-bg-subtle px-4 py-3 sm:px-7 lg:w-60 lg:shrink-0 lg:border-r lg:border-b-0 lg:px-4 lg:py-5"
    >
      <Button
        variant="secondary"
        className="w-full justify-between lg:hidden"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        trailing={<span aria-hidden="true">{open ? "▴" : "▾"}</span>}
      >
        <span className="truncate">
          {t.toggle(selected ? label(selected) : t.noneSelected)}
        </span>
      </Button>
      <div
        id={panelId}
        className={cn(
          "mt-3 flex-col gap-4 lg:mt-0 lg:flex",
          open ? "flex" : "hidden",
        )}
      >
        <div className="flex flex-col gap-1.5">
          <label htmlFor={searchId} className="sr-only">
            {t.searchLabel}
          </label>
          <Input
            id={searchId}
            type="search"
            value={search}
            placeholder={t.searchPlaceholder}
            maxLength={100}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        {state.kind === "loading" ? (
          <SkeletonGroup label={t.loading} className="gap-2">
            {[0, 1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-8" />
            ))}
          </SkeletonGroup>
        ) : state.kind === "error" ? (
          <div role="alert" className="flex flex-col items-start gap-2">
            <p className="m-0 text-sm text-text-muted">{t.loadError}</p>
            <Button variant="secondary" onClick={onRetry}>
              {t.retry}
            </Button>
          </div>
        ) : (
          <Sections
            sections={viewSections(state.views, label, search)}
            selectedId={selectedId}
            label={label}
            onSelect={(view) => {
              setOpen(false);
              onSelect(view);
            }}
            onToggleFavorite={onToggleFavorite}
            searching={search.trim() !== ""}
          />
        )}
      </div>
    </aside>
  );
}

function Sections({
  sections,
  selectedId,
  label,
  onSelect,
  onToggleFavorite,
  searching,
}: {
  sections: ViewSections;
  selectedId: string | null;
  label: (view: SavedView) => string;
  onSelect: (view: SavedView) => void;
  onToggleFavorite: (view: SavedView) => void;
  searching: boolean;
}) {
  const strings = useStrings();
  const t = strings.savedViewsMenu;
  const baseId = useId();
  const total = SECTION_ORDER.reduce((n, k) => n + sections[k].length, 0);
  if (searching && total === 0) {
    return <p className="m-0 text-sm text-text-muted">{t.noResults}</p>;
  }
  return (
    <>
      {SECTION_ORDER.map((key) => {
        const items = sections[key];
        // Riêng tư luôn hiện (kèm gợi ý khi trống); mục khác trống thì ẩn.
        if (items.length === 0 && (key !== "mine" || searching)) return null;
        const headingId = `${baseId}-${key}`;
        return (
          <section key={key} aria-labelledby={headingId}>
            <h2 id={headingId} className="label m-0 mb-1.5">
              {t.sections[key]}
            </h2>
            {items.length === 0 ? (
              <p className="m-0 text-sm text-text-muted">{t.mineEmpty}</p>
            ) : (
              <ul className="m-0 flex list-none flex-col p-0">
                {items.map((view) => (
                  <ViewItem
                    key={view.id}
                    view={view}
                    name={label(view)}
                    current={view.id === selectedId}
                    onSelect={onSelect}
                    onToggleFavorite={onToggleFavorite}
                  />
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </>
  );
}

function ViewItem({
  view,
  name,
  current,
  onSelect,
  onToggleFavorite,
}: {
  view: SavedView;
  name: string;
  current: boolean;
  onSelect: (view: SavedView) => void;
  onToggleFavorite: (view: SavedView) => void;
}) {
  const strings = useStrings();
  const t = strings.savedViewsMenu;
  return (
    <li className="flex items-center gap-1">
      <button
        type="button"
        aria-current={current ? "true" : undefined}
        onClick={() => onSelect(view)}
        className={cn(
          "flex min-h-11 min-w-0 flex-1 cursor-pointer items-center rounded-md border-0 px-2 text-left text-sm lg:min-h-9",
          current
            ? "bg-bg-muted font-medium text-primary"
            : "bg-transparent text-text hover:bg-bg-muted",
        )}
      >
        <span className="truncate">{name}</span>
      </button>
      <button
        type="button"
        aria-pressed={view.is_favorite}
        aria-label={
          view.is_favorite ? t.favoriteRemove(name) : t.favoriteAdd(name)
        }
        onClick={() => onToggleFavorite(view)}
        className={cn(
          "inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-base hover:bg-bg-muted lg:size-9",
          view.is_favorite ? "text-primary" : "text-text-muted",
        )}
      >
        <span aria-hidden="true">{view.is_favorite ? "★" : "☆"}</span>
      </button>
    </li>
  );
}
