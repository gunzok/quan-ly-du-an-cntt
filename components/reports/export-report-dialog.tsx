"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { AlertIcon, CheckIcon, ErrorIcon } from "@/components/ui/icons";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/cn";
import { apiErrorText } from "@/lib/i18n/api-error";
import { useStrings } from "@/lib/i18n/client";
import { fetchReportTemplates } from "@/lib/report-templates/client-api";
import {
  exportReport,
  sampleTemplateUrl,
  saveBlob,
} from "@/lib/reports/client-api";
import {
  REPORT_FORMATS,
  REPORT_MAX_PERIOD_DAYS,
  SUPPORTED_REPORT_FORMATS,
  type ReportFormat,
} from "@/lib/reports/model";
import {
  currentMonthPeriod,
  isCalendarDate,
  periodDays,
} from "@/lib/reports/period";

type TemplateState =
  | { status: "loading" }
  | { status: "active"; name: string }
  | { status: "missing" }
  | { status: "error" };

type PeriodError = "periodRequired" | "periodOrder" | "periodTooLong";

export interface ExportReportDialogProps {
  projectId: string;
  projectName: string;
  /** Admin thấy lối tới trang Template báo cáo (S17, chỉ Admin vào được). */
  isAdmin: boolean;
}

/** Kiểm kỳ ở trình duyệt (máy chủ kiểm lại, 400 nếu sai). */
export function periodError(start: string, end: string): PeriodError | null {
  if (!isCalendarDate(start) || !isCalendarDate(end)) return "periodRequired";
  if (start > end) return "periodOrder";
  if (periodDays(start, end) > REPORT_MAX_PERIOD_DAYS) return "periodTooLong";
  return null;
}

/**
 * Hộp thoại xuất báo cáo S07 (Story E5-3, mockup v3 bp-Report.dc.html). Chọn định dạng (Word
 * "sắp có" ở E5-4), kỳ báo cáo (mặc định tháng này, giờ Việt Nam), xem template đang dùng; gọi
 * POST /api/v1/projects/{id}/reports rồi lưu tệp. Chỉ PM của dự án và Admin thấy nút mở.
 */
