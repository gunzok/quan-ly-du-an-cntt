import type { ApiErrorDetail } from "@/lib/api/errors";
import {
  isPlainObject,
  unknownFields,
  type Validation,
} from "@/lib/api/request";
import {
  REPORT_FORMATS,
  REPORT_MAX_PERIOD_DAYS,
  type ExportReportInput,
  type ReportFormat,
} from "./model";
import { isCalendarDate, periodDays } from "./period";

/** Thân JSON tối đa của POST /reports (chỉ ba trường ngắn). */
export const EXPORT_REPORT_MAX_BODY_BYTES = 1024;

const ALLOWED = ["format", "period_start", "period_end"] as const;

/**
 * Kiểm thân POST /api/v1/projects/{id}/reports: `format` (xlsx|docx), `period_start`,
 * `period_end` (YYYY-MM-DD, start <= end, dài tối đa REPORT_MAX_PERIOD_DAYS ngày). Trường lạ: 400.
 */
export function validateExportReport(
  body: unknown,
): Validation<ExportReportInput> {
  if (!isPlainObject(body)) {
    return { ok: false, details: [{ field: "body", issue: "invalid_format" }] };
  }
  const details: ApiErrorDetail[] = unknownFields(Object.keys(body), ALLOWED);
  const { format, period_start, period_end } = body;

  if (format === undefined)
    details.push({ field: "format", issue: "required" });
  else if (!REPORT_FORMATS.includes(format as ReportFormat)) {
    details.push({ field: "format", issue: "invalid_value" });
  }
  for (const [field, value] of [
    ["period_start", period_start],
    ["period_end", period_end],
  ] as const) {
    if (value === undefined) details.push({ field, issue: "required" });
    else if (!isCalendarDate(value)) {
      details.push({ field, issue: "invalid_format" });
    }
  }
  if (
    isCalendarDate(period_start) &&
    isCalendarDate(period_end) &&
    (period_start > period_end ||
      periodDays(period_start, period_end) > REPORT_MAX_PERIOD_DAYS)
  ) {
    details.push({ field: "period_end", issue: "invalid_value" });
  }
  if (details.length > 0) return { ok: false, details };
  return {
    ok: true,
    data: {
      format: format as ReportFormat,
      period_start: period_start as string,
      period_end: period_end as string,
    },
  };
}
