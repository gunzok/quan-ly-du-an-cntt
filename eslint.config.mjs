import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier/flat";
import local from "./eslint-rules/index.mjs";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Tắt các luật định dạng trùng với Prettier (Prettier lo phần định dạng).
  prettier,
  {
    // Bỏ chỉ thị eslint-disable thừa (ngoại lệ chuỗi gõ cứng phải thật sự cần).
    linterOptions: { reportUnusedDisableDirectives: "error" },
  },
  {
    // Story E10-2 (NFR-11): giao diện không gõ cứng chuỗi; chuỗi nằm trong lib/i18n/messages.
    files: ["app/**/*.{ts,tsx}", "components/**/*.{ts,tsx}"],
    plugins: { local },
    rules: {
      "local/no-hardcoded-ui-strings": "error",
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@/lib/strings",
              message:
                "Giao diện lấy chuỗi theo ngôn ngữ: getStrings() (lib/i18n/server) ở Server Component, useStrings() (lib/i18n/client) ở Client Component.",
            },
          ],
        },
      ],
    },
  },
  {
    // Route Handler API trả thông điệp tiếng Việt cho khách API (kèm message_key), được dùng lib/strings.
    files: ["app/api/**/*.ts"],
    rules: { "no-restricted-imports": "off" },
  },
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "coverage/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