export function ExportReportDialog({
  projectId,
  projectName,
  isAdmin,
}: ExportReportDialogProps) {
  const strings = useStrings();
  const t = strings.reports.dialog;
  const [open, setOpen] = useState(false);
  const [format, setFormat] = useState<ReportFormat>("xlsx");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [touched, setTouched] = useState(false);
  const [template, setTemplate] = useState<TemplateState>({
    status: "loading",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const formatName = useId();

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      const month = currentMonthPeriod();
      setStart(month.start);
      setEnd(month.end);
      setFormat("xlsx");
      setTouched(false);
      setError(null);
      setDone(null);
      setTemplate({ status: "loading" });
    } else {
      abortRef.current?.abort();
      abortRef.current = null;
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    fetchReportTemplates(controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        if (!result.ok) {
          setTemplate({ status: "error" });
          return;
        }
        const active = result.data.data.find(
          (tpl) => tpl.kind === "xlsx" && tpl.is_active,
        );
        setTemplate(
          active
            ? { status: "active", name: active.name }
            : { status: "missing" },
        );
      })
      .catch((e: unknown) => {
        if ((e as { name?: string }).name !== "AbortError") {
          setTemplate({ status: "error" });
        }
      });
    return () => controller.abort();
  }, [open]);

  const invalid = periodError(start, end);
  const shownPeriodError = touched && invalid ? t.errors[invalid] : null;
  const canSubmit =
    !busy &&
    SUPPORTED_REPORT_FORMATS.includes(format) &&
    template.status !== "missing";

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTouched(true);
    setError(null);
    setDone(null);
    if (invalid || !canSubmit) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    try {
      const result = await exportReport(
        projectId,
        { format, period_start: start, period_end: end },
        controller.signal,
      );
      if (controller.signal.aborted) return;
      if (result.ok) {
        saveBlob(result.blob, result.fileName);
        setDone(t.downloaded(result.fileName));
        return;
      }
      if (result.network) setError(t.errors.network);
      else if (!result.error) setError(t.errors.failed);
      else if (result.error.code === "report_template_missing") {
        setTemplate({ status: "missing" });
      } else if (result.error.code === "report_timeout") {
        setError(t.errors.timeout);
      } else {
        setError(apiErrorText(strings, result.error));
      }
    } catch (e) {
      if ((e as { name?: string }).name !== "AbortError") {
        setError(t.errors.failed);
      }
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
        setBusy(false);
      }
    }
  }

  function applyThisMonth() {
    const month = currentMonthPeriod();
    setStart(month.start);
    setEnd(month.end);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button variant="secondary">{strings.reports.exportButton}</Button>
      </DialogTrigger>
      <DialogContent className="max-w-xl">
        <div className="flex flex-col gap-1.5 pr-8">
          <span className="label">{t.eyebrow}</span>
          <DialogTitle className="font-display text-xl">
            {t.title}
            <span aria-hidden="true" className="text-accent">
              .
            </span>
          </DialogTitle>
          <DialogDescription className="[overflow-wrap:anywhere]">
            {t.description(projectName)}
          </DialogDescription>
        </div>
        <form
          noValidate
          onSubmit={onSubmit}
          className="flex flex-col gap-5"
          aria-busy={busy || undefined}
        >
          <fieldset className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0">
            <legend className="label mb-2 p-0">{t.formatLegend}</legend>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {REPORT_FORMATS.map((f) => {
                const supported = SUPPORTED_REPORT_FORMATS.includes(f);
                const info = t.formats[f];
                return (
                  <label
                    key={f}
                    className={cn(
                      "relative flex min-h-11 flex-col gap-0.5 rounded-md border border-solid p-3",
                      "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-primary has-[:focus-visible]:outline-solid",
                      !supported
                        ? "cursor-not-allowed border-border bg-bg-subtle text-text-muted"
                        : f === format
                          ? "cursor-pointer border-primary bg-bg-muted"
                          : "cursor-pointer border-border-strong bg-bg hover:bg-bg-muted",
                    )}
                  >
                    <input
                      type="radio"
                      name={formatName}
                      value={f}
                      checked={f === format}
                      disabled={!supported}
                      aria-describedby={`${formatName}-${f}-hint`}
                      onChange={() => setFormat(f)}
                      className="absolute inset-0 m-0 cursor-[inherit] opacity-0"
                    />
                    <span className="flex items-center justify-between gap-2">
                      <span
                        className={cn(
                          "font-semibold",
                          supported && f === format && "text-primary",
                        )}
                      >
                        {info.label}
                      </span>
                      <span className="font-mono text-xs text-text-muted">
                        {supported ? info.ext : t.comingSoon}
                      </span>
                    </span>
                    <span
                      id={`${formatName}-${f}-hint`}
                      className="text-xs text-text-muted"
                    >
                      {supported ? info.hint : t.docxComingSoon}
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          <fieldset className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0">
            <legend className="label mb-2 p-0">{t.periodLegend}</legend>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label={t.periodStart}>
                {(control) => (
                  <Input
                    {...control}
                    type="date"
                    required
                    value={start}
                    max={end || undefined}
                    onChange={(e) => setStart(e.target.value)}
                    onBlur={() => setTouched(true)}
                    aria-invalid={shownPeriodError ? true : undefined}
                  />
                )}
              </Field>
              <Field label={t.periodEnd} error={shownPeriodError}>
                {(control) => (
                  <Input
                    {...control}
                    type="date"
                    required
                    value={end}
                    min={start || undefined}
                    onChange={(e) => setEnd(e.target.value)}
                    onBlur={() => setTouched(true)}
                  />
                )}
              </Field>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="m-0 text-xs text-text-muted">{t.periodHint}</p>
              <Button variant="text" onClick={applyThisMonth}>
                {t.thisMonth}
              </Button>
            </div>
          </fieldset>

          <section
            aria-labelledby={`${formatName}-tpl`}
            className="flex flex-col gap-2"
          >
            <h3 id={`${formatName}-tpl`} className="label m-0">
              {t.templateLegend}
            </h3>
            <TemplateStatus state={template} isAdmin={isAdmin} />
            <p className="m-0 text-xs text-text-muted">{t.scopeHint}</p>
          </section>

          {error ? (
            <p
              role="alert"
              className="m-0 flex items-start gap-2 rounded-md border border-solid border-danger bg-bg-subtle p-3 text-sm text-text"
            >
              <ErrorIcon className="mt-0.5 size-4 shrink-0 text-danger" />
              {error}
            </p>
          ) : null}
          <p role="status" className="m-0 text-sm text-text empty:hidden">
            {busy ? t.exporting : (done ?? "")}
          </p>

          <div className="flex flex-col-reverse gap-3 border-t border-solid border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="m-0 text-xs text-text-muted">{t.durationHint}</p>
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <DialogClose asChild>
                <Button variant="secondary">{t.cancel}</Button>
              </DialogClose>
              <Button
                type="submit"
                loading={busy}
                loadingText={t.exporting}
                disabled={!canSubmit}
                trailing="→"
              >
                {t.submit}
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function TemplateStatus({
  state,
  isAdmin,
}: {
  state: TemplateState;
  isAdmin: boolean;
}) {
  const strings = useStrings();
  const t = strings.reports.dialog;
  const box =
    "flex items-start gap-2 rounded-md border border-solid p-3 text-sm";
  switch (state.status) {
    case "loading":
      return (
        <p
          role="status"
          className={cn(box, "m-0 border-border text-text-muted")}
        >
          {t.templateLoading}
        </p>
      );
    case "active":
      return (
        <p className={cn(box, "m-0 border-border bg-bg-subtle text-text")}>
          <CheckIcon className="mt-0.5 size-4 shrink-0 text-success" />
          <span className="flex min-w-0 flex-col">
            <span className="text-xs text-text-muted">{t.templateActive}</span>
            <span className="font-medium [overflow-wrap:anywhere]">
              {state.name}
            </span>
          </span>
        </p>
      );
    case "error":
      return (
        <p className={cn(box, "m-0 border-border bg-bg-subtle text-text")}>
          <AlertIcon className="mt-0.5 size-4 shrink-0 text-warning" />
          {t.templateLoadError}
        </p>
      );
    case "missing":
      return (
        <div
          role="alert"
          className={cn(box, "flex-col border-warning bg-bg-subtle text-text")}
        >
          <p className="m-0 flex items-start gap-2 font-medium">
            <AlertIcon className="mt-0.5 size-4 shrink-0 text-warning" />
            {t.templateMissing}
          </p>
          <p className="m-0">
            {isAdmin ? t.templateMissingAdmin : t.templateMissingPm}
          </p>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {isAdmin ? (
              <Link
                href="/admin/report-templates"
                className="inline-flex min-h-11 items-center font-medium text-primary underline underline-offset-2 sm:min-h-0"
              >
                {t.templatePageLink}
              </Link>
            ) : null}
            <a
              href={sampleTemplateUrl("xlsx")}
              download
              className="inline-flex min-h-11 items-center font-medium text-primary underline underline-offset-2 sm:min-h-0"
            >
              {t.sampleLink}
            </a>
          </div>
        </div>
      );
  }
}
