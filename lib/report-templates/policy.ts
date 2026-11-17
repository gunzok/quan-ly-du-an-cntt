import type { ApiError } from "@/lib/api/errors";
import { apiError } from "@/lib/api/respond";
import { strings } from "@/lib/strings";
import type { OoxmlRejection } from "./ooxml";

/**
 * Logic quyền và ánh xạ lỗi thuần (không I/O) cho /api/v1/report-templates, tách để test đơn vị.
 */

export type ReaderGate =
  { ok: true; userId: string } | { ok: false; error: ApiError };

/**
 * Đọc template báo cáo: Admin đang hoạt động, hoặc người đang hoạt động là PM ở ít nhất một dự án
 * (database.md mục 5: report_templates "PM: Đọc"). Thành viên, Người xem, người ngoài: 403.
 * Hồ sơ không đọc được (người bị khóa: RLS ẩn cả hồ sơ của mình) hoặc bị khóa: 403.
 */
export function decideReaderGate(
  user: { id: string } | null,
  profile: { is_admin: boolean; is_active: boolean } | null,
  isPmSomewhere: boolean,
): ReaderGate {
  if (!user) return { ok: false, error: apiError("unauthenticated") };
  if (!profile || !profile.is_active) {
    return { ok: false, error: apiError("forbidden") };
  }
  if (!profile.is_admin && !isPmSomewhere) {
    return { ok: false, error: apiError("forbidden") };
  }
  return { ok: true, userId: user.id };
}

export type UploadRejection =
  OoxmlRejection | "unsupported_type" | "mime_mismatch";

/** Tệp hợp lệ về hình thức nhưng nội dung không nhận được: 422 với thông điệp riêng. */
export function rejectionError(reason: UploadRejection): ApiError {
  const e = strings.reportTemplates.errors;
  const message = {
    unsupported_type: e.unsupportedType,
    mime_mismatch: e.mimeMismatch,
    signature: e.invalidFile,
    macro: e.macro,
    zip_bomb: e.zipBomb,
  }[reason];
  return apiError("business_rule_violated", message, [
    { field: "file", issue: "invalid_value" },
  ]);
}

/**
 * Ánh xạ lỗi PostgREST/Postgres khi ghi report_templates; lỗi khác trả null (lỗi hệ thống).
 * - 23505: chỉ mục một template đang dùng mỗi định dạng (hai Admin bật cùng lúc): 409.
 * - 42501: RLS từ chối (quyền Admin vừa bị thu giữa lúc kiểm và lúc ghi): 403.
 * - 23514: vi phạm CHECK lọt qua schema: 400.
 */
export function mapWriteError(error: { code?: string }): ApiError | null {
  switch (error.code) {
    case "23505":
      return apiError(
        "conflict",
        strings.reportTemplates.errors.activeConflict,
      );
    case "42501":
      return apiError("forbidden");
    case "23514":
      return apiError("validation_failed", undefined, [
        { field: "name", issue: "invalid_value" },
      ]);
    default:
      return null;
  }
}
