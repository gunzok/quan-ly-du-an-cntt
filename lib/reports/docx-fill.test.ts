import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { getMessages } from "@/lib/i18n/messages";
import { inspectOoxml } from "@/lib/report-templates/ooxml";
import { docxFromBody, dumpDocx, p, tbl } from "@/tests/fixtures/reports/docx";
import {
  fixtureReportData,
  fixtureTask,
  readZipText,
} from "@/tests/fixtures/reports/report-data";
import {
  buildDocxData,
  evaluateTemplateExpression,
  fillDocxTemplate,
  TemplateSyntaxError,
  UnsafeTemplateError,
} from "./docx-fill";
import {
  SCALAR_PLACEHOLDERS,
  SECTION_FIELDS,
  SECTIONS,
  type ReportData,
} from "./placeholders";
import { renderDocxReport } from "./render";
import { buildSampleDocxTemplate } from "./sample-docx-template";

/**
 * Test bộ điền template docx (Story E5-4). Golden file: tệp xuất từ template mẫu + dữ liệu giả cố
 * định, đọc lại thành dòng chữ có cấu trúc (đoạn ¶, bảng ▦, dòng | ô |), KHÔNG so byte
 * (tests/fixtures/reports/golden/*-docx*.json). Sửa có chủ đích thì sinh lại:
 * UPDATE_GOLDEN=1 pnpm vitest run lib/reports/docx-fill.test.ts, rồi xem diff.
 */

const GOLDEN_DIR = new URL(
  "../../tests/fixtures/reports/golden/",
  import.meta.url,
);

function expectGolden(name: string, value: unknown) {
  const file = new URL(`${name}.json`, GOLDEN_DIR);
  const text = `${JSON.stringify(value, null, 2)}\n`;
  if (process.env.UPDATE_GOLDEN === "1") writeFileSync(file, text);
  expect(text).toBe(readFileSync(file, "utf8"));
}

/** Dữ liệu giả có bảng theo người phụ trách (kể cả "Chưa giao", người đã rời dự án). */
function dataWithAssignees(base = fixtureReportData()): ReportData {
  return {
    ...base,
    dashboard: {
      ...base.dashboard,
      by_assignee: [
        {
          assignee_id: "00000000-0000-4000-8000-0000000000a1",
          full_name: "Nguyễn Văn An",
          total: 2,
          done: 1,
          open: 1,
          overdue: 0,
        },
        {
          assignee_id: "00000000-0000-4000-8000-0000000000a2",
          full_name: null,
          total: 1,
          done: 0,
          open: 1,
          overdue: 1,
        },
        {
          assignee_id: null,
          full_name: null,
          total: 1,
          done: 0,
          open: 1,
          overdue: 0,
        },
      ],
    },
  };
}

const vi = getMessages("vi");
const EMPTY = {
  tasks: vi.reports.xlsx.noTasks,
  statuses: vi.reports.xlsx.noData,
  assignees: vi.reports.xlsx.noData,
};

async function fill(template: Uint8Array, data = fixtureReportData()) {
  const { scalarValues, sectionValues } = await import("./placeholders");
  return fillDocxTemplate(
    template,
    { scalars: scalarValues(data, vi), sections: sectionValues(data, vi) },
    { locale: "vi", emptyText: EMPTY },
  );
}

function bodyText(bytes: Uint8Array): string {
  return dumpDocx(bytes)["word/document.xml"].join("\n");
}

