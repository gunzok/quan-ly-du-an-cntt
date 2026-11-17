"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type DragEvent,
} from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton, SkeletonGroup } from "@/components/ui/skeleton";
import { ToastProvider, useToast } from "@/components/ui/toast";
import type { ApiError } from "@/lib/api/errors";
import { cn } from "@/lib/cn";
import { apiErrorText } from "@/lib/i18n/api-error";
import { useI18n } from "@/lib/i18n/client";
import { formatDateInZone, formatNumber } from "@/lib/i18n/format";
import {
  deleteReportTemplate,
  fetchReportTemplates,
  patchReportTemplate,
  reportTemplateFileUrl,
  uploadReportTemplate,
} from "@/lib/report-templates/client-api";
import {
  REPORT_TEMPLATE_MIME,
  type ReportTemplate,
} from "@/lib/report-templates/model";
import styles from "../users/admin-users.module.css";

/**
 * S17 tab "Template báo cáo" (docs/03-design/ui-ux/mockups/v3/bp-Templates.dc.html), Story E5-2.
 * Admin tải lên bằng nút hoặc kéo thả (nút "Chọn tệp" là cách dùng bàn phím thay cho kéo thả),
 * bật/tắt, tải xuống, xóa có xác nhận. Máy chủ kiểm lại mọi thứ; trình duyệt chỉ kiểm sơ bộ để
 * báo lỗi sớm (đuôi, kích thước).
 */

const ACCEPT = [
  ".xlsx",
  ".docx",
  REPORT_TEMPLATE_MIME.xlsx,
  REPORT_TEMPLATE_MIME.docx,
].join(",");

type ListState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; items: ReportTemplate[] };

export function ReportTemplatesScreen() {
  return (
    <ToastProvider>
      <Screen />
    </ToastProvider>
  );
}

