"use client";

import { useState } from "react";
import { strings } from "@/lib/strings";

type ThemeChoice = "system" | "light" | "dark";

const choices: { value: ThemeChoice; label: string }[] = [
  { value: "system", label: strings.devUi.themeSystem },
  { value: "light", label: strings.devUi.themeLight },
  { value: "dark", label: strings.devUi.themeDark },
];

/**
 * Đổi data-theme trên <html> để xem thử (không lưu: lưu lựa chọn thuộc Story khác).
 * "Theo hệ thống" bỏ thuộc tính, để prefers-color-scheme quyết định.
 */
export function ThemeSwitch() {
  const [theme, setTheme] = useState<ThemeChoice>("system");

  function choose(next: ThemeChoice) {
    setTheme(next);
    const root = document.documentElement;
    if (next === "system") {
      root.removeAttribute("data-theme");
    } else {
      root.setAttribute("data-theme", next);
    }
  }

  return (
    <fieldset className="flex flex-wrap items-center gap-2 border-0">
      <legend className="label mb-2">{strings.devUi.themeLabel}</legend>
      {choices.map((choice) => (
        <label
          key={choice.value}
          className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-pill border border-solid border-border-strong bg-bg px-3 font-mono text-label uppercase text-text has-checked:border-primary has-checked:bg-primary has-checked:text-on-primary has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-primary has-focus-visible:outline-solid sm:min-h-8"
        >
          <input
            type="radio"
            name="theme"
            value={choice.value}
            checked={theme === choice.value}
            onChange={() => choose(choice.value)}
            className="sr-only"
          />
          {choice.label}
        </label>
      ))}
    </fieldset>
  );
}
