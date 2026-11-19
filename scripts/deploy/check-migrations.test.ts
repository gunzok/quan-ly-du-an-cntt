import { describe, expect, it } from "vitest";
import { checkMigrations, parseNameStatus } from "./check-migrations";

const dir = "supabase/migrations";
const base = [
  `${dir}/20261113000000_init.sql`,
  `${dir}/20261115330000_task_open_blockers.sql`,
];

describe("parseNameStatus", () => {
  it("đọc A/M/D và R/C có hai đường dẫn (định dạng -z)", () => {
    const out = [
      "A",
      `${dir}/b.sql`,
      "M",
      `${dir}/a.sql`,
      "R100",
      `${dir}/old.sql`,
      `${dir}/new.sql`,
      "D",
      `${dir}/x.sql`,
      "",
    ].join("\0");
    expect(parseNameStatus(out)).toEqual([
      { status: "A", path: `${dir}/b.sql` },
      { status: "M", path: `${dir}/a.sql` },
      { status: "R", path: `${dir}/new.sql`, from: `${dir}/old.sql` },
      { status: "D", path: `${dir}/x.sql` },
    ]);
  });
});

describe("checkMigrations", () => {
  it("xanh khi chỉ thêm migration mới có timestamp lớn hơn", () => {
    const added = `${dir}/20261115350000_block_parent_delete.sql`;
    const report = checkMigrations({
      baseFiles: base,
      headFiles: [...base, added],
      changes: [{ status: "A", path: added }],
    });
    expect(report).toEqual({
      errors: [],
      warnings: [],
      added: ["20261115350000_block_parent_delete.sql"],
    });
  });

  it("đỏ khi sửa, xóa hoặc đổi tên migration đã merge", () => {
    const report = checkMigrations({
      baseFiles: base,
      headFiles: [`${dir}/20261115340000_renamed.sql`],
      changes: [
        { status: "M", path: base[0] },
        { status: "D", path: base[1] },
        {
          status: "R",
          from: base[1],
          path: `${dir}/20261115340000_renamed.sql`,
        },
      ],
    });
    expect(report.errors).toHaveLength(3);
    expect(report.errors[0]).toMatch(/Không được sửa .*20261113000000_init/);
    expect(report.errors[1]).toMatch(/Không được xóa/);
    expect(report.errors[2]).toMatch(/Không được đổi tên/);
  });

  it("bỏ qua thay đổi ngoài thư mục migration", () => {
    const report = checkMigrations({
      baseFiles: base,
      headFiles: base,
      changes: [{ status: "M", path: "supabase/seed.sql" }],
    });
    expect(report.errors).toEqual([]);
  });

  it("đỏ khi tên sai dạng hoặc trùng timestamp", () => {
    const report = checkMigrations({
      baseFiles: base,
      headFiles: [
        ...base,
        `${dir}/20261115350000_a.sql`,
        `${dir}/20261115350000_b.sql`,
        `${dir}/2026_thieu_so.sql`,
        `${dir}/20261115360000_Viet-Hoa.sql`,
      ],
      changes: [],
    });
    expect(report.errors.join("\n")).toMatch(/Trùng timestamp 20261115350000/);
    expect(report.errors.join("\n")).toMatch(/sai dạng: 2026_thieu_so.sql/);
    expect(report.errors.join("\n")).toMatch(/sai dạng: 20261115360000_Viet/);
  });

  it("migration mới lùi timestamp: cảnh báo, --strict thì đỏ", () => {
    const added = `${dir}/20261115320000_late.sql`;
    const input = {
      baseFiles: base,
      headFiles: [...base, added],
      changes: [{ status: "A", path: added }],
    };
    const loose = checkMigrations(input);
    expect(loose.errors).toEqual([]);
    expect(loose.warnings[0]).toMatch(
      /20261115320000 không lớn hơn .*20261115330000.*đổi tên tệp/,
    );
    expect(checkMigrations({ ...input, strict: true }).errors).toHaveLength(1);
  });
});