function Screen() {
  const { t: strings, locale } = useI18n();
  const t = strings.reportTemplates;
  const { toast } = useToast();
  const [list, setList] = useState<ListState>({ status: "loading" });
  const [reloadToken, setReloadToken] = useState(0);
  const [uploading, setUploading] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const hintId = useId();
  const captionId = useId();

  useEffect(() => {
    const controller = new AbortController();
    fetchReportTemplates(controller.signal)
      .then((result) => {
        setList(
          result.ok
            ? { status: "ready", items: result.data.data }
            : { status: "error", message: apiErrorText(strings, result.error) },
        );
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [reloadToken, strings]);

  const reload = useCallback(() => {
    setList({ status: "loading" });
    setReloadToken((n) => n + 1);
  }, []);

  const errorText = (error: ApiError) => apiErrorText(strings, error);

  async function upload(file: File) {
    setUploadError(null);
    setUploading(file.name);
    const result = await uploadReportTemplate(file);
    setUploading(null);
    if (!result.ok) {
      setUploadError(errorText(result.error));
      return;
    }
    toast({ title: t.upload.uploaded(result.data.data.name), tone: "success" });
    // Tải lại cả danh sách: template mới có thể vừa tự bật.
    reload();
  }

  function pick(files: FileList | null) {
    if (!files || files.length === 0) return;
    if (files.length > 1) {
      setUploadError(t.upload.onlyOne);
      return;
    }
    void upload(files[0]);
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    if (uploading) return;
    pick(event.dataTransfer.files);
  }

  function openPicker() {
    if (uploading) return;
    inputRef.current?.click();
  }

  async function toggle(item: ReportTemplate) {
    setBusyId(item.id);
    const result = await patchReportTemplate(item.id, {
      is_active: !item.is_active,
    });
    setBusyId(null);
    if (!result.ok) {
      toast({ title: errorText(result.error), tone: "error" });
      return;
    }
    toast({
      title: item.is_active ? t.deactivated(item.name) : t.activated(item.name),
      tone: "success",
    });
    reload();
  }

  async function remove(item: ReportTemplate) {
    const result = await deleteReportTemplate(item.id);
    if (!result.ok) {
      toast({ title: errorText(result.error), tone: "error" });
      return;
    }
    toast({ title: t.deleted(item.name), tone: "success" });
    setList((prev) =>
      prev.status === "ready"
        ? { ...prev, items: prev.items.filter((x) => x.id !== item.id) }
        : prev,
    );
  }

  const sizeText = (bytes: number) =>
    t.sizeKb(formatNumber(Math.max(1, Math.round(bytes / 1024)), locale));

  return (
    <main className={styles.main}>
      <header className={styles.header}>
        <div className={styles.headerText}>
          <span className="label">
            <span className={styles.dot} aria-hidden="true" />
            {t.eyebrow}
          </span>
          <h1 className={styles.title}>
            {t.heading}
            <span className={styles.accentDot} aria-hidden="true">
              .
            </span>
          </h1>
          <p className={styles.intro}>{t.intro}</p>
        </div>
        <div className={styles.headerActions}>
          <Button
            onClick={openPicker}
            disabled={uploading !== null}
            trailing="→"
          >
            {t.upload.action}
          </Button>
        </div>
      </header>
      <div className={styles.content}>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          hidden
          aria-label={t.upload.inputLabel}
          data-testid="report-template-input"
          onChange={(event) => {
            pick(event.currentTarget.files);
            event.currentTarget.value = "";
          }}
        />

        <div
          onDragEnter={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={cn(
            "flex flex-col items-center gap-2 rounded-lg border-2 border-dashed px-4 py-6 text-center",
            dragging
              ? "border-primary bg-bg-muted"
              : "border-border bg-bg-subtle",
          )}
          data-testid="report-template-dropzone"
        >
          <p className="text-sm font-medium text-text">{t.upload.dropTitle}</p>
          <p className="text-sm text-text-muted">{t.upload.dropOr}</p>
          <Button
            variant="secondary"
            onClick={openPicker}
            loading={uploading !== null}
            loadingText={uploading ? t.upload.uploading(uploading) : undefined}
            aria-describedby={hintId}
          >
            {t.upload.choose}
          </Button>
          <p id={hintId} className="text-sm text-text-muted">
            {t.upload.hint}
          </p>
          <div role="alert" className="text-sm text-danger">
            {uploadError}
          </div>
        </div>

        {list.status === "loading" ? (
          <SkeletonGroup label={t.loading}>
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
          </SkeletonGroup>
        ) : list.status === "error" ? (
          <div
            role="alert"
            className="flex flex-col items-start gap-3 rounded-lg border border-solid border-border p-4"
          >
            <p className="text-sm text-text">{t.loadFailed}</p>
            <p className="text-sm text-text-muted">{list.message}</p>
            <Button variant="secondary" onClick={reload}>
              {t.retry}
            </Button>
          </div>
        ) : list.items.length === 0 ? (
          <EmptyState title={t.empty.title} description={t.empty.description} />
        ) : (
          <div
            role="region"
            aria-labelledby={captionId}
            tabIndex={0}
            className="overflow-x-auto rounded-lg border border-solid border-border"
          >
            <table className="w-full border-collapse text-sm">
              <caption id={captionId} className="sr-only">
                {t.tableCaption}
              </caption>
              <thead>
                <tr className="border-b border-solid border-border bg-bg-subtle text-left">
                  {[
                    t.columns.name,
                    t.columns.format,
                    t.columns.size,
                    t.columns.uploadedBy,
                    t.columns.date,
                    t.columns.status,
                    t.columns.actions,
                  ].map((label) => (
                    <th
                      key={label}
                      scope="col"
                      className="px-3 py-2 font-mono text-label font-normal tracking-[0.04em] whitespace-nowrap text-text-muted uppercase"
                    >
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {list.items.map((item) => (
                  <tr
                    key={item.id}
                    className="border-b border-solid border-border last:border-b-0"
                  >
                    <th
                      scope="row"
                      className="max-w-64 px-3 py-2 text-left font-medium break-words text-text"
                    >
                      {item.name}
                    </th>
                    <td className="px-3 py-2 font-mono whitespace-nowrap uppercase">
                      .{item.kind}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-text-muted">
                      {sizeText(item.size_bytes)}
                    </td>
                    <td className="px-3 py-2 text-text-muted">
                      {item.uploaded_by?.name || t.unknownUploader}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-text-muted">
                      {formatDateInZone(new Date(item.created_at), locale)}
                    </td>
                    <td className="px-3 py-2">
                      <Badge tone={item.is_active ? "success" : "neutral"}>
                        {item.is_active ? t.status.active : t.status.inactive}
                      </Badge>
                    </td>
                    <td className="px-3 py-1">
                      <div className="flex flex-wrap items-center gap-1">
                        <a
                          href={reportTemplateFileUrl(item.id)}
                          download
                          aria-label={t.actions.download(item.name)}
                          className="inline-flex min-h-11 items-center rounded-md px-2 text-sm font-medium text-primary underline-offset-2 hover:underline sm:min-h-9"
                        >
                          {t.actions.downloadShort}
                        </a>
                        <Button
                          variant="text"
                          loading={busyId === item.id}
                          disabled={busyId !== null && busyId !== item.id}
                          aria-label={
                            item.is_active
                              ? t.actions.deactivateLabel(item.name)
                              : t.actions.activateLabel(item.name)
                          }
                          onClick={() => void toggle(item)}
                        >
                          {item.is_active
                            ? t.actions.deactivate
                            : t.actions.activate}
                        </Button>
                        <ConfirmDialog
                          trigger={
                            <Button
                              variant="text"
                              className="text-danger"
                              aria-label={t.actions.deleteLabel(item.name)}
                            >
                              {t.actions.delete}
                            </Button>
                          }
                          title={t.confirmDelete.title(item.name)}
                          description={t.confirmDelete.description}
                          confirmLabel={t.confirmDelete.confirm}
                          onConfirm={() => remove(item)}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <aside className="rounded-lg border border-solid border-border bg-bg-subtle p-4">
          <h2 className="font-mono text-label tracking-[0.04em] text-text-muted uppercase">
            {t.rules.title}
          </h2>
          <p className="mt-2 text-sm text-text">{t.rules.body}</p>
        </aside>
      </div>
    </main>
  );
}
