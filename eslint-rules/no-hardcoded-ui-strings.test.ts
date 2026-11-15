import { ESLint, RuleTester } from "eslint";
import { describe, expect, it } from "vitest";
import rule from "./no-hardcoded-ui-strings.mjs";

/**
 * Story E10-2 tiêu chí 2: CI chặn chuỗi giao diện gõ cứng. RuleTester chạy quy tắc trên từng đoạn
 * mã; phần cuối chạy ESLint với ĐÚNG eslint.config.mjs của repo để chắc quy tắc được bật cho
 * app/ và components/ (tắt quy tắc trong cấu hình thì test đỏ).
 */
RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const tester = new RuleTester({
  languageOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

tester.run("no-hardcoded-ui-strings", rule, {
  valid: [
    "const a = <p>{t.login.heading}</p>;",
    "const a = <p aria-label={t.language.groupLabel}>{t.x}</p>;",
    // Ký hiệu, số, khoảng trắng: không phải văn bản cần dịch.
    "const a = <p>· / → — 01 {' '} {`${n} / ${m}`}</p>;",
    // Thuộc tính không hiển thị cho người dùng.
    'const a = <div className="flex gap-2" id="email" role="alert" data-testid="x" lang="vi" />;',
    'const a = <input type="email" autoComplete="username" name="email" />;',
    // Chuỗi dùng vào việc khác trong biểu thức (không hiển thị).
    'const a = <p className={ok ? "text-danger" : "text-muted"}>{fmt("vi")}</p>;',
    "const a = <p>{ok ? t.yes : t.no}</p>;",
    'const a = <p key="row">{t.x}</p>;',
  ],
  invalid: [
    {
      code: "const a = <p>Xin chào</p>;",
      errors: [{ messageId: "text" }],
    },
    {
      code: "const a = <button>Save changes</button>;",
      errors: [{ messageId: "text" }],
    },
    {
      code: 'const a = <p>{"Đăng nhập"}</p>;',
      errors: [{ messageId: "text" }],
    },
    {
      code: 'const a = <p>{ok ? "Có" : "Không"}</p>;',
      errors: [{ messageId: "text" }, { messageId: "text" }],
    },
    {
      code: 'const a = <p>{loading && "Loading…"}</p>;',
      errors: [{ messageId: "text" }],
    },
    {
      code: "const a = <p>{`Còn ${n} task`}</p>;",
      errors: [{ messageId: "text" }],
    },
    {
      code: '<><input placeholder="Tìm theo tên…" /><img alt="Logo" /></>;',
      errors: [{ messageId: "attribute" }, { messageId: "attribute" }],
    },
    {
      code: 'const a = <nav aria-label="Main navigation" title={"Trang chủ"} />;',
      errors: [{ messageId: "attribute" }, { messageId: "attribute" }],
    },
    {
      code: 'const a = <Select label={ok ? "Vai trò" : t.role} />;',
      errors: [{ messageId: "attribute" }],
    },
  ],
});

describe("cấu hình ESLint của repo", () => {
  it("bật quy tắc ở app/ và components/, báo lỗi chuỗi cứng", async () => {
    const eslint = new ESLint({ cwd: process.cwd() });
    for (const file of ["app/login/page.tsx", "components/ui/x.tsx"]) {
      const config = (await eslint.calculateConfigForFile(file)) as {
        rules: Record<string, unknown>;
      };
      expect(config.rules["local/no-hardcoded-ui-strings"], file).toEqual([2]);
    }
    const [result] = await eslint.lintText(
      'export function X() {\n  return <p title="Xin chào">Hello</p>;\n}\n',
      { filePath: "components/demo.tsx" },
    );
    const hits = result.messages.filter(
      (m) => m.ruleId === "local/no-hardcoded-ui-strings",
    );
    expect(hits).toHaveLength(2);
  });

  it("chặn giao diện import @/lib/strings (chuỗi tiếng Việt cố định)", async () => {
    const eslint = new ESLint({ cwd: process.cwd() });
    const [result] = await eslint.lintText(
      'import { strings } from "@/lib/strings";\nexport const x = strings.app.name;\n',
      { filePath: "components/demo.tsx" },
    );
    expect(result.messages.map((m) => m.ruleId)).toContain(
      "no-restricted-imports",
    );
  });
});
