import { describe, expect, it } from "vitest";
import { en } from "@/lib/i18n/messages/en";
import { vi } from "@/lib/i18n/messages/vi";
import {
  displayName,
  formatLastSignIn,
  initials,
  projectSummary,
} from "./format";

const VI = { t: vi.adminUsers, locale: "vi" as const };
const EN = { t: en.adminUsers, locale: "en" as const };

describe("formatLastSignIn (giờ Việt Nam)", () => {
  // 2026-11-14 10:00 giờ Việt Nam = 03:00 UTC
  const now = new Date("2026-11-14T03:00:00Z");

  it("hôm nay, hôm qua, ngày cũ hơn, chưa đăng nhập", () => {
    expect(formatLastSignIn("2026-11-14T01:02:00Z", VI, now)).toBe(
      "Hôm nay 08:02",
    );
    expect(formatLastSignIn("2026-11-13T10:45:00Z", VI, now)).toBe(
      "Hôm qua 17:45",
    );
    expect(formatLastSignIn("2026-11-02T03:00:00Z", VI, now)).toBe(
      "02/11/2026",
    );
    expect(formatLastSignIn(null, VI, now)).toBe("Chưa đăng nhập");
    expect(formatLastSignIn("khong-phai-ngay", VI, now)).toBe("Chưa đăng nhập");
  });

  it("tiếng Anh: chữ và định dạng ngày theo ngôn ngữ", () => {
    expect(formatLastSignIn("2026-11-14T01:02:00Z", EN, now)).toBe(
      "Today 08:02",
    );
    expect(formatLastSignIn("2026-11-13T10:45:00Z", EN, now)).toBe(
      "Yesterday 17:45",
    );
    expect(formatLastSignIn("2026-11-02T03:00:00Z", EN, now)).toBe(
      "02 Nov 2026",
    );
    expect(formatLastSignIn(null, EN, now)).toBe("Never signed in");
  });

  it("ranh giới ngày theo múi giờ Việt Nam, không theo UTC", () => {
    // 23:30 UTC ngày 13 = 06:30 ngày 14 giờ Việt Nam
    expect(formatLastSignIn("2026-11-13T23:30:00Z", VI, now)).toBe(
      "Hôm nay 06:30",
    );
  });
});

describe("displayName, initials, projectSummary", () => {
  it("tên hiển thị và chữ viết tắt", () => {
    expect(
      displayName({ full_name: " ", email: "a@b.vn" }, vi.adminUsers),
    ).toBe("a@b.vn");
    expect(displayName({ full_name: " ", email: "" }, en.adminUsers)).toBe(
      "(No name)",
    );
    expect(initials({ full_name: "Nguyễn Minh Anh", email: null })).toBe("MA");
    expect(initials({ full_name: "", email: "bao@x.vn" })).toBe("BA");
  });

  it("số dự án", () => {
    const user = (project_count: number, pm_project_count: number) => ({
      is_admin: false,
      project_count,
      pm_project_count,
    });
    expect(
      projectSummary(
        { is_admin: true, project_count: 0, pm_project_count: 0 },
        vi.adminUsers,
      ),
    ).toBe("Tất cả");
    expect(projectSummary(user(4, 3), vi.adminUsers)).toBe("4 dự án (PM ở 3)");
    expect(projectSummary(user(2, 0), vi.adminUsers)).toBe("2 dự án");
    expect(projectSummary(user(0, 0), vi.adminUsers)).toBe("Chưa tham gia");
    expect(projectSummary(user(4, 3), en.adminUsers)).toBe(
      "4 projects (PM in 3)",
    );
    expect(projectSummary(user(1, 0), en.adminUsers)).toBe("1 project");
  });
});
