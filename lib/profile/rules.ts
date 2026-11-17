/**
 * Quy tắc hồ sơ dùng chung cho API (lib/me/validate.ts) và form trình duyệt (Story E1-7).
 * Không import gì phía máy chủ để Client Component dùng được.
 */

/** Tên hiển thị: 1..100 ký tự sau khi bỏ khoảng trắng hai đầu (CSDL cho tới 200). */
export const FULL_NAME_MAX = 100;

/** Trùng ràng buộc CSDL profile_contacts_phone_format. */
export const PHONE_PATTERN = /^\+?[0-9][0-9 .()-]{5,19}$/;

/** Độ dài tối đa ô số điện thoại (1 dấu + và 20 ký tự). */
export const PHONE_MAX = 21;

export type ProfileFieldIssue = "required" | "invalid_format" | "too_long";

// Ký tự điều khiển (C0, DEL, C1) và ký tự định dạng hai chiều dễ giả mạo hiển thị.
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]/;

/** Chuẩn hóa tên hiển thị (NFC, bỏ khoảng trắng hai đầu); trả mã lỗi nếu không hợp lệ. */
export function normalizeFullName(
  value: unknown,
): { ok: true; value: string } | { ok: false; issue: ProfileFieldIssue } {
  if (typeof value !== "string") return { ok: false, issue: "invalid_format" };
  const name = value.normalize("NFC").trim();
  if (name === "") return { ok: false, issue: "required" };
  if (CONTROL_CHARS.test(name)) return { ok: false, issue: "invalid_format" };
  if ([...name].length > FULL_NAME_MAX) return { ok: false, issue: "too_long" };
  return { ok: true, value: name };
}

/** Chuẩn hóa số điện thoại: null hoặc chuỗi rỗng là xóa. */
export function normalizePhone(
  value: unknown,
):
  { ok: true; value: string | null } | { ok: false; issue: ProfileFieldIssue } {
  if (value === null) return { ok: true, value: null };
  if (typeof value !== "string") return { ok: false, issue: "invalid_format" };
  const phone = value.trim();
  if (phone === "") return { ok: true, value: null };
  if (!PHONE_PATTERN.test(phone)) return { ok: false, issue: "invalid_format" };
  return { ok: true, value: phone };
}