describe("template docx mẫu", () => {
  it("qua được kiểm tra tải lên của E5-2 (đúng chữ ký docx, không macro)", () => {
    expect(inspectOoxml(buildSampleDocxTemplate(vi), "docx")).toEqual({
      ok: true,
    });
  });

  it("sinh lại ra cùng byte (không lộ giờ máy chủ)", () => {
    expect(
      buildSampleDocxTemplate(vi).equals(buildSampleDocxTemplate(vi)),
    ).toBe(true);
  });

  it("golden: template mẫu", () => {
    expectGolden(
      "sample-docx-template-vi",
      dumpDocx(buildSampleDocxTemplate(vi)),
    );
  });

  it("golden: báo cáo tiếng Việt từ template mẫu", async () => {
    const out = await renderDocxReport(
      buildSampleDocxTemplate(vi),
      dataWithAssignees(),
      "vi",
    );
    expect(inspectOoxml(out, "docx")).toEqual({ ok: true });
    expectGolden("report-docx-vi", dumpDocx(out));
  });

  it("golden: báo cáo tiếng Anh, kỳ không có task", async () => {
    const en = getMessages("en");
    const out = await renderDocxReport(
      buildSampleDocxTemplate(en),
      fixtureReportData([]),
      "en",
    );
    expectGolden("report-docx-en-empty", dumpDocx(out));
  });

  it("2.000 task: đủ dòng, đúng thứ tự, dưới 15 giây (NFR-03 là 30 giây cả lượt xuất)", async () => {
    const tasks = Array.from({ length: 2000 }, (_, i) =>
      fixtureTask(i + 1, { title: `Task ${i + 1}` }),
    );
    const started = performance.now();
    const out = await renderDocxReport(
      buildSampleDocxTemplate(vi),
      fixtureReportData(tasks),
      "vi",
    );
    const ms = performance.now() - started;
    const lines = dumpDocx(out)["word/document.xml"];
    const taskRows = lines.filter((l) => /^\| [\d.]+ \| Task \d+ \|/.test(l));
    expect(taskRows).toHaveLength(2000);
    expect(taskRows[0]).toMatch(/^\| 1 \| Task 1 \|/);
    expect(taskRows[1999]).toMatch(/^\| 2\.000 \| Task 2000 \|/);
    expect(ms).toBeLessThan(15_000);
  }, 60_000);
});

