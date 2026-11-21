"use client";

import { useEffect, useState } from "react";
import { Skeleton, SkeletonGroup } from "@/components/ui/skeleton";
import { cn } from "@/lib/cn";
import { useI18n } from "@/lib/i18n/client";
import { formatNumber } from "@/lib/i18n/format";
import { fetchProjectTemplates } from "@/lib/project-templates/client-api";
import type { ProjectTemplate } from "@/lib/project-templates/model";

/**
 * Phần "Bắt đầu từ" của hộp thoại tạo dự án (S13, mockup v3 bp-CreateProject.dc.html, Story E7-1):
 * "Dự án trống" hoặc một template dự án đang dùng. Nhóm nút radio gốc trong fieldset (phím mũi tên
 * chọn, trình đọc màn hình đọc nhãn và ghi chú). Lỗi tải danh sách không chặn tạo dự án trống.
 */
export function TemplatePicker({
  value,
  onChange,
  disabled,
}: {
  /** null: dự án trống. */
  value: string | null;
  onChange: (templateId: string | null) => void;
  disabled?: boolean;
}) {
  const { t: strings, locale } = useI18n();
  const t = strings.projectTemplates;
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "error" }
    | { status: "ready"; items: ProjectTemplate[] }
  >({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    fetchProjectTemplates({}, controller.signal)
      .then((result) =>
        setState(
          result.ok
            ? { status: "ready", items: result.data.data }
            : { status: "error" },
        ),
      )
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  const n = (v: number) => formatNumber(v, locale);
  const options: { id: string | null; name: string; note: string }[] = [
    { id: null, name: t.create.blank, note: t.create.blankNote },
    ...(state.status === "ready"
      ? state.items.map((item) => ({
          id: item.id,
          name: item.name,
          note: t.summary(
            n(item.summary.statuses),
            n(item.summary.task_types),
            n(item.summary.labels),
            n(item.summary.tasks),
          ),
        }))
      : []),
  ];

  return (
    <fieldset className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0">
      <legend className="mb-1.5 p-0 text-sm font-medium text-text">
        {t.create.startFrom}
      </legend>
      <div className="flex max-h-64 flex-col gap-2 overflow-y-auto">
        {options.map((option, index) => {
          const checked = value === option.id;
          return (
            <label
              key={option.id ?? "blank"}
              className={cn(
                "flex cursor-pointer items-start gap-3 rounded-md border border-solid px-3.5 py-3",
                checked
                  ? "border-primary bg-bg-muted shadow-[inset_0_0_0_1px_var(--color-primary)]"
                  : "border-border-strong bg-bg hover:bg-bg-subtle",
                disabled && "cursor-not-allowed opacity-60",
              )}
            >
              <input
                type="radio"
                name="project-template"
                className="mt-1 size-4 shrink-0 accent-[var(--color-primary)]"
                checked={checked}
                disabled={disabled}
                onChange={() => onChange(option.id)}
              />
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="font-mono text-label tracking-[0.04em] text-text-muted uppercase">
                  {t.create.optionCode(String(index).padStart(2, "0"))}
                </span>
                <span className="text-sm font-medium [overflow-wrap:anywhere] text-text">
                  {option.name}
                </span>
                <span className="text-xs text-text-muted">{option.note}</span>
              </span>
            </label>
          );
        })}
        {state.status === "loading" ? (
          <SkeletonGroup label={t.create.loading}>
            <Skeleton className="h-14" />
          </SkeletonGroup>
        ) : null}
      </div>
      {state.status === "error" ? (
        <p role="alert" className="text-xs text-danger">
          {t.create.loadFailed}
        </p>
      ) : null}
    </fieldset>
  );
}
