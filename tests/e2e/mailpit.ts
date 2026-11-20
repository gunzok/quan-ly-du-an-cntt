/**
 * Đọc email ở Mailpit cục bộ cho e2e (lời mời của Supabase Auth, email giao việc/nhắc hạn của app).
 * Chỉ nhận địa chỉ localhost: không bao giờ gọi Mailpit ở máy khác.
 */
export const MAILPIT_URL = process.env.MAILPIT_URL ?? "http://127.0.0.1:54324";

if (!/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(`${MAILPIT_URL}/`)) {
  throw new Error(`MAILPIT_URL phải là địa chỉ cục bộ (nhận: ${MAILPIT_URL}).`);
}

export interface MailpitMessage {
  ID: string;
  Subject: string;
  Text: string;
  HTML: string;
}

/** Tóm tắt các email gửi tới `to` (mới nhất trước). */
export async function mailboxOf(to: string): Promise<{ ID: string; Subject: string }[]> {
  const query = encodeURIComponent(`to:"${to}"`);
  const res = await fetch(`${MAILPIT_URL}/api/v1/search?query=${query}`);
  if (!res.ok) throw new Error(`Mailpit search lỗi ${res.status}`);
  const { messages } = (await res.json()) as {
    messages?: { ID: string; Subject: string }[];
  };
  return messages ?? [];
}

export async function mailpitMessage(id: string): Promise<MailpitMessage> {
  const res = await fetch(`${MAILPIT_URL}/api/v1/message/${id}`);
  if (!res.ok) throw new Error(`Mailpit message lỗi ${res.status}`);
  return (await res.json()) as MailpitMessage;
}

/**
 * Chờ email đầu tiên gửi tới `to` có tiêu đề chứa `subject` (bỏ trống: email bất kỳ). Hết giờ thì ném
 * lỗi kèm danh sách tiêu đề đã thấy để dễ gỡ.
 */
export async function waitForMail(
  to: string,
  { subject, timeoutMs = 10_000 }: { subject?: string; timeoutMs?: number } = {},
): Promise<MailpitMessage> {
  const deadline = Date.now() + timeoutMs;
  let seen: string[] = [];
  while (Date.now() < deadline) {
    const messages = await mailboxOf(to);
    seen = messages.map((m) => m.Subject);
    const hit = messages.find((m) => !subject || m.Subject.includes(subject));
    if (hit) return mailpitMessage(hit.ID);
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(
    `Không thấy email tới ${to}${subject ? ` có tiêu đề "${subject}"` : ""} ở Mailpit. Đã thấy: ${JSON.stringify(seen)}`,
  );
}

/** Link /auth/accept-invite trong email mời mới nhất, đổi origin sang server e2e. */
export async function inviteLinkFromMailpit(
  email: string,
  baseURL: string,
): Promise<string> {
  const message = await waitForMail(email);
  const href = (message.HTML ?? "")
    .replace(/&amp;/g, "&")
    .match(/href="([^"]*\/auth\/accept-invite\?[^"]+)"/)?.[1];
  if (!href) throw new Error("Email mời không có link /auth/accept-invite");
  const link = new URL(href);
  return new URL(`${link.pathname}${link.search}`, baseURL).toString();
}
