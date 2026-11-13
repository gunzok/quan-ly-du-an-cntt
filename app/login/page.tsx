import type { Metadata } from "next";
import { strings } from "@/lib/strings";
import { LanguageSwitcher } from "./language-switcher";
import { LoginForm } from "./login-form";
import styles from "./login.module.css";

export const metadata: Metadata = {
  title: `${strings.login.pageTitle} · ${strings.app.name}`,
};

export default function LoginPage() {
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.brand}>
          <span className={styles.logo} aria-hidden="true">
            {strings.app.logoLetter}
          </span>
          <span className={styles.brandName}>{strings.app.name}</span>
        </div>
        <LanguageSwitcher />
      </header>

      <main className={styles.main}>
        <section className={styles.card} aria-labelledby="login-heading">
          <div className={styles.titleGroup}>
            <h1 id="login-heading" className={styles.title}>
              {strings.login.heading}
            </h1>
            <p className={styles.subtitle}>{strings.login.subtitle}</p>
          </div>

          <LoginForm />

          <div className={styles.divider} aria-hidden="true">
            <span>{strings.login.divider}</span>
          </div>

          {/* Story E1-2 bật đăng nhập Google. */}
          <div className={styles.googleGroup}>
            <button
              type="button"
              className={styles.secondaryButton}
              disabled
              aria-describedby="google-coming-soon"
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
              {strings.login.google}
            </button>
            <p id="google-coming-soon" className={styles.hint}>
              {strings.login.googleComingSoon}
            </p>
          </div>

          <p className={styles.hint}>{strings.login.inviteOnly}</p>
        </section>
      </main>
    </div>
  );
}
