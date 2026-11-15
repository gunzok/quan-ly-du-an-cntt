import noHardcodedUiStrings from "./no-hardcoded-ui-strings.mjs";

/** Plugin ESLint cục bộ của dự án (khai báo trong eslint.config.mjs với tên "local"). */
const plugin = {
  meta: { name: "eslint-plugin-local" },
  rules: { "no-hardcoded-ui-strings": noHardcodedUiStrings },
};

export default plugin;
