import { describe, expect, it } from "vitest";
import { validateProjectPatch } from "@/lib/projects/validate";
import { PROJECT_TEMPLATE_NAME_MAX } from "./model";
import {
  normalizeTemplateName,
  validateTemplateListQuery,
  validateTemplatePatch,
  validateTemplateSave,
} from "./validate";

describe("validateTemplateSave", () => {
  it("chuẩn hóa tên: NFC, gộp khoảng trắng, cắt hai đầu", () => {
    expect(validateTemplateSave({ name: "  Mẫu   phần mềm " })).toEqual({
      ok: true,
      data: { name: "Mẫu phần mềm" },
    });
    expect(normalizeTemplateName("Mẫu".normalize("NFD"))).toBe("Mẫu");
  });

  it.each([
    [{}, [{ field: "name", issue: "required" }]],
    [{ name: "   " }, [{ field: "name", issue: "required" }]],
    [{ name: 1 }, [{ field: "name", issue: "invalid_value" }]],
    [
      { name: "x".repeat(PROJECT_TEMPLATE_NAME_MAX + 1) },
      [{ field: "name", issue: "too_long" }],
    ],
    [{ name: "a\u0000b" }, [{ field: "name", issue: "invalid_format" }]],
    [{ name: "mẫu‮gpj" }, [{ field: "name", issue: "invalid_format" }]],
    [
      { name: "A", project_id: "x", structure: {} },
      [
        { field: "project_id", issue: "unknown_field" },
        { field: "structure", issue: "unknown_field" },
      ],
    ],
  ])("từ chối %j", (body, details) => {
    expect(validateTemplateSave(body)).toEqual({ ok: false, details });
  });

  it("thân không phải object", () => {
    for (const body of [null, [], "x"]) {
      expect(validateTemplateSave(body)).toEqual({
        ok: false,
        details: [{ field: "body", issue: "invalid_format" }],
      });
    }
  });
});

describe("validateTemplatePatch", () => {
  it("nhận name và/hoặc archived", () => {
    expect(validateTemplatePatch({ name: " B " })).toEqual({
      ok: true,
      data: { name: "B" },
    });
    expect(validateTemplatePatch({ archived: true })).toEqual({
      ok: true,
      data: { archived: true },
    });
  });

  it.each([
    [{}, [{ field: "body", issue: "required" }]],
    [{ archived: "yes" }, [{ field: "archived", issue: "invalid_value" }]],
    [{ name: "" }, [{ field: "name", issue: "required" }]],
    [
      { created_by: "x", structure: {} },
      [
        { field: "created_by", issue: "unknown_field" },
        { field: "structure", issue: "unknown_field" },
      ],
    ],
  ])("từ chối %j", (body, details) => {
    expect(validateTemplatePatch(body)).toEqual({ ok: false, details });
  });
});

describe("validateTemplateListQuery", () => {
  it("mặc định ẩn template đã lưu trữ", () => {
    expect(validateTemplateListQuery(new URLSearchParams())).toEqual({
      ok: true,
      data: { includeArchived: false },
    });
    expect(
      validateTemplateListQuery(new URLSearchParams("include_archived=true")),
    ).toEqual({ ok: true, data: { includeArchived: true } });
  });

  it("từ chối giá trị lạ, lặp tham số, tham số lạ", () => {
    for (const qs of [
      "include_archived=1",
      "include_archived=true&include_archived=false",
      "q=x",
    ]) {
      expect(validateTemplateListQuery(new URLSearchParams(qs)).ok).toBe(false);
    }
  });
});

describe("PATCH dự án không nhận template_id", () => {
  it("template_id chỉ dùng khi tạo", () => {
    expect(validateProjectPatch({ template_id: null })).toEqual({
      ok: false,
      details: [{ field: "template_id", issue: "unknown_field" }],
    });
  });
});
