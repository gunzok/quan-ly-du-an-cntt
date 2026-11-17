import { describe, expect, it } from "vitest";
import { en } from "@/lib/i18n/messages/en";
import { vi } from "@/lib/i18n/messages/vi";
import { describeActivity } from "./message";
import type { ActivityEntry } from "./model";

const ACTOR = { id: "a", full_name: "Nguyễn Minh Anh", email: null };

function entry(partial: Partial<ActivityEntry>): ActivityEntry {
  return {
    id: 1,
    created_at: "2026-11-17T02:12:00Z",
    action: "update",
    entity_type: "task",
    entity_id: "t",
    entity_name: "CTTT-24 Thiết kế",
    actor: ACTOR,
    changes: [],
    ...partial,
  };
}

describe("describeActivity (vi)", () => {
  it("đổi trạng thái: câu riêng và chi tiết trước → sau", () => {
    const m = describeActivity(
      entry({
        changes: [
          {
            field: "status_id",
            kind: "status",
            before: { id: "s1", name: "Cần làm" },
            after: { id: "s2", name: "Đang làm" },
          },
        ],
      }),
      vi,
      "vi",
    );
    expect(m).toEqual({
      actor: "Nguyễn Minh Anh",
      summary: "đổi trạng thái task “CTTT-24 Thiết kế”",
      details: ["Trạng thái: Cần làm → Đang làm"],
    });
  });

  it("giao việc từ chưa gán; ngày theo định dạng Việt Nam; nhiều trường là cập nhật", () => {
    const m = describeActivity(
      entry({
        changes: [
          {
            field: "assignee_id",
            kind: "person",
            before: null,
            after: { id: "u", full_name: "Phạm Gia Huy", email: null },
          },
          {
            field: "due_date",
            kind: "date",
            before: "2026-11-25",
            after: "2026-11-27",
          },
          {
            field: "priority",
            kind: "priority",
            before: "medium",
            after: "urgent",
          },
          { field: "description", kind: "redacted", before: null, after: null },
        ],
      }),
      vi,
      "vi",
    );
    expect(m.summary).toBe("cập nhật task “CTTT-24 Thiết kế”");
    expect(m.details).toEqual([
      "Người thực hiện: chưa gán → Phạm Gia Huy",
      "Ngày kết thúc: 25/11/2026 → 27/11/2026",
      "Ưu tiên: Trung bình → Khẩn cấp",
      "Mô tả: đã sửa nội dung",
    ]);
  });

  it("trạng thái, người, task cha đã xóa: ghi rõ đã xóa, không đoán tên", () => {
    const m = describeActivity(
      entry({
        actor: { id: "gone", full_name: null, email: null },
        changes: [
          {
            field: "status_id",
            kind: "status",
            before: { id: "s1", name: null },
            after: { id: "s2", name: "Xong" },
          },
          {
            field: "assignee_id",
            kind: "person",
            before: { id: "u", full_name: null, email: null },
            after: null,
          },
          {
            field: "parent_id",
            kind: "task",
            before: { id: "p", name: null },
            after: null,
          },
          {
            field: "type_id",
            kind: "type",
            before: null,
            after: { id: "ty", name: null },
          },
        ],
      }),
      vi,
      "vi",
    );
    expect(m.actor).toBe("Người dùng đã xóa");
    expect(m.details).toEqual([
      "Trạng thái: trạng thái đã xóa → Xong",
      "Người thực hiện: Người dùng đã xóa → chưa gán",
      "Task cha: task đã xóa → trống",
      "Loại: trống → loại đã xóa",
    ]);
  });

  it("tạo task, tạo việc con, xóa task, hệ thống làm", () => {
    expect(
      describeActivity(
        entry({
          action: "create",
          actor: null,
          changes: [
            {
              field: "priority",
              kind: "priority",
              before: null,
              after: "high",
            },
          ],
        }),
        vi,
        "vi",
      ),
    ).toEqual({
      actor: "Hệ thống",
      summary: "tạo task “CTTT-24 Thiết kế”",
      details: ["Ưu tiên: Cao"],
    });
    expect(
      describeActivity(
        entry({
          action: "create",
          entity_name: "CTTT-26",
          changes: [
            {
              field: "parent_id",
              kind: "task",
              before: null,
              after: { id: "p", name: "CTTT-24" },
            },
          ],
        }),
        vi,
        "vi",
      ),
    ).toMatchObject({
      summary: "tạo việc con “CTTT-26” trong “CTTT-24”",
      details: [],
    });
    expect(
      describeActivity(entry({ action: "delete", entity_name: null }), vi, "vi")
        .summary,
    ).toBe("xóa task “task không rõ tên”");
  });

  it("thành viên và dự án", () => {
    expect(
      describeActivity(
        entry({
          entity_type: "project_member",
          action: "create",
          entity_name: "Lê Thu Hà",
          changes: [{ field: "role", kind: "role", before: null, after: "pm" }],
        }),
        vi,
        "vi",
      ),
    ).toMatchObject({
      summary: "thêm Lê Thu Hà vào dự án với vai trò PM",
      details: [],
    });
    expect(
      describeActivity(
        entry({
          entity_type: "project_member",
          entity_name: "Lê Thu Hà",
          changes: [
            { field: "role", kind: "role", before: "member", after: "viewer" },
          ],
        }),
        vi,
        "vi",
      ),
    ).toMatchObject({
      summary: "đổi vai trò của Lê Thu Hà",
      details: ["Vai trò: Thành viên → Người xem"],
    });
    expect(
      describeActivity(
        entry({
          entity_type: "project_member",
          action: "delete",
          entity_name: null,
        }),
        vi,
        "vi",
      ).summary,
    ).toBe("gỡ Người dùng đã xóa khỏi dự án");
    expect(
      describeActivity(
        entry({
          entity_type: "project",
          entity_name: "Cổng thông tin",
          changes: [
            {
              field: "status",
              kind: "project_status",
              before: "active",
              after: "archived",
            },
          ],
        }),
        vi,
        "vi",
      ),
    ).toEqual({
      actor: "Nguyễn Minh Anh",
      summary: "lưu trữ dự án “Cổng thông tin”",
      details: ["Trạng thái dự án: Đang thực hiện → Đã lưu trữ"],
    });
  });
});

describe("describeActivity (en)", () => {
  it("dùng từ điển tiếng Anh và định dạng ngày tiếng Anh", () => {
    const m = describeActivity(
      entry({
        changes: [
          {
            field: "due_date",
            kind: "date",
            before: null,
            after: "2026-11-27",
          },
        ],
      }),
      en,
      "en",
    );
    expect(m.summary).toBe("updated task “CTTT-24 Thiết kế”");
    expect(m.details).toEqual(["Due date: empty → 27 Nov 2026"]);
  });
});
