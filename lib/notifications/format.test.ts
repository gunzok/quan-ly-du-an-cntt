import { describe, expect, it } from "vitest";
import { en } from "@/lib/i18n/messages/en";
import { vi } from "@/lib/i18n/messages/vi";
import { badgeLabel, formatNotificationTime, notificationText } from "./format";

// 2026-11-16 10:00 giờ Việt Nam.
const NOW = new Date("2026-11-16T03:00:00Z");

describe("formatNotificationTime", () => {
  it("hôm nay, hôm qua theo giờ Việt Nam", () => {
    expect(
      formatNotificationTime(
        "2026-11-16T02:12:00Z",
        NOW,
        "vi",
        vi.notifications,
      ),
    ).toBe("Hôm nay 09:12");
    // 23:30 ngày 15 giờ Việt Nam (16:30Z) là hôm qua, dù cùng ngày UTC với 00:30 ngày 16.
    expect(
      formatNotificationTime(
        "2026-11-15T16:30:00Z",
        NOW,
        "vi",
        vi.notifications,
      ),
    ).toBe("Hôm qua 23:30");
    expect(
      formatNotificationTime(
        "2026-11-15T17:30:00Z",
        NOW,
        "vi",
        vi.notifications,
      ),
    ).toBe("Hôm nay 00:30");
    expect(
      formatNotificationTime(
        "2026-11-15T10:45:00Z",
        NOW,
        "en",
        en.notifications,
      ),
    ).toBe("Yesterday 17:45");
  });

  it("ngày khác trong năm và năm khác", () => {
    expect(
      formatNotificationTime(
        "2026-11-12T04:00:00Z",
        NOW,
        "vi",
        vi.notifications,
      ),
    ).toBe("12/11 11:00");
    expect(
      formatNotificationTime(
        "2025-11-02T04:00:00Z",
        NOW,
        "vi",
        vi.notifications,
      ),
    ).toBe("02/11/2025");
    expect(
      formatNotificationTime("không phải ngày", NOW, "vi", vi.notifications),
    ).toBe("");
  });
});

describe("notificationText", () => {
  const base = {
    type: "task_assigned" as const,
    task_visible: true,
    title: "Viết đặc tả",
    status_name: null,
    actor: { id: "a", full_name: "Nguyễn Minh Anh" },
  };
  it("giao việc, đổi trạng thái, có và không có người làm", () => {
    expect(notificationText(base, vi.notifications)).toBe(
      "Nguyễn Minh Anh giao cho bạn task Viết đặc tả",
    );
    expect(notificationText({ ...base, actor: null }, vi.notifications)).toBe(
      "Bạn được giao task Viết đặc tả",
    );
    expect(
      notificationText(
        { ...base, type: "task_status_changed", status_name: "Đang kiểm thử" },
        vi.notifications,
      ),
    ).toBe(
      "Nguyễn Minh Anh đổi trạng thái task Viết đặc tả sang Đang kiểm thử",
    );
    expect(
      notificationText(
        {
          ...base,
          type: "task_status_changed",
          status_name: "Done",
          actor: null,
        },
        en.notifications,
      ),
    ).toBe("The task Viết đặc tả moved to Done");
  });
  it("không còn quyền xem task: câu trung tính, không có tiêu đề", () => {
    const hidden = { ...base, task_visible: false, title: null, actor: null };
    expect(notificationText(hidden, vi.notifications)).toBe(
      vi.notifications.hiddenAssigned,
    );
    expect(
      notificationText(
        { ...hidden, type: "task_status_changed" },
        en.notifications,
      ),
    ).toBe(en.notifications.hiddenStatusChanged);
  });
});

describe("notificationText: nhắc hạn (E4-3)", () => {
  const due = {
    type: "task_due_soon" as const,
    task_visible: true,
    title: "Nộp báo cáo",
    status_name: null,
    actor: null,
    due_date: "2026-11-21",
    days_left: 1,
  };
  it("1 ngày và 3 ngày, ngày theo ngôn ngữ", () => {
    expect(notificationText(due, vi.notifications, "vi")).toBe(
      "Task Nộp báo cáo đến hạn ngày mai (21/11/2026)",
    );
    expect(
      notificationText(
        { ...due, days_left: 3, due_date: "2026-11-23" },
        vi.notifications,
        "vi",
      ),
    ).toBe("Task Nộp báo cáo còn 3 ngày đến hạn (23/11/2026)");
    expect(notificationText(due, en.notifications, "en")).toBe(
      "Task Nộp báo cáo is due tomorrow (21 Nov 2026)",
    );
  });
  it("thiếu hạn: câu chung; không còn quyền xem: câu trung tính", () => {
    expect(
      notificationText({ ...due, due_date: null }, vi.notifications, "vi"),
    ).toBe("Task Nộp báo cáo sắp đến hạn");
    expect(
      notificationText(
        { ...due, task_visible: false, title: null },
        en.notifications,
        "en",
      ),
    ).toBe(en.notifications.hiddenDueSoon);
  });
});

describe("badgeLabel", () => {
  it("ẩn khi 0, tối đa 99+", () => {
    expect(badgeLabel(0, "99+")).toBeNull();
    expect(badgeLabel(7, "99+")).toBe("7");
    expect(badgeLabel(100, "99+")).toBe("99+");
  });
});
