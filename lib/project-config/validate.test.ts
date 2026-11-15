import { describe, expect, it } from "vitest";
import {
  CONFIG_NAME_MAX_LENGTH,
  normalizeConfigName,
  validateConfigCreate,
  validateConfigDeleteQuery,
  validateConfigListQuery,
  validateConfigPatch,
  validateTaskTypesQuery,
} from "./validate";

const UUID = "0e91a3b2-4c5d-4e6f-8a9b-0c1d2e3f4a5b";

describe("validateConfigCreate", () => {
  it("trạng thái: tên chuẩn hóa, nhóm bắt buộc, màu viết hoa", () => {
    expect(
      validateConfigCreate("statuses", {
        name: "  Chờ   duyệt ",
        category: "in_progress",
        color: "#e56daf",
      }),
    ).toEqual({
      ok: true,
      data: { name: "Chờ duyệt", category: "in_progress", color: "#E56DAF" },
    });
    expect(validateConfigCreate("statuses", { name: "x" })).toEqual({
      ok: false,
      details: [{ field: "category", issue: "required" }],
    });
    expect(
      validateConfigCreate("statuses", { name: "x", category: "blocked" }),
    ).toEqual({
      ok: false,
      details: [{ field: "category", issue: "invalid_value" }],
    });
  });

  it("loại task: is_milestone, position; nhãn không nhận position", () => {
    expect(
      validateConfigCreate("task-types", {
        name: "Mốc",
        is_milestone: true,
        position: 2.5,
      }),
    ).toEqual({
      ok: true,
      data: { name: "Mốc", is_milestone: true, position: 2.5 },
    });
    expect(
      validateConfigCreate("task-types", { name: "x", is_milestone: "yes" }),
    ).toEqual({
      ok: false,
      details: [{ field: "is_milestone", issue: "invalid_value" }],
    });
    const r = validateConfigCreate("labels", {
      name: "x",
      position: 1,
      category: "todo",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.details.every((d) => d.issue === "unknown_field")).toBe(true);
      expect(r.details).toHaveLength(2);
    }
  });

  it("tên: thiếu, rỗng, quá dài, ký tự điều khiển, sai kiểu", () => {
    const cases: [unknown, string][] = [
      [undefined, "required"],
      [null, "required"],
      ["   ", "required"],
      ["a".repeat(CONFIG_NAME_MAX_LENGTH + 1), "too_long"],
      ["a\u0000b", "invalid_format"],
      [12, "invalid_value"],
    ];
    for (const [name, issue] of cases) {
      expect(validateConfigCreate("labels", { name })).toEqual({
        ok: false,
        details: [{ field: "name", issue }],
      });
    }
    expect(
      validateConfigCreate("labels", {
        name: "a".repeat(CONFIG_NAME_MAX_LENGTH),
      }).ok,
    ).toBe(true);
  });

  it("màu phải là #RRGGBB; position hữu hạn trong giới hạn", () => {
    for (const color of ["red", "#FFF", "#GGGGGG", null, 1]) {
      expect(validateConfigCreate("labels", { name: "x", color })).toEqual({
        ok: false,
        details: [{ field: "color", issue: "invalid_format" }],
      });
    }
    for (const position of [Infinity, Number.NaN, 2e9, "1", null]) {
      expect(
        validateConfigCreate("task-types", { name: "x", position }).ok,
      ).toBe(false);
    }
  });

  it("thân không phải object", () => {
    for (const body of [null, [], "x"]) {
      expect(validateConfigCreate("statuses", body)).toEqual({
        ok: false,
        details: [{ field: "body", issue: "invalid_format" }],
      });
    }
  });
});

describe("validateConfigPatch", () => {
  it("chỉ trường có mặt; phải có ít nhất một trường", () => {
    expect(validateConfigPatch("statuses", { position: 4.5 })).toEqual({
      ok: true,
      data: { position: 4.5 },
    });
    expect(validateConfigPatch("statuses", { category: "done" })).toEqual({
      ok: true,
      data: { category: "done" },
    });
    expect(validateConfigPatch("labels", {})).toEqual({
      ok: false,
      details: [{ field: "body", issue: "required" }],
    });
  });

  it("từ chối trường lạ và trường hệ thống", () => {
    const r = validateConfigPatch("statuses", {
      project_id: UUID,
      id: UUID,
      task_count: 3,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.details.map((d) => d.field).sort()).toEqual([
        "id",
        "project_id",
        "task_count",
      ]);
    }
  });

  it("đổi tên rỗng bị từ chối", () => {
    expect(validateConfigPatch("task-types", { name: " " })).toEqual({
      ok: false,
      details: [{ field: "name", issue: "required" }],
    });
  });
});

describe("tham số truy vấn", () => {
  it("danh sách theo dự án không nhận tham số", () => {
    expect(validateConfigListQuery(new URLSearchParams()).ok).toBe(true);
    expect(validateConfigListQuery(new URLSearchParams("q=x")).ok).toBe(false);
  });

  it("GET /task-types cần project_id là uuid", () => {
    expect(
      validateTaskTypesQuery(
        new URLSearchParams({ project_id: UUID.toUpperCase() }),
      ),
    ).toEqual({ ok: true, data: { project_id: UUID } });
    expect(validateTaskTypesQuery(new URLSearchParams())).toEqual({
      ok: false,
      details: [{ field: "project_id", issue: "required" }],
    });
    expect(
      validateTaskTypesQuery(new URLSearchParams("project_id=abc")).ok,
    ).toBe(false);
    expect(
      validateTaskTypesQuery(
        new URLSearchParams(`project_id=${UUID}&project_id=${UUID}`),
      ).ok,
    ).toBe(false);
  });

  it("DELETE: replace_with chỉ cho trạng thái và loại", () => {
    expect(
      validateConfigDeleteQuery(
        "statuses",
        new URLSearchParams({ replace_with: UUID }),
      ),
    ).toEqual({ ok: true, data: { replace_with: UUID } });
    expect(
      validateConfigDeleteQuery("task-types", new URLSearchParams()),
    ).toEqual({ ok: true, data: { replace_with: null } });
    expect(
      validateConfigDeleteQuery(
        "statuses",
        new URLSearchParams({ replace_with: "x" }),
      ).ok,
    ).toBe(false);
    expect(
      validateConfigDeleteQuery(
        "labels",
        new URLSearchParams({ replace_with: UUID }),
      ),
    ).toEqual({
      ok: false,
      details: [{ field: "replace_with", issue: "unknown_field" }],
    });
  });

  it("normalizeConfigName gộp khoảng trắng", () => {
    expect(normalizeConfigName("  a \t b ")).toBe("a b");
  });
});
