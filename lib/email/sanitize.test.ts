import { describe, expect, it } from "vitest";
import {
  escapeHtml,
  isSafeEmailAddress,
  parseMailbox,
  singleLine,
} from "./sanitize";

describe("escapeHtml", () => {
  it("thoát mọi ký tự đặc biệt HTML", () => {
    expect(escapeHtml(`<script>alert("x")</script> & 'y'`)).toBe(
      "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;y&#39;",
    );
  });
});

describe("singleLine", () => {
  it("bỏ CR/LF và ký tự điều khiển (chống chèn dòng tiêu đề)", () => {
    expect(singleLine("A\r\nBcc: x@evil.test\u0000\tB", 100)).toBe(
      "A Bcc: x@evil.test B",
    );
  });
  it("bỏ ký tự phân cách dòng Unicode và ký tự định hướng", () => {
    expect(singleLine("a b‮c", 100)).toBe("a b c");
  });
  it("cắt theo ký tự (kể cả emoji) và thêm …", () => {
    expect(singleLine("Xin chào thế giới", 8)).toBe("Xin chà…");
    expect(Array.from(singleLine("😀".repeat(10), 5))).toHaveLength(5);
  });
  it("giữ nguyên chuỗi ngắn", () => {
    expect(singleLine("  Việc  A  ", 50)).toBe("Việc A");
  });
});

describe("isSafeEmailAddress", () => {
  it("nhận địa chỉ thường", () => {
    expect(isSafeEmailAddress("an.nguyen+qlda@cong-ty.vn")).toBe(true);
  });
  it.each([
    "a@b",
    "a b@c.vn",
    "a@b.vn\r\nBcc: x@y.z",
    "<a@b.vn>",
    "a@b.vn,c@d.vn",
    `${"a".repeat(250)}@b.vn`,
  ])("từ chối %j", (value) => {
    expect(isSafeEmailAddress(value)).toBe(false);
  });
});

describe("parseMailbox", () => {
  it("đọc dạng Tên <địa chỉ>", () => {
    expect(parseMailbox("Quản lý dự án <no-reply@cong-ty.vn>")).toEqual({
      name: "Quản lý dự án",
      address: "no-reply@cong-ty.vn",
    });
  });
  it("đọc địa chỉ trần", () => {
    expect(parseMailbox("no-reply@cong-ty.vn")).toEqual({
      address: "no-reply@cong-ty.vn",
    });
  });
  it("từ chối xuống dòng và dạng hỏng", () => {
    expect(parseMailbox("A <a@b.vn>\nBcc: c@d.vn")).toBeNull();
    expect(parseMailbox("A <không phải email>")).toBeNull();
    expect(parseMailbox("")).toBeNull();
  });
});
