import { LOGIN_ERROR_PARAM, loginErrorMessage } from "@/lib/auth/oauth";
import styles from "./login.module.css";

/**
 * Thông báo lỗi đăng nhập Google từ /login?error=<khóa> (do /auth/callback chuyển về).
 * Chỉ hiện thông báo cho khóa đã biết; văn bản luôn lấy từ lib/strings.ts, không lấy từ URL.
 */
export async function OAuthError({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const message = loginErrorMessage((await searchParams)[LOGIN_ERROR_PARAM]);
  if (!message) {
    return null;
  }
  return (
    <p role="alert" className={styles.formError}>
      {message}
    </p>
  );
}
