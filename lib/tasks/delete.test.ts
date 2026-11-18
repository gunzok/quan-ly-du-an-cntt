import { describe, expect, it } from "vitest";
import { isSubtasksRemainError, subtasksRemain } from "./delete";
import { mapTaskWriteError } from "./policy";

describe("QLDA-81: xóa task còn việc con", () => {
  const fkError = {
    code: "23503",
    message:
      'update or delete on table "tasks" violates foreign key constraint "tasks_parent_id_fkey" on table "tasks"',
  };

  it("nhận ra lỗi khóa ngoại parent_id khi xóa", () => {
    expect(isSubtasksRemainError(fkError)).toBe(true);
    expect(
      isSubtasksRemainError({
        code: "23503",
        message: 'violates foreign key constraint "tasks_status_id_fkey"',
      }),
    ).toBe(false);
    expect(isSubtasksRemainError({ code: "P0001", message: "x" })).toBe(false);
  });

  it("422 business_rule_violated kèm subtask_count", () => {
    const error = subtasksRemain(3);
    expect(error.code).toBe("business_rule_violated");
    expect(error.subtask_count).toBe(3);
    expect(error.message).toContain("việc con");
  });

  it("khác lỗi 'task cha không tồn tại' của đường tạo/chuyển việc con", () => {
    expect(mapTaskWriteError(fkError)?.details?.[0]?.field).toBe("parent_id");
  });
});
