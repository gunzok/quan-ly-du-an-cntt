import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getMessages } from "@/lib/i18n/messages";
import {
  fixtureReportData,
  fixtureTask,
} from "@/tests/fixtures/reports/report-data";
import {
  periodCounts,
  scalarValues,
  SCALAR_PLACEHOLDERS,
  SECTION_FIELDS,
  SECTIONS,
  sectionValues,
  taskValues,
} from "./placeholders";

const DOC = readFileSync(
  new URL("../../docs/03-design/report-template-xlsx.md", import.meta.url),
  "utf8",
);
const t = getMessages("vi");

describe("hợp đồng ô giữ chỗ", () => {
  it("tài liệu liệt kê đủ mọi ô giữ chỗ trong code và không thừa", () => {
    const inCode = [
      ...SCALAR_PLACEHOLDERS,
      ...Object.entries(SECTION_FIELDS).flatMap(([section, fields]) =>
        fields.map((f) => `${SECTIONS[section as keyof typeof SECTIONS]}.${f}`),
      ),
    ];
    const inDoc = [...DOC.matchAll(/\| `\{\{([a-z_.]+)\}\}` \|/g)].map(
      (m) => m[1],
    );
    expect(new Set(inDoc)).toEqual(new Set(inCode));
    for (const section of Object.keys(SECTIONS)) {
      expect(DOC).toContain(`{{#${section}}}`);
    }
  });

  it("scalarValues có đúng mọi khóa chung", () => {
    const values = scalarValues(fixtureReportData(), t);
    expect(Object.keys(values).sort()).toEqual([...SCALAR_PLACEHOLDERS].sort());
  });

  it("sectionValues có đúng các trường của từng vùng", () => {
    const data = fixtureReportData();
    const sections = sectionValues(
      {
        ...data,
        dashboard: {
          ...data.dashboard,
          by_assignee: [
            {
              assignee_id: null,
              full_name: null,
              total: 1,
              done: 0,
              open: 1,
              overdue: 0,
            },
          ],
        } as typeof data.dashboard,
      },
      t,
    );
    for (const [section, prefix] of Object.entries(SECTIONS)) {
      const rows = sections[section as keyof typeof SECTIONS];
      expect(rows.length).toBeGreaterThan(0);
      expect(Object.keys(rows[0]).sort()).toEqual(
        SECTION_FIELDS[section as keyof typeof SECTIONS]
          .map((f) => `${prefix}.${f}`)
          .sort(),
      );
    }
    expect(sections.assignees[0]["assignee.name"]).toEqual({
      kind: "text",
      value: "Chưa giao",
    });
  });
});

describe("giá trị", () => {
  it("đếm trong kỳ theo giờ Việt Nam (23:59:59 ngày cuối vẫn trong kỳ)", () => {
    const counts = periodCounts({
      period: { start: "2026-11-01", end: "2026-11-30" },
      tasks: [
        fixtureTask(1, { created_at: "2026-10-31T17:00:00Z" }),
        fixtureTask(2, { created_at: "2026-10-31T16:59:59Z" }),
        fixtureTask(3, {
          completed_at: "2026-11-30T16:59:59Z",
          due_date: "2026-11-30",
        }),
        fixtureTask(4, {
          completed_at: "2026-11-30T17:00:00Z",
          due_date: "2026-12-01",
        }),
      ],
    });
    expect(counts).toEqual({ created: 3, completed: 1, due: 1 });
  });

  it("task trễ hạn: chưa xong và hạn trước hôm nay", () => {
    const overdue = (o: Parameters<typeof fixtureTask>[1]) =>
      taskValues(fixtureTask(1, o), 0, "2026-11-18", t)["task.overdue"];
    expect(overdue({ due_date: "2026-11-17" })).toEqual({
      kind: "text",
      value: "Trễ hạn",
    });
    expect(overdue({ due_date: "2026-11-18" })).toEqual({
      kind: "text",
      value: "",
    });
    expect(
      overdue({ due_date: "2026-11-17", completed_at: "2026-11-17T01:00:00Z" }),
    ).toEqual({ kind: "text", value: "" });
  });

  it("dự án chưa có task: tỷ lệ 0, không chia cho 0", () => {
    const data = fixtureReportData([]);
    const values = scalarValues(
      { ...data, dashboard: { ...data.dashboard, total: 0, done: 0 } },
      t,
    );
    expect(values["progress.ratio"]).toEqual({ kind: "ratio", value: 0 });
    expect(values["progress.percent"]).toEqual({ kind: "number", value: 0 });
  });
});
