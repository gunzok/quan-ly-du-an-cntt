import { describe, expect, it } from "vitest";
import { renderTaskEmail, taskUrl } from "./templates";

const PROJECT = "0e91a3b2-1111-4222-8333-444455556666";
const TASK = "b7d4c1e0-aaaa-4bbb-8ccc-ddddeeeeffff";
const base = {
  appBaseUrl: "https://qlda.example.com",
  projectId: PROJECT,
  taskId: TASK,
  projectName: "Cổng thông tin nội bộ",
};

describe("taskUrl", () => {
  it("dựng liên kết tuyệt đối tới trang task", () => {
    expect(taskUrl("https://qlda.example.com", PROJECT, TASK)).toBe(
      `https://qlda.example.com/projects/${PROJECT}/tasks/${TASK}`,
    );
  });
  it("chỉ lấy origin của APP_BASE_URL", () => {
    expect(taskUrl("http://localhost:3000/", PROJECT, TASK)).toBe(
      `http://localhost:3000/projects/${PROJECT}/tasks/${TASK}`,
    );
  });
  it("từ chối id không phải UUID (chống chèn đường dẫn)", () => {
    expect(() => taskUrl(base.appBaseUrl, "../admin", TASK)).toThrow();
  });
});

describe("renderTaskEmail: giao việc", () => {
  it("tiếng Việt: tiêu đề, tên task, người giao, dự án, liên kết", () => {
    const mail = renderTaskEmail({
      ...base,
      type: "task_assigned",
      locale: "vi",
      taskTitle: "Thiết kế bảng Kanban",
      actorName: "Trần An",
    });
    expect(mail.subject).toBe(
      "[Quản lý dự án] Bạn được giao task: Thiết kế bảng Kanban",
    );
    expect(mail.text).toContain("Trần An vừa giao cho bạn một task.");
    expect(mail.text).toContain("Task: Thiết kế bảng Kanban");
    expect(mail.text).toContain("Dự án: Cổng thông tin nội bộ");
    expect(mail.text).toContain("Người giao: Trần An");
    expect(mail.text).toContain(
      `Mở task: https://qlda.example.com/projects/${PROJECT}/tasks/${TASK}`,
    );
    expect(mail.html).toContain('<html lang="vi">');
    expect(mail.html).toContain(
      `href="https://qlda.example.com/projects/${PROJECT}/tasks/${TASK}"`,
    );
  });

  it("English theo locale người nhận", () => {
    const mail = renderTaskEmail({
      ...base,
      type: "task_assigned",
      locale: "en",
      taskTitle: "Design board",
      actorName: "An Tran",
    });
    expect(mail.subject).toBe(
      "[Project Manager] You were assigned: Design board",
    );
    expect(mail.text).toContain("An Tran assigned a task to you.");
    expect(mail.text).toContain("Assigned by: An Tran");
    expect(mail.html).toContain('<html lang="en">');
  });

  it("locale lạ hoặc thiếu: tiếng Việt; không có người giao: câu trung tính", () => {
    const mail = renderTaskEmail({
      ...base,
      type: "task_assigned",
      locale: "fr",
      taskTitle: "Việc A",
      actorName: null,
    });
    expect(mail.text).toContain("Bạn vừa được giao một task.");
    expect(mail.text).not.toContain("Người giao");
  });

  it("tên task chứa HTML và xuống dòng: thoát trong HTML, một dòng ở tiêu đề", () => {
    const evil = '<img src=x onerror="alert(1)">\r\nBcc: x@evil.test';
    const mail = renderTaskEmail({
      ...base,
      type: "task_assigned",
      locale: "vi",
      taskTitle: evil,
      projectName: "<b>Dự án</b>",
      actorName: "<script>x</script>",
    });
    expect(mail.subject).not.toMatch(/[\r\n]/);
    expect(mail.html).not.toContain("<img");
    expect(mail.html).not.toContain("<script>");
    expect(mail.html).not.toContain("<b>Dự án");
    expect(mail.html).toContain(
      "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;",
    );
    // Text thuần không có xuống dòng chèn vào trong một trường.
    expect(mail.text).toContain(
      'Task: <img src=x onerror="alert(1)"> Bcc: x@evil.test',
    );
  });

  it("tiêu đề cắt ngắn khi tên task dài", () => {
    const mail = renderTaskEmail({
      ...base,
      type: "task_assigned",
      locale: "vi",
      taskTitle: "x".repeat(500),
    });
    expect(Array.from(mail.subject).length).toBeLessThanOrEqual(180);
    expect(mail.subject.endsWith("…")).toBe(true);
  });
});

describe("renderTaskEmail: đổi trạng thái", () => {
  it("có trạng thái mới và người thay đổi", () => {
    const mail = renderTaskEmail({
      ...base,
      type: "task_status_changed",
      locale: "vi",
      taskTitle: "Việc B",
      statusName: "Đã xong",
      actorName: "Lê Bình",
    });
    expect(mail.subject).toBe(
      "[Quản lý dự án] Task Việc B chuyển sang Đã xong",
    );
    expect(mail.text).toContain("Trạng thái: Đã xong");
    expect(mail.text).toContain("Người thay đổi: Lê Bình");
  });
});

describe("renderTaskEmail: nhắc hạn (E4-3)", () => {
  it("tiếng Việt: 1 ngày, có hạn, không có người làm", () => {
    const mail = renderTaskEmail({
      ...base,
      type: "task_due_soon",
      locale: "vi",
      taskTitle: "Nộp báo cáo <tuần>",
      dueDate: "2026-11-21",
      daysLeft: 1,
    });
    expect(mail.subject).toBe(
      "[Quản lý dự án] Task Nộp báo cáo <tuần> đến hạn ngày mai",
    );
    expect(mail.text).toContain("Task bạn phụ trách đến hạn vào ngày mai.");
    expect(mail.text).toContain("Hạn: 21/11/2026");
    expect(mail.text).not.toContain("Người giao");
    expect(mail.html).toContain("Nộp báo cáo &lt;tuần&gt;");
    expect(mail.html).not.toContain("<tuần>");
  });

  it("English: 3 ngày", () => {
    const mail = renderTaskEmail({
      ...base,
      type: "task_due_soon",
      locale: "en",
      taskTitle: "Ship report",
      dueDate: "2026-11-23",
      daysLeft: 3,
    });
    expect(mail.subject).toContain("Task Ship report is due in 3 days");
    expect(mail.text).toContain("A task you own is due in 3 days.");
    expect(mail.text).toContain("Due date: 23 Nov 2026");
  });

  it("hạn hôm nay (gửi trễ trong ngày) và hạn sai dạng thì bỏ dòng hạn", () => {
    const mail = renderTaskEmail({
      ...base,
      type: "task_due_soon",
      locale: "vi",
      taskTitle: "Việc C",
      dueDate: "21/11/2026",
      daysLeft: 0,
    });
    expect(mail.subject).toBe("[Quản lý dự án] Task Việc C đến hạn hôm nay");
    expect(mail.text).not.toContain("Hạn:");
  });
});
