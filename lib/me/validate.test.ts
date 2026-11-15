import { describe, expect, it } from "vitest";
import { validateMePatch } from "./validate";

describe("validateMePatch (PATCH /api/v1/me)", () => {
  it("nhận locale vi hoặc en", () => {
    expect(validateMePatch({ locale: "en" })).toEqual({
      ok: true,
      data: { locale: "en" },
    });
    expect(validateMePatch({ locale: "vi" })).toEqual({
      ok: true,
      data: { locale: "vi" },
    });
  });

  it("thiếu, sai giá trị, trường lạ, không phải object: 400", () => {
    expect(validateMePatch({})).toEqual({
      ok: false,
      details: [{ field: "locale", issue: "required" }],
    });
    expect(validateMePatch({ locale: "fr" })).toEqual({
      ok: false,
      details: [{ field: "locale", issue: "invalid_value" }],
    });
    expect(validateMePatch({ locale: "en", is_admin: true })).toEqual({
      ok: false,
      details: [{ field: "is_admin", issue: "unknown_field" }],
    });
    expect(validateMePatch(["en"])).toEqual({
      ok: false,
      details: [{ field: "body", issue: "invalid_format" }],
    });
  });
});
