import { isUuid } from "@/lib/api/request";
import { isLocale, type Locale } from "@/lib/i18n/config";
import { formatCalendarDate } from "@/lib/i18n/format";
import { getMessages } from "@/lib/i18n/messages";
import { escapeHtml, singleLine } from "./sanitize";

/**
 * Mẫu email thông báo (Story E4-2): tiếng Việt hoặc English theo profiles.locale của người nhận.
 * Tiêu đề đơn giản, một khối text thuần kèm HTML tối thiểu (không ảnh, không CSS ngoài, không
 * script). Mọi dữ liệu người dùng (tên task, dự án, người, trạng thái) đi qua `singleLine` rồi
 * `escapeHtml` trong HTML: tên task không bao giờ thành HTML thô, không chèn được dòng tiêu đề.
 */
export type EmailNotificationType =
  "task_assigned" | "task_status_changed" | "task_due_soon";

export interface TaskEmailInput {
  type: EmailNotificationType;
  locale: string | null | undefined;
  appBaseUrl: string;
  projectId: string;
  taskId: string;
  taskTitle: string;
  projectName: string;
  statusName?: string | null;
  actorName?: string | null;
  /** Nhắc hạn (E4-3): hạn YYYY-MM-DD và số ngày còn lại tính lúc gửi. */
  dueDate?: string | null;
  daysLeft?: number | null;
}

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

/** Giới hạn độ dài khi đưa vào email (tiêu đề hộp thư ngắn hơn nội dung). */
const SUBJECT_TITLE_MAX = 80;
const FIELD_MAX = 200;
const NAME_MAX = 100;

/** Liên kết tuyệt đối tới trang task: {APP_BASE_URL}/projects/{id}/tasks/{taskId}. */
export function taskUrl(
  appBaseUrl: string,
  projectId: string,
  taskId: string,
): string {
  if (!isUuid(projectId) || !isUuid(taskId)) {
    throw new Error("projectId/taskId không phải UUID");
  }
  const base = new URL(appBaseUrl);
  return new URL(
    `/projects/${projectId}/tasks/${taskId}`,
    base.origin,
  ).toString();
}

export function renderTaskEmail(input: TaskEmailInput): RenderedEmail {
  const locale: Locale = isLocale(input.locale) ? input.locale : "vi";
  const t = getMessages(locale).email;
  const url = taskUrl(input.appBaseUrl, input.projectId, input.taskId);

  const title = singleLine(input.taskTitle, FIELD_MAX);
  const subjectTitle = singleLine(input.taskTitle, SUBJECT_TITLE_MAX);
  const project = singleLine(input.projectName, FIELD_MAX);
  const actor = input.actorName ? singleLine(input.actorName, NAME_MAX) : "";
  const status = singleLine(input.statusName ?? "", NAME_MAX);

  let subject: string;
  let intro: string;
  const rows: [string, string][] = [
    [t.taskLabel, title],
    [t.projectLabel, project],
  ];
  if (input.type === "task_due_soon") {
    const days = Math.max(0, Math.trunc(input.daysLeft ?? 0));
    subject = t.dueSoonSubject(subjectTitle, days);
    intro = t.dueSoonIntro(days);
    const due = formatCalendarDate(input.dueDate ?? null, locale);
    if (due) rows.push([t.dueDateLabel, due]);
  } else if (input.type === "task_assigned") {
    subject = t.assignedSubject(subjectTitle);
    intro = actor ? t.assignedIntro(actor) : t.assignedIntroNoActor;
    if (actor) rows.push([t.assignedByLabel, actor]);
  } else {
    subject = t.statusSubject(subjectTitle, status);
    intro = actor ? t.statusIntro(actor, status) : t.statusIntroNoActor(status);
    rows.push([t.statusLabel, status]);
    if (actor) rows.push([t.changedByLabel, actor]);
  }
  // Tiêu đề hộp thư: một dòng tuyệt đối (kể cả khi chuỗi dịch có ký tự lạ).
  subject = singleLine(`[${t.appName}] ${subject}`, 180);

  const text = [
    intro,
    "",
    ...rows.map(([label, value]) => `${label}: ${value}`),
    "",
    `${t.openTask}: ${url}`,
    "",
    "--",
    t.footer,
    "",
  ].join("\n");

  const e = escapeHtml;
  const html = [
    "<!doctype html>",
    `<html lang="${locale}">`,
    '<head><meta charset="utf-8">',
    `<title>${e(subject)}</title></head>`,
    '<body style="margin:0;padding:16px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#1b1f2a;background:#ffffff">',
    `<p style="margin:0 0 12px">${e(intro)}</p>`,
    '<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:0 0 16px">',
    ...rows.map(
      ([label, value]) =>
        `<tr><td style="padding:2px 12px 2px 0;color:#4a5163;vertical-align:top">${e(label)}</td><td style="padding:2px 0"><strong>${e(value)}</strong></td></tr>`,
    ),
    "</table>",
    `<p style="margin:0 0 16px"><a href="${e(url)}" style="color:#2054f0">${e(t.openTask)}</a></p>`,
    `<p style="margin:0;color:#4a5163;font-size:12px">${e(t.footer)}</p>`,
    "</body></html>",
  ].join("\n");

  return { subject, text, html };
}
