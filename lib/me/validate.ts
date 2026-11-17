import type { ApiErrorDetail } from "@/lib/api/errors";
import {
  isPlainObject,
  unknownFields,
  type Validation,
} from "@/lib/api/request";
import { isLocale, type Locale } from "@/lib/i18n/config";
import { normalizeFullName, normalizePhone } from "@/lib/profile/rules";

/**
 * Schema PATCH /api/v1/me. E10-2 nhận `locale`; E1-7 (QLDA-77) thêm `full_name` và `phone`. Mọi
 * trường đều tùy chọn nhưng phải có ít nhất một; từ chối trường lạ (email, is_admin, is_active,
 * department_id... không bao giờ đổi được qua đây). Giao diện sáng/tối lưu ở trình duyệt, không
 * qua API (xem lib/profile/theme.ts).
 */
export const ME_BODY_MAX_BYTES = 1024;

const PATCH_FIELDS = ["full_name", "phone", "locale"] as const;

export interface MePatch {
  full_name?: string;
  /** null: xóa số điện thoại. */
  phone?: string | null;
  locale?: Locale;
}

export function validateMePatch(body: unknown): Validation<MePatch> {
  if (!isPlainObject(body)) {
    return { ok: false, details: [{ field: "body", issue: "invalid_format" }] };
  }
  const details: ApiErrorDetail[] = unknownFields(
    Object.keys(body),
    PATCH_FIELDS,
  );
  const data: MePatch = {};

  if ("full_name" in body) {
    const name = normalizeFullName(body.full_name);
    if (name.ok) data.full_name = name.value;
    else details.push({ field: "full_name", issue: name.issue });
  }
  if ("phone" in body) {
    const phone = normalizePhone(body.phone);
    if (phone.ok) data.phone = phone.value;
    else details.push({ field: "phone", issue: phone.issue });
  }
  if ("locale" in body) {
    if (body.locale === null || body.locale === "") {
      details.push({ field: "locale", issue: "required" });
    } else if (!isLocale(body.locale)) {
      details.push({ field: "locale", issue: "invalid_value" });
    } else {
      data.locale = body.locale;
    }
  }
  if (details.length === 0 && Object.keys(data).length === 0) {
    details.push({ field: "body", issue: "required" });
  }
  return details.length > 0 ? { ok: false, details } : { ok: true, data };
}
