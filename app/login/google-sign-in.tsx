"use client";

import { useFormStatus } from "react-dom";
import { signInWithGoogle } from "@/lib/auth/actions";
import { strings } from "@/lib/strings";
import styles from "./login.module.css";

function GoogleButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className={styles.secondaryButton}
      disabled={pending}
      aria-busy={pending || undefined}
      aria-describedby="google-hint"
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="9" />
        <path d="M12 8v8M8 12h8" />
      </svg>
      {pending ? strings.login.googleRedirecting : strings.login.google}
    </button>
  );
}

/**
 * Nút "Tiếp tục với Google" (Story E1-2): gửi Server Action, máy chủ tạo URL Supabase Auth
 * (PKCE, code verifier trong cookie httpOnly) rồi chuyển trình duyệt sang Google.
 */
export function GoogleSignIn() {
  return (
    <form action={signInWithGoogle} className={styles.googleGroup}>
      <GoogleButton />
      <p id="google-hint" className={styles.hint}>
        {strings.login.googleHint}
      </p>
    </form>
  );
}
