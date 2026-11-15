"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  clientIp,
  consumeRateLimits,
  logRateLimitUnavailable,
} from "@/lib/api/rate-limit";
import { createClient } from "@/lib/supabase/server";
import {
  acceptInvite,
  type AcceptInviteFieldErrors,
  validateAcceptInviteForm,
} from "./accept-invite";
import { HOME_PATH } from "./routes";

export type AcceptInviteFormError =
  "rateLimited" | "unavailable" | "passwordNotSet";

export interface AcceptInviteState {
  /** Link không dùng được (giả, hết hạn, đã dùng): trang chuyển sang hướng dẫn xin gửi lại. */
  linkInvalid?: boolean;
  fieldErrors?: AcceptInviteFieldErrors;
  /**
   * Lỗi chung của form (giới hạn tần suất, lỗi máy chủ): khóa trong `acceptInvite.errors` của từ
   * điển; form hiển thị theo ngôn ngữ của người dùng (Story E10-2).
   */
  formError?: AcceptInviteFormError;
}

/**
 * Server Action đặt mật khẩu cho người được mời (Story E1-7). Next.js tự kiểm Origin của Server
 * Action (chống CSRF). Thứ tự: kiểm form (không gọi mạng) → giới hạn tần suất theo IP
 * (RATE_LIMITS.acceptInviteIp, FAIL-CLOSED như đăng nhập) → verifyOtp + updateUser.
 * Thành công: cookie phiên httpOnly đã ghi, chuyển về trang chủ (đích cố định, không nhận `next`).
 */
export async function submitAcceptInvite(
  _prev: AcceptInviteState,
  formData: FormData,
): Promise<AcceptInviteState> {
  const parsed = validateAcceptInviteForm(formData);
  if (!parsed.ok) {
    return parsed.linkInvalid
      ? { linkInvalid: true }
      : { fieldErrors: parsed.fieldErrors };
  }

  const gate = await consumeRateLimits([
    {
      name: "acceptInviteIp",
      identifier: `ip:${clientIp(await headers()) ?? "unknown"}`,
    },
  ]);
  if (!gate.ok) {
    if (gate.reason === "limited") {
      return { formError: "rateLimited" };
    }
    logRateLimitUnavailable("accept_invite", gate.detail);
    return { formError: "unavailable" };
  }

  const supabase = await createClient();
  const result = await acceptInvite(supabase, parsed.data);
  if (!result.ok) {
    switch (result.reason) {
      case "link_invalid":
        return { linkInvalid: true };
      case "rate_limited":
        return { formError: "rateLimited" };
      case "password_not_set":
        console.error(
          JSON.stringify({
            level: "error",
            event: "accept_invite_password_not_set",
          }),
        );
        return { formError: "passwordNotSet" };
      default:
        return { formError: "unavailable" };
    }
  }
  redirect(HOME_PATH);
}
