import { strings } from "@/lib/strings";
import styles from "./login.module.css";

/** Chỗ giữ chỗ: Story E10-2 làm chức năng đổi ngôn ngữ. */
export function LanguageSwitcher() {
  return (
    <div
      className={styles.languages}
      role="group"
      aria-label={strings.language.groupLabel}
    >
      <button
        type="button"
        className={styles.languageButton}
        aria-pressed="true"
        lang="vi"
      >
        {strings.language.vi}
      </button>
      <button
        type="button"
        className={styles.languageButton}
        aria-pressed="false"
        disabled
        title={strings.language.comingSoon}
        lang="en"
      >
        {strings.language.en}
      </button>
    </div>
  );
}
