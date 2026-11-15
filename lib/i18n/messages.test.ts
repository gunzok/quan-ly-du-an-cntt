import { describe, expect, it } from "vitest";
import { apiErrorBody } from "@/lib/api/errors";
import { apiError } from "@/lib/api/respond";
import { apiErrorText } from "./api-error";
import { lookupMessage, messageKeyOf } from "./message-key";
import { MESSAGES } from "./messages";
import { en } from "./messages/en";
import { vi } from "./messages/vi";

/** Mô tả cấu trúc: đường dẫn → loại lá (string, function/arity, array). */
function shape(node: unknown, path = "", out = new Map<string, string>()) {
  if (typeof node === "string") {
    out.set(path, "string");
  } else if (typeof node === "function") {
    out.set(path, `function/${node.length}`);
  } else if (Array.isArray(node)) {
    out.set(path, "array");
    node.forEach((item, i) => shape(item, `${path}[${i}]`, out));
  } else if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node)) {
      shape(value, path ? `${path}.${key}` : key, out);
    }
  }
  return out;
}

function leaves(node: unknown, path = "", out = new Map<string, unknown>()) {
  if (node && typeof node === "object" && !Array.isArray(node)) {
    for (const [key, value] of Object.entries(node)) {
      leaves(value, path ? `${path}.${key}` : key, out);
    }
  } else {
    out.set(path, node);
  }
  return out;
}

describe("từ điển vi (gốc) và en", () => {
  it("cùng tập khóa, cùng loại lá và cùng số tham số của hàm", () => {
    const viShape = shape(vi);
    const enShape = shape(en);
    // Phần tử mảng (danh sách tính năng, tên mẫu) được phép khác số lượng: chỉ so khóa ngoài mảng.
    const outside = (m: Map<string, string>) =>
      [...m].filter(([k]) => !k.includes("["));
    expect(outside(enShape)).toEqual(outside(viShape));
    expect(viShape.size).toBeGreaterThan(400);
  });

  it("phát hiện được khi thiếu khóa (test thật sự có thể đỏ)", () => {
    const language: Record<string, string> = { ...en.language };
    delete language.changing;
    const broken = { ...en, language };
    const outside = (m: Map<string, string>) =>
      [...m].filter(([k]) => !k.includes("["));
    expect(outside(shape(broken))).not.toEqual(outside(shape(vi)));
  });

  it("hàm có tham số trả chuỗi ở cả hai ngôn ngữ", () => {
    for (const messages of Object.values(MESSAGES)) {
      for (const [path, value] of leaves(messages)) {
        if (typeof value !== "function") continue;
        const args = Array.from({ length: value.length }, (_, i) =>
          i === 0 ? "X" : 2,
        );
        const result: unknown = (value as (...a: unknown[]) => unknown)(
          ...args,
        );
        expect(typeof result, path).toBe("string");
        expect((result as string).length, path).toBeGreaterThan(0);
      }
    }
  });

  it("không để trống chuỗi (trừ khóa vốn trống ở bản gốc) và en không còn tiếng Việt", () => {
    const viLeaves = leaves(vi);
    // Tên riêng (ví dụ danh sách tên mẫu ở /dev/ui, tên ngôn ngữ "Tiếng Việt") được giữ nguyên.
    const keepVietnamese = new Set([
      "language.vi",
      "devUi.sample.avatarPeople",
    ]);
    for (const [path, value] of leaves(en)) {
      if (typeof value !== "string") continue;
      if (viLeaves.get(path) !== "") {
        expect(value, path).not.toBe("");
      }
      if (!keepVietnamese.has(path)) {
        expect(value, path).not.toMatch(
          /[ăâđêôơưạảấầẩẫậắằẳẵặẹẻẽếềểễệịỉĩọỏốồổỗộớờởỡợụủũứừửữựỳỵỷỹ]/i,
        );
      }
    }
  });

  it("thông điệp lỗi trùng chữ ở bản vi thì bản en cũng trùng (khóa tìm ngược không làm sai nghĩa)", () => {
    const viLeaves = leaves(vi);
    const enLeaves = leaves(en);
    const byText = new Map<string, string[]>();
    for (const [path, value] of viLeaves) {
      if (typeof value !== "string" || value === "") continue;
      if (!/(^|\.)(errors|api|security)(\.|$)/.test(path)) continue;
      byText.set(value, [...(byText.get(value) ?? []), path]);
    }
    for (const paths of byText.values()) {
      const first = messageKeyOf(viLeaves.get(paths[0]) as string)!;
      for (const path of paths) {
        expect(enLeaves.get(path), path).toBe(enLeaves.get(first));
      }
    }
  });
});

describe("message_key của lỗi API", () => {
  it("tìm ngược khóa từ thông điệp tiếng Việt và tra lại được ở cả hai ngôn ngữ", () => {
    const key = messageKeyOf(vi.adminUsers.errors.emailExists);
    expect(key).toBe("adminUsers.errors.emailExists");
    expect(lookupMessage(en, key)).toBe(en.adminUsers.errors.emailExists);
    expect(messageKeyOf("không có trong từ điển")).toBeUndefined();
    expect(lookupMessage(en, "adminUsers.errors")).toBeUndefined();
    expect(lookupMessage(en, "constructor")).toBeUndefined();
    expect(lookupMessage(en, "__proto__.toString")).toBeUndefined();
  });

  it("thân lỗi API giữ message tiếng Việt và gắn message_key", () => {
    const body = apiErrorBody(
      apiError("conflict", vi.departments.errors.nameExists),
    );
    expect(body.error.message).toBe(vi.departments.errors.nameExists);
    expect(body.error.message_key).toBe("departments.errors.nameExists");
    expect(apiErrorBody(apiError("forbidden")).error.message_key).toBe(
      "api.forbidden",
    );
    // Thông điệp động (không có trong từ điển): không gắn khóa.
    expect(
      apiErrorBody({ code: "conflict", message: "Chuỗi động" }).error,
    ).not.toHaveProperty("message_key");
  });

  it("giao diện dịch theo khóa, rơi về thông điệp gốc (vi) hoặc thông điệp chung (en)", () => {
    const known = apiError("conflict", vi.adminUsers.errors.selfLock);
    expect(apiErrorText(en, known)).toBe(en.adminUsers.errors.selfLock);
    expect(apiErrorText(vi, known)).toBe(vi.adminUsers.errors.selfLock);
    // Lỗi tự tạo phía trình duyệt/Server Action (không có message_key) vẫn dịch được.
    expect(
      apiErrorText(en, {
        code: "internal_error",
        message: vi.projects.errors.network,
      }),
    ).toBe(en.projects.errors.network);
    const dynamic = { code: "forbidden" as const, message: "Chuỗi động" };
    expect(apiErrorText(vi, dynamic)).toBe("Chuỗi động");
    expect(apiErrorText(en, dynamic)).toBe(en.api.forbidden);
    expect(apiErrorText(en, { ...dynamic, message_key: "khong.co.khoa" })).toBe(
      en.api.forbidden,
    );
  });
});
