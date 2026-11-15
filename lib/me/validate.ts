import type { ApiErrorDetail } from "@/lib/api/errors";
import {
  isPlainObject,
  unknownFields,
  type Validation,
} from "@/lib/api/request";
import { isLocale, type Locale } from "@/lib/i18n/config";

/**
 * Schema PATCH /api/v1/me (Story E10-2). Tạm chỉ nhận `locale`; họ tên, số điện thoại, giao diện
 * sáng/tối thêm ở story sau. Từ chối trường lạ.
 */
export const ME_BODY_MAX_BYTES = 1024;

const PATCH_FIELDS = ["locale"] as const;

export interface MePatch {
  locale: Locale;
}

export function validateMePatch(body: unknown): Validation<MePatch> {
  if (!isPlainObject(body)) {
    return { ok: false, details: [{ field: "body", issue: "invalid_format" }] };
  }
  const details: ApiErrorDetail[] = unknownFields(
    Object.keys(body),
    PATCH_FIELDS,
  );
  if (!("locale" in body) || body.locale === null || body.locale === "") {
    details.push({ field: "locale", issue: "required" });
  } else if (!isLocale(body.locale)) {
    details.push({ field: "locale", issue: "invalid_value" });
  }
  return details.length > 0
    ? { ok: false, details }
    : { ok: true, data: { locale: body.locale as Locale } };
}
