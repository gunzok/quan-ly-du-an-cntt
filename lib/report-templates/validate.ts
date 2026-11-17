import type { ApiErrorDetail } from "@/lib/api/errors";
import {
  isPlainObject,
  unknownFields,
  type Validation,
} from "@/lib/api/request";
import {
  REPORT_TEMPLATE_FILENAME_MAX,
  REPORT_TEMPLATE_MIME,
  REPORT_TEMPLATE_NAME_MAX,
  type ReportTemplateKind,
} from "./model";

/**
 * Kiểm đầu vào thuần (không I/O) cho /api/v1/report-templates.
 */

export const REPORT_TEMPLATE_PATCH_MAX_BYTES = 2048;

// Ký tự điều khiển C0/C1, ký tự định hướng (bidi) dùng để giả đuôi tệp ("bao-cao‮xcod.exe"),
// ký tự không độ rộng.

const FORBIDDEN_CHARS = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]/;

/** Chuẩn hóa tên hiển thị: NFC, gộp khoảng trắng, cắt hai đầu. */
export function normalizeName(value: string): string {
  return value.normalize("NFC").replace(/\s+/g, " ").trim();
}

export type FileNameCheck =
  | { ok: true; kind: ReportTemplateKind; baseName: string }
  | { ok: false; reason: "invalid_name" | "unsupported_type" };

/**
 * Kiểm tên tệp gốc. Tên tệp chỉ dùng để xác định đuôi và gợi ý tên hiển thị, KHÔNG BAO GIỜ dùng làm
 * đường dẫn lưu (máy chủ sinh UUID). Tên "độc hại" (đường dẫn, ký tự điều khiển, ký tự định hướng
 * giả đuôi, quá dài) bị từ chối thay vì lặng lẽ sửa, để Admin biết tệp có vấn đề.
 */
export function checkFileName(fileName: string): FileNameCheck {
  if (
    fileName.length === 0 ||
    fileName.length > REPORT_TEMPLATE_FILENAME_MAX ||
    FORBIDDEN_CHARS.test(fileName) ||
    /[/\\]/.test(fileName) ||
    fileName.startsWith(".")
  ) {
    return { ok: false, reason: "invalid_name" };
  }
  const match = /^(.+)\.([A-Za-z0-9]+)$/.exec(fileName);
  if (!match) return { ok: false, reason: "unsupported_type" };
  const ext = match[2].toLowerCase();
  if (ext !== "xlsx" && ext !== "docx") {
    return { ok: false, reason: "unsupported_type" };
  }
  const baseName = normalizeName(match[1]);
  if (baseName.length === 0) return { ok: false, reason: "invalid_name" };
  return { ok: true, kind: ext, baseName };
}

/**
 * MIME do trình duyệt khai phải khớp đuôi. Trình duyệt không nhận ra loại tệp (thiếu ứng dụng
 * Office) thì gửi rỗng hoặc application/octet-stream: chấp nhận, vì nội dung vẫn được kiểm chữ ký
 * nhị phân. MIME khác (ví dụ application/pdf, text/html) thì từ chối.
 */
export function mimeMatches(kind: ReportTemplateKind, mime: string): boolean {
  const type = mime.split(";")[0].trim().toLowerCase();
  return (
    type === REPORT_TEMPLATE_MIME[kind] ||
    type === "" ||
    type === "application/octet-stream"
  );
}

function checkName(
  value: unknown,
  details: ApiErrorDetail[],
): string | undefined {
  if (typeof value !== "string") {
    details.push({ field: "name", issue: "invalid_format" });
    return undefined;
  }
  const name = normalizeName(value);
  if (name.length === 0) {
    details.push({ field: "name", issue: "required" });
  } else if (name.length > REPORT_TEMPLATE_NAME_MAX) {
    details.push({ field: "name", issue: "too_long" });
  } else if (FORBIDDEN_CHARS.test(name)) {
    details.push({ field: "name", issue: "invalid_value" });
  } else {
    return name;
  }
  return undefined;
}

export interface UploadFields {
  file: File;
  /** Tên hiển thị tùy chọn; vắng thì lấy theo tên tệp. */
  name?: string;
}

const UPLOAD_FIELDS = ["file", "name"] as const;

/** Kiểm các trường multipart: đúng một `file`, tối đa một `name`, không trường lạ. */
export function validateUploadForm(form: FormData): Validation<UploadFields> {
  const keys = new Set<string>();
  for (const [key] of form.entries()) keys.add(key);
  const details = unknownFields(keys, UPLOAD_FIELDS);

  const files = form.getAll("file");
  let file: File | undefined;
  if (files.length === 0) {
    details.push({ field: "file", issue: "required" });
  } else if (files.length > 1 || !(files[0] instanceof File)) {
    details.push({ field: "file", issue: "invalid_format" });
  } else if (files[0].size === 0) {
    details.push({ field: "file", issue: "required" });
  } else {
    file = files[0];
  }

  const names = form.getAll("name");
  let name: string | undefined;
  if (names.length > 1) {
    details.push({ field: "name", issue: "invalid_format" });
  } else if (names.length === 1) {
    name = checkName(names[0], details);
  }

  if (details.length > 0 || !file) return { ok: false, details };
  return { ok: true, data: name === undefined ? { file } : { file, name } };
}

export interface PatchInput {
  name?: string;
  is_active?: boolean;
}

const PATCH_FIELDS = ["name", "is_active"] as const;

export function validatePatch(body: unknown): Validation<PatchInput> {
  if (!isPlainObject(body)) {
    return { ok: false, details: [{ field: "body", issue: "invalid_format" }] };
  }
  const details = unknownFields(Object.keys(body), PATCH_FIELDS);
  const data: PatchInput = {};
  if ("name" in body) {
    const name = checkName(body.name, details);
    if (name !== undefined) data.name = name;
  }
  if ("is_active" in body) {
    if (typeof body.is_active !== "boolean") {
      details.push({ field: "is_active", issue: "invalid_format" });
    } else {
      data.is_active = body.is_active;
    }
  }
  if (details.length === 0 && Object.keys(data).length === 0) {
    details.push({ field: "body", issue: "required" });
  }
  if (details.length > 0) return { ok: false, details };
  return { ok: true, data };
}
