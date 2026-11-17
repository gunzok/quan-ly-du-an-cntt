import { describe, expect, it } from "vitest";
import {
  checkFileName,
  mimeMatches,
  validatePatch,
  validateUploadForm,
} from "./validate";
import { REPORT_TEMPLATE_MIME } from "./model";

describe("checkFileName", () => {
  it("nhận .xlsx/.docx, không phân biệt hoa thường đuôi", () => {
    expect(checkFileName("Báo cáo tuần.xlsx")).toEqual({
      ok: true,
      kind: "xlsx",
      baseName: "Báo cáo tuần",
    });
    expect(checkFileName("Mau  thang.DOCX")).toEqual({
      ok: true,
      kind: "docx",
      baseName: "Mau thang",
    });
  });

  it.each([
    "bao-cao.xlsm",
    "bao-cao.docm",
    "bao-cao.pdf",
    "bao-cao.docx.exe",
    "bao-cao",
    "bao-cao.",
  ])("từ chối loại tệp %s", (name) => {
    expect(checkFileName(name)).toEqual({
      ok: false,
      reason: "unsupported_type",
    });
  });

  it.each([
    "../../etc/passwd.docx",
    "thu-muc/bao-cao.docx",
    "C:\\Users\\a\\bao-cao.docx",
    "bao\u0000cao.docx",
    "bao-cao\u202excod.exe.docx",
    ".docx",
    "a".repeat(300) + ".docx",
    "   .xlsx",
  ])("từ chối tên độc hại %j", (name) => {
    expect(checkFileName(name)).toMatchObject({ ok: false });
  });
});

describe("mimeMatches", () => {
  it("MIME đúng, rỗng hoặc octet-stream: nhận; khác: từ chối", () => {
    expect(mimeMatches("xlsx", REPORT_TEMPLATE_MIME.xlsx)).toBe(true);
    expect(mimeMatches("docx", "")).toBe(true);
    expect(mimeMatches("docx", "application/octet-stream")).toBe(true);
    expect(mimeMatches("docx", REPORT_TEMPLATE_MIME.xlsx)).toBe(false);
    expect(
      mimeMatches("xlsx", "application/vnd.ms-excel.sheet.macroEnabled.12"),
    ).toBe(false);
    expect(mimeMatches("docx", "text/html")).toBe(false);
  });
});

describe("validateUploadForm", () => {
  const file = () => new File([new Uint8Array([1, 2, 3])], "a.docx");

  it("nhận file và name tùy chọn", () => {
    const form = new FormData();
    form.set("file", file());
    form.set("name", "  Mẫu   tuần ");
    const r = validateUploadForm(form);
    expect(r.ok && r.data.name).toBe("Mẫu tuần");
  });

  it("thiếu file, nhiều file, file rỗng, trường lạ: 400", () => {
    expect(validateUploadForm(new FormData())).toMatchObject({ ok: false });
    const many = new FormData();
    many.append("file", file());
    many.append("file", file());
    expect(validateUploadForm(many)).toMatchObject({
      ok: false,
      details: [{ field: "file", issue: "invalid_format" }],
    });
    const empty = new FormData();
    empty.set("file", new File([], "a.docx"));
    expect(validateUploadForm(empty)).toMatchObject({ ok: false });
    const extra = new FormData();
    extra.set("file", file());
    extra.set("storage_path", "../x");
    expect(validateUploadForm(extra)).toMatchObject({
      ok: false,
      details: [{ field: "storage_path", issue: "unknown_field" }],
    });
    const textFile = new FormData();
    textFile.set("file", "không phải tệp");
    expect(validateUploadForm(textFile)).toMatchObject({ ok: false });
  });
});

describe("validatePatch", () => {
  it("nhận name, is_active", () => {
    expect(validatePatch({ name: " Mới ", is_active: true })).toEqual({
      ok: true,
      data: { name: "Mới", is_active: true },
    });
  });
  it("từ chối trường lạ, kiểu sai, thân rỗng", () => {
    expect(validatePatch({ kind: "docx" })).toMatchObject({ ok: false });
    expect(validatePatch({ is_active: "true" })).toMatchObject({ ok: false });
    expect(validatePatch({ name: "" })).toMatchObject({ ok: false });
    expect(validatePatch({ name: "x".repeat(201) })).toMatchObject({
      ok: false,
    });
    expect(validatePatch({})).toMatchObject({ ok: false });
    expect(validatePatch([])).toMatchObject({ ok: false });
  });
});