describe("quy ước ô giữ chỗ docx", () => {
  it("mọi ô giữ chỗ chung và mọi trường vùng lặp đều điền được", async () => {
    const scalarLines = SCALAR_PLACEHOLDERS.map((k) => p(`${k}=[{{${k}}}]`));
    const tables = (Object.keys(SECTIONS) as (keyof typeof SECTIONS)[]).map(
      (section) => {
        const v = SECTIONS[section];
        const fields = SECTION_FIELDS[section];
        const blank = fields.slice(1).map(() => "");
        return tbl([
          [`{{FOR ${v} IN ${section}}}`, ...blank],
          fields.map((f) => `${v}.${f}=[{{${v}.${f}}}]`),
          [`{{END-FOR ${v}}}`, ...blank],
        ]);
      },
    );
    const out = await fill(
      docxFromBody([...scalarLines, ...tables].join("")),
      dataWithAssignees(),
    );
    const text = bodyText(out);
    expect(text).not.toContain("{{");
    expect(text).toContain("project.name=[Dự án mẫu E5-3]");
    expect(text).toContain("period.start=[01/11/2026]");
    expect(text).toContain("progress.ratio=[25%]");
    expect(text).toContain("report.generated_at=[18/11/2026 10:04]");
    expect(text).toContain("task.title=[=1+1 tiêu đề giống công thức]");
    expect(text).toContain("task.assignee=[Người đã rời dự án]");
    expect(text).toContain("assignee.name=[Chưa giao]");
    expect(text).toContain("status.ratio=[50%]");
  });

  it("biến vòng lặp viết có hoặc không có $; khóa trong ngoặc có dấu cách", async () => {
    const out = await fill(
      docxFromBody(
        tbl([
          ["{{FOR t IN tasks}}", ""],
          ["{{ $t.index }}", "{{t.title}}"],
          ["{{END-FOR t}}", ""],
        ]) + p("{{ project.name }}"),
      ),
    );
    expect(dumpDocx(out)["word/document.xml"]).toEqual([
      "▦",
      "| 1 | Thiết kế CSDL báo cáo |",
      "| 2 | =1+1 tiêu đề giống công thức |",
      "| 3 | +SUM(A1) và chữ có dấu: Ưu tiên |",
      "¶ Dự án mẫu E5-3",
    ]);
  });

  it("ô giữ chỗ bị Word cắt qua nhiều run (đổi kiểu giữa chừng) vẫn điền được", async () => {
    const body =
      '<w:p><w:r><w:t xml:space="preserve">Dự án: {{proj</w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>ect.na</w:t></w:r><w:r><w:t>me}} xong</w:t></w:r></w:p>';
    const out = await fill(docxFromBody(body));
    expect(bodyText(out)).toBe("¶ Dự án: Dự án mẫu E5-3 xong");
  });

  it("khóa sai chính tả: giữ nguyên trong tệp để người soạn thấy", async () => {
    const out = await fill(docxFromBody(p("A {{project.nmae}} B")));
    expect(bodyText(out)).toBe("¶ A {{project.nmae}} B");
  });

  it("ô giữ chỗ ở chân trang được điền", async () => {
    const out = await fill(
      docxFromBody(p("x"), p("{{project.name}} · {{period.end}}")),
    );
    expect(dumpDocx(out)["word/footer1.xml"]).toEqual([
      "¶ Dự án mẫu E5-3 · 30/11/2026",
    ]);
  });

  it("vùng lặp rỗng: bỏ dòng mẫu, {{empty.tasks}} có chữ", async () => {
    const out = await fill(
      docxFromBody(
        tbl([
          ["STT"],
          ["{{FOR task IN tasks}}"],
          ["{{task.index}}"],
          ["{{END-FOR task}}"],
        ]) +
          p("{{empty.tasks}}") +
          p("[{{empty.statuses}}]"),
      ),
      fixtureReportData([]),
    );
    expect(dumpDocx(out)["word/document.xml"]).toEqual([
      "▦",
      "| STT |",
      `¶ ${vi.reports.xlsx.noTasks}`,
      "¶ []",
    ]);
  });

  it("mô tả nhiều dòng thành ngắt dòng của Word", async () => {
    const data = fixtureReportData();
    data.project.description = "Dòng 1\nDòng 2";
    const out = await fill(docxFromBody(p("{{project.description}}")), data);
    expect(bodyText(out)).toBe("¶ Dòng 1⏎Dòng 2");
  });

  it("FOR trên khóa không phải vùng lặp, hoặc chèn cả vùng lặp: lỗi quy ước", async () => {
    await expect(
      fill(docxFromBody(p("{{FOR x IN project}}{{END-FOR x}}"))),
    ).rejects.toBeInstanceOf(TemplateSyntaxError);
    await expect(fill(docxFromBody(p("{{tasks}}")))).rejects.toBeInstanceOf(
      TemplateSyntaxError,
    );
  });
});

