import { LOGIN_ERROR_PARAM, loginErrorMessage } from "@/lib/auth/oauth";
import { getStrings } from "@/lib/i18n/server";
import styles from "./login.module.css";

/**
 * Thông báo lỗi đăng nhập Google từ /login?error=<khóa> (do /auth/callback chuyển về).
 * Chỉ hiện thông báo cho khóa đã biết; văn bản luôn lấy từ từ điển theo ngôn ngữ, không lấy từ URL.
 */
export async function OAuthError({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const message = loginErrorMessage(
    (await searchParams)[LOGIN_ERROR_PARAM],
    await getStrings(),
  );
  if (!message) {
    return null;
  }
  return (
    <p role="alert" className={styles.formError}>
      {message}
    </p>
  );
}
