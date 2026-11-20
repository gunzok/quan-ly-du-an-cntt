/**
 * Log có cấu trúc cho đường gửi email (một dòng JSON). CHỈ ghi id, loại, số lần, mã lỗi ngắn, đếm:
 * KHÔNG ghi địa chỉ email, tên task, nội dung, khóa hay bí mật.
 */
export type EmailLogEvent =
  | "email.dispatch.disabled"
  | "email.dispatch.rejected"
  | "email.dispatch.summary"
  | "email.dispatch.error"
  | "email.send.sent"
  | "email.send.retry"
  | "email.send.failed"
  | "email.send.lost";

export type EmailLogFields = Record<string, string | number | boolean | null>;

export type EmailLogger = (
  level: "info" | "warn" | "error",
  event: EmailLogEvent,
  fields?: EmailLogFields,
) => void;

export const consoleEmailLogger: EmailLogger = (level, event, fields = {}) => {
  const line = JSON.stringify({ level, event, ...fields });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.info(line);
};
