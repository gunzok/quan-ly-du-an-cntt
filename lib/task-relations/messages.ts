/**
 * Thông điệp lỗi của API quan hệ task (Story E8-1).
 *
 * Tạm để riêng ở đây thay vì lib/strings.ts: Story E2-3 đang sửa lib/strings.ts song song, tách
 * ra để tránh xung đột. Chuyển vào `strings.taskRelations` khi cả hai nhánh đã merge.
 */
export const relationMessages = {
  cycle: "Quan hệ này tạo vòng",
  duplicate: "Quan hệ này đã có",
  selfRelation: "Task không thể quan hệ với chính nó.",
  crossProject: "Hai task phải thuộc cùng một dự án.",
  forbiddenEdit:
    "Bạn cần quyền sửa cả hai task để đặt hoặc bỏ quan hệ giữa chúng.",
} as const;
