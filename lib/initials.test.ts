import { describe, expect, it } from "vitest";
import { initials } from "./initials";

describe("initials", () => {
  it("lấy chữ đầu của họ và tên gọi", () => {
    expect(initials("Nguyễn Văn An")).toBe("NA");
    expect(initials("  trần   thị bình ")).toBe("TB");
  });

  it("giữ dấu tiếng Việt và xử lý tên một từ", () => {
    expect(initials("Đặng Ánh")).toBe("ĐÁ");
    expect(initials("minh")).toBe("M");
  });

  it("tên rỗng trả về dấu hỏi", () => {
    expect(initials("   ")).toBe("?");
  });
});
