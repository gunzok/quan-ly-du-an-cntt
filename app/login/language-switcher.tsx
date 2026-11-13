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
        aria-label={strings.language.vi}
        lang="vi"
      >
        {strings.language.viShort}
      </button>
      <button
        type="button"
        className={styles.languageButton}
        aria-pressed="false"
        aria-label={strings.language.en}
        title={strings.language.comingSoon}
        disabled
        lang="en"
      >
        {strings.language.enShort}
      </button>
    </div>
  );
}
