/**
 * Bảng token màu ĐÃ DUYỆT (docs/03-design/design-system.md mục 1), chép lại để test so với
 * app/globals.css (unit) và với giá trị trình duyệt tính ra trên /dev/ui (Playwright).
 * Đổi màu phải đổi cả ba nơi: tài liệu, globals.css, bảng này.
 */
export type ThemeName = "light" | "dark";

const shared = {
  "--color-brand": "#2054f0",
  "--color-on-brand": "#ffffff",
} as const;

export const TOKENS: Record<ThemeName, Record<string, string>> = {
  light: {
    "--color-bg": "#ffffff",
    "--color-bg-subtle": "#f7f8fa",
    "--color-bg-muted": "#eef2fd",
    "--color-canvas": "#cddbf2",
    "--color-text": "#0a0f1f",
    "--color-text-muted": "#4a5163",
    "--color-primary": "#2054f0",
    "--color-primary-hover": "#1840c8",
    "--color-on-primary": "#ffffff",
    ...shared,
    "--color-accent": "#e56daf",
    "--color-accent-text": "#b0256e",
    "--color-success": "#137035",
    "--color-warning": "#a34a06",
    "--color-danger": "#c0262d",
    "--color-border": "#e3e7ef",
    "--color-border-strong": "#6b7385",
    "--color-blueprint": "rgb(32 84 240 / 0.1)",
  },
  dark: {
    "--color-bg": "#05060a",
    "--color-bg-subtle": "#0d1020",
    "--color-bg-muted": "#161b33",
    "--color-canvas": "#030304",
    "--color-text": "#e8eaf2",
    "--color-text-muted": "#9aa2b8",
    "--color-primary": "#7b97ff",
    "--color-primary-hover": "#9db2ff",
    "--color-on-primary": "#05060a",
    ...shared,
    "--color-accent": "#f07dba",
    "--color-accent-text": "#f28cc4",
    "--color-success": "#4ade80",
    "--color-warning": "#fbbf24",
    "--color-danger": "#f87171",
    "--color-border": "#232a45",
    "--color-border-strong": "#7d87a6",
    "--color-blueprint": "rgb(123 151 255 / 0.1)",
  },
};

/** Tỷ lệ tương phản WCAG 2.1 giữa hai màu hex #rrggbb. */
export function contrastRatio(a: string, b: string): number {
  const [la, lb] = [luminance(a), luminance(b)];
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

function luminance(hex: string): number {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match) {
    throw new Error(`Màu không phải #rrggbb: ${hex}`);
  }
  const value = Number.parseInt(match[1], 16);
  const channels = [value >> 16, (value >> 8) & 0xff, value & 0xff].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

/** Trộn `fg` với tỷ lệ `alpha` cùng `bg` trong sRGB, như color-mix(in srgb, ...) (hover nút nguy hiểm). */
export function mix(fg: string, alpha: number, bg: string): string {
  const parse = (hex: string) =>
    [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
  const [f, b] = [parse(fg), parse(bg)];
  return `#${f
    .map((c, i) =>
      Math.round(c * alpha + b[i] * (1 - alpha))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}
