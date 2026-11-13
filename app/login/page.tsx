import type { Metadata } from "next";
import { strings } from "@/lib/strings";
import { LanguageSwitcher } from "./language-switcher";
import { LoginForm } from "./login-form";
import styles from "./login.module.css";

export const metadata: Metadata = {
  title: `${strings.login.pageTitle} · ${strings.app.name}`,
};

/** S01 Đăng nhập, bản Blueprint v3 (docs/03-design/ui-ux/mockups/v3/bp-Main.dc.html). */
export default function LoginPage() {
  return (
    <div className={styles.canvas}>
      <div className={styles.frame}>
        <aside className={styles.brandPanel}>
          <div className={styles.brand}>
            <span className={styles.logo} aria-hidden="true">
              {strings.app.logoLetters}
            </span>
            <span className={styles.brandName}>{strings.app.name}</span>
          </div>

          <svg
            className={styles.brandArt}
            aria-hidden="true"
            width="360"
            height="360"
            viewBox="0 0 360 360"
            fill="none"
            stroke="currentColor"
            strokeWidth="1"
          >
            <circle cx="180" cy="180" r="150" />
            <circle cx="180" cy="180" r="90" />
            <path d="M0 180H360M180 0V360" />
            <circle className={styles.brandArtDot} cx="180" cy="180" r="4" />
          </svg>

          <div className={styles.brandHero}>
            <span className={styles.eyebrowOnBrand}>
              <span className={styles.dot} aria-hidden="true" />
              {strings.brand.eyebrow}
            </span>
            <p className={styles.brandTitle}>
              {strings.brand.title}
              <span className={styles.accentDot} aria-hidden="true">
                .
              </span>
            </p>
          </div>

          <ul className={styles.features}>
            {strings.brand.features.map((f) => (
              <li key={f.label} className={styles.feature}>
                <span className={styles.featureLabel}>{f.label}</span>
                <span className={styles.featureText}>{f.text}</span>
              </li>
            ))}
          </ul>
        </aside>

        <main className={styles.formPanel}>
          <LanguageSwitcher />

          <div className={styles.formCenter}>
            <section className={styles.formBox} aria-labelledby="login-heading">
              <div className={styles.titleGroup}>
                <span className="label">
                  <span className={styles.dot} aria-hidden="true" />{" "}
                  {strings.login.eyebrow}
                </span>
                <h1 id="login-heading" className={styles.title}>
                  {strings.login.heading}
                  <span className={styles.accentDot} aria-hidden="true">
                    .
                  </span>
                </h1>
                <p className={styles.subtitle}>{strings.login.subtitle}</p>
              </div>

              <LoginForm />

              <div className={styles.divider} aria-hidden="true">
                <span className="label">{strings.login.divider}</span>
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
          </div>
        </main>
      </div>
    </div>
  );
}