describe("an toàn: template KHÔNG chạy được mã", () => {
  const canaryName = `QLDA_DOCX_CANARY_${randomUUID().replace(/-/g, "")}`;
  const canary = `bi-mat-${randomUUID()}`;
  process.env[canaryName] = canary;
  const dir = mkdtempSync(join(tmpdir(), "qlda-docx-"));
  const secretFile = join(dir, "secret.txt");
  writeFileSync(secretFile, canary);
  afterAll(() => {
    delete process.env[canaryName];
    rmSync(dir, { recursive: true, force: true });
  });

  const fileJs = JSON.stringify(secretFile);
  const malicious = [
    `{{EXEC require('fs').readFileSync(${fileJs}, 'utf8')}}`,
    `{{! globalThis.__qldaPwned = process.env.${canaryName}}}`,
    `{{= require('fs').readFileSync(${fileJs}, 'utf8')}}`,
    `{{process.env['${canaryName}']}}`,
    `{{this.constructor.constructor('return process')().env.${canaryName}}}`,
    `{{(() => process.env.${canaryName})()}}`,
    `{{project.name.constructor}}`,
    `{{project.__proto__}}`,
    `{{IMAGE ({ width: 1, height: 1, data: require('fs').readFileSync(${fileJs}), extension: '.png' })}}`,
    `{{HTML '<p>' + process.env.${canaryName} + '</p>'}}`,
    `{{LINK ({ url: 'https://example.com/?' + process.env.${canaryName} })}}`,
    `{{ALIAS s EXEC process.exit(1)}}`,
    `{{*s}}`,
    `{{QUERY process.env}}`,
    `{{IF process.env.${canaryName}}}x{{END-IF}}`,
    `{{FOR x IN [process.env.${canaryName}]}}{{x}}{{END-FOR x}}`,
    `{{FOR x IN Object.keys(process.env)}}{{$x}}{{END-FOR x}}`,
  ];

  it.each(malicious)("từ chối cả template: %s", async (command) => {
    const template = docxFromBody(p(`Báo cáo ${command} hết`));
    const result = fill(template);
    await expect(result).rejects.toSatisfy(
      (e) =>
        e instanceof UnsafeTemplateError || e instanceof TemplateSyntaxError,
    );
    expect((globalThis as Record<string, unknown>).__qldaPwned).toBeUndefined();
  });

  it("đường dẫn hợp lệ trỏ ra ngoài dữ liệu (process.env...) không đọc được biến môi trường", async () => {
    const out = await fill(
      docxFromBody(
        p(`[{{process.env.${canaryName.toLowerCase()}}}]`) +
          p("[{{= global.process}}]") +
          p("[{{$idx}}]"),
      ),
    );
    const xml = readZipText(out, "word/document.xml") ?? "";
    expect(xml).not.toContain(canary);
    expect(bodyText(out)).toBe(
      [
        `¶ [{{process.env.${canaryName.toLowerCase()}}}]`,
        "¶ [{{global.process}}]",
        "¶ [{{$idx}}]",
      ].join("\n"),
    );
  });

  it("bộ tra khóa (lớp thứ hai, phòng bước duyệt lệnh bị lách) không chạy biểu thức", () => {
    const root = buildDocxData(
      { scalars: {}, sections: { tasks: [], statuses: [], assignees: [] } },
      { locale: "vi", emptyText: EMPTY },
    );
    for (const code of [
      "process.env",
      "require('fs')",
      "this",
      "constructor.constructor('return process')()",
      "a[0]",
      "a;b",
      "`x`",
      "__proto__",
      "x.__proto__",
      "project.constructor",
    ]) {
      const run = () => evaluateTemplateExpression(code, root, {});
      if (
        /^[a-z_.]+$/.test(code) &&
        !code.includes("proto") &&
        !code.includes("constructor")
      ) {
        // Đường dẫn hợp lệ nhưng không có trong dữ liệu: trả lại nguyên chữ, không đọc gì.
        expect(run()).toBe(`{{${code}}}`);
      } else {
        expect(run).toThrow(UnsafeTemplateError);
      }
    }
  });

  it("chữ người dùng nhập không chèn được XML (dấu || của docx-templates, thẻ, &)", async () => {
    const data = fixtureReportData([
      fixtureTask(1, {
        title: '||<w:r><w:t>CHEN</w:t></w:r>|| & <b>"đậm"</b>',
      }),
    ]);
    data.project.name = "{{EXEC process.exit(1)}} ||<w:br/>||";
    const out = await fill(
      docxFromBody(
        tbl([
          ["{{FOR task IN tasks}}"],
          ["{{task.title}}"],
          ["{{END-FOR task}}"],
        ]) + p("{{project.name}}"),
      ),
      data,
    );
    const xml = readZipText(out, "word/document.xml") ?? "";
    expect(xml).not.toContain("<w:t>CHEN</w:t>");
    expect(dumpDocx(out)["word/document.xml"]).toEqual([
      "▦",
      '| ||<w:r><w:t>CHEN</w:t></w:r>|| & <b>"đậm"</b> |',
      "¶ {{EXEC process.exit(1)}} ||<w:br/>||",
    ]);
  });
});
