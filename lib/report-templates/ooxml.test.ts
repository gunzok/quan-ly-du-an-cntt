import { describe, expect, it } from "vitest";
import {
  buildZip,
  docxEntries,
  hiddenMacroXlsx,
  lyingSizeDocx,
  macroDocx,
  manyEntriesDocx,
  sampleDocx,
  sampleXlsx,
  xlsxEntries,
  XLSM_MAIN,
  zipBombDocx,
  zipSlipDocx,
} from "@/tests/fixtures/ooxml";
import { inspectOoxml } from "./ooxml";

describe("inspectOoxml", () => {
  it("nhận docx và xlsx hợp lệ", () => {
    expect(inspectOoxml(sampleDocx(), "docx")).toEqual({ ok: true });
    expect(inspectOoxml(sampleXlsx(), "xlsx")).toEqual({ ok: true });
  });

  it("từ chối nội dung khác loại với đuôi", () => {
    expect(inspectOoxml(sampleXlsx(), "docx")).toEqual({
      ok: false,
      reason: "signature",
    });
    expect(inspectOoxml(sampleDocx(), "xlsx")).toEqual({
      ok: false,
      reason: "signature",
    });
  });

  it("từ chối tệp không phải ZIP", () => {
    expect(inspectOoxml(Buffer.from("%PDF-1.7 giả"), "docx")).toMatchObject({
      reason: "signature",
    });
    expect(inspectOoxml(Buffer.from("<html></html>"), "xlsx")).toMatchObject({
      reason: "signature",
    });
    expect(inspectOoxml(Buffer.alloc(0), "xlsx")).toMatchObject({
      reason: "signature",
    });
  });

  it("từ chối ZIP không phải OOXML (thiếu [Content_Types].xml hoặc phần chính)", () => {
    const zip = buildZip([{ name: "a.txt", data: "xin chào" }]);
    expect(inspectOoxml(zip, "docx")).toMatchObject({ reason: "signature" });
    const noTypes = buildZip(
      docxEntries().filter((e) => e.name !== "[Content_Types].xml"),
    );
    expect(inspectOoxml(noTypes, "docx")).toMatchObject({
      reason: "signature",
    });
  });

  it("từ chối ZIP bị cắt cụt hoặc hỏng byte", () => {
    const ok = sampleDocx();
    expect(inspectOoxml(ok.subarray(0, ok.length - 10), "docx")).toMatchObject({
      reason: "signature",
    });
    const corrupt = Buffer.from(ok);
    corrupt[40] ^= 0xff;
    expect(inspectOoxml(corrupt, "docx").ok).toBe(false);
  });

  it("từ chối macro: content type macroEnabled hoặc vbaProject.bin ẩn", () => {
    expect(inspectOoxml(macroDocx(), "docx")).toEqual({
      ok: false,
      reason: "macro",
    });
    expect(inspectOoxml(hiddenMacroXlsx(), "xlsx")).toEqual({
      ok: false,
      reason: "macro",
    });
    const xlsm = buildZip(xlsxEntries({ mainType: XLSM_MAIN }));
    expect(inspectOoxml(xlsm, "xlsx")).toEqual({ ok: false, reason: "macro" });
  });

  it("từ chối ActiveX", () => {
    const zip = buildZip([
      ...docxEntries(),
      { name: "word/activeX/activeX1.xml", data: "<a/>" },
    ]);
    expect(inspectOoxml(zip, "docx")).toMatchObject({ reason: "macro" });
  });

  it("từ chối ZIP bomb: giải nén quá lớn, khai man kích thước, quá nhiều mục", () => {
    expect(inspectOoxml(zipBombDocx(), "docx")).toEqual({
      ok: false,
      reason: "zip_bomb",
    });
    expect(inspectOoxml(lyingSizeDocx(), "docx")).toEqual({
      ok: false,
      reason: "zip_bomb",
    });
    expect(inspectOoxml(manyEntriesDocx(), "docx")).toEqual({
      ok: false,
      reason: "zip_bomb",
    });
  });

  it("từ chối mục có tên trèo thư mục (zip slip) và tên trùng", () => {
    expect(inspectOoxml(zipSlipDocx(), "docx")).toMatchObject({
      reason: "signature",
    });
    const dup = buildZip([
      ...docxEntries(),
      { name: "WORD/document.xml", data: "<x/>" },
    ]);
    expect(inspectOoxml(dup, "docx")).toMatchObject({ reason: "signature" });
  });

  it("từ chối docx dạng template .dotx (content type khác)", () => {
    const dotx = buildZip(
      docxEntries({
        mainType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.template.main+xml",
      }),
    );
    expect(inspectOoxml(dotx, "docx")).toMatchObject({ reason: "signature" });
  });
});

describe("inspectOoxml: dữ liệu nén hỏng", () => {
  it("CRC sai: từ chối", () => {
    const entries = docxEntries();
    const zip = buildZip(entries.map((e) => ({ ...e, store: true })));
    // Đổi một byte trong nội dung word/document.xml (lưu không nén) → CRC lệch.
    const i = zip.indexOf(Buffer.from("<w:body>"));
    const bad = Buffer.from(zip);
    bad[i + 1] = "x".charCodeAt(0);
    expect(inspectOoxml(bad, "docx")).toMatchObject({ reason: "signature" });
  });
});
