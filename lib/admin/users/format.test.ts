import { describe, expect, it } from "vitest";
import {
  displayName,
  formatLastSignIn,
  initials,
  projectSummary,
} from "./format";

describe("formatLastSignIn (giờ Việt Nam)", () => {
  // 2026-11-14 10:00 giờ Việt Nam = 03:00 UTC
  const now = new Date("2026-11-14T03:00:00Z");

  it("hôm nay, hôm qua, ngày cũ hơn, chưa đăng nhập", () => {
    expect(formatLastSignIn("2026-11-14T01:02:00Z", now)).toBe("Hôm nay 08:02");
    expect(formatLastSignIn("2026-11-13T10:45:00Z", now)).toBe("Hôm qua 17:45");
    expect(formatLastSignIn("2026-11-02T03:00:00Z", now)).toBe("02/11/2026");
    expect(formatLastSignIn(null, now)).toBe("Chưa đăng nhập");
    expect(formatLastSignIn("khong-phai-ngay", now)).toBe("Chưa đăng nhập");
  });

  it("ranh giới ngày theo múi giờ Việt Nam, không theo UTC", () => {
    // 23:30 UTC ngày 13 = 06:30 ngày 14 giờ Việt Nam
    expect(formatLastSignIn("2026-11-13T23:30:00Z", now)).toBe("Hôm nay 06:30");
  });
});

describe("displayName, initials, projectSummary", () => {
  it("tên hiển thị và chữ viết tắt", () => {
    expect(displayName({ full_name: " ", email: "a@b.vn" })).toBe("a@b.vn");
    expect(initials({ full_name: "Nguyễn Minh Anh", email: null })).toBe("MA");
    expect(initials({ full_name: "", email: "bao@x.vn" })).toBe("BA");
  });

  it("số dự án", () => {
    expect(
      projectSummary({ is_admin: true, project_count: 0, pm_project_count: 0 }),
    ).toBe("Tất cả");
    expect(
      projectSummary({
        is_admin: false,
        project_count: 4,
        pm_project_count: 3,
      }),
    ).toBe("4 dự án (PM ở 3)");
    expect(
      projectSummary({
        is_admin: false,
        project_count: 2,
        pm_project_count: 0,
      }),
    ).toBe("2 dự án");
    expect(
      projectSummary({
        is_admin: false,
        project_count: 0,
        pm_project_count: 0,
      }),
    ).toBe("Chưa tham gia");
  });
});
