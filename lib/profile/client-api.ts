import { call } from "@/lib/admin/users/client-api";
import type { Locale } from "@/lib/i18n/config";

/** Lưu hồ sơ từ trình duyệt (PATCH /api/v1/me, cookie phiên cùng origin). */
export function patchMe(body: {
  full_name?: string;
  phone?: string | null;
  locale?: Locale;
}) {
  return call<{
    data: { full_name?: string; phone?: string | null; locale?: Locale };
  }>("/api/v1/me", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
