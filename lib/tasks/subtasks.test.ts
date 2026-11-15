import { describe, expect, it } from "vitest";
import { mapConfigWriteError } from "@/lib/project-config/policy";
import { strings } from "@/lib/strings";
import { mapTaskWriteError } from "./policy";
import { parseOpenSubtaskIds } from "./subtasks";
import { validateTaskCreate, validateTaskPatch } from "./validate";

const A = "6c1e8f9a-1b2c-4d3e-8f00-112233445566";
const B = "7d2f9a0b-2c3d-4e4f-9a11-223344556677";

describe("parent_id trong schema task (E2-4)", () => {
  it("tạo: nhận uuid (chuẩn hóa chữ thường) hoặc null", () => {
    const r = validateTaskCreate({ title: "x", parent_id: A.toUpperCase() });
    expect(r.ok && r.data.parent_id).toBe(A);
    const root = validateTaskCreate({ title: "x", parent_id: null });
    expect(root.ok && root.data.parent_id).toBeNull();
    const none = validateTaskCreate({ title: "x" });
    expect(none.ok && "parent_id" in none.data).toBe(false);
  });

  it("tạo và sửa: parent_id sai định dạng bị từ chối", () => {
    for (const parent_id of ["abc", 1, true, {}, [A]]) {
      expect(validateTaskCreate({ title: "x", parent_id })).toEqual({
        ok: false,
        details: [{ field: "parent_id", issue: "invalid_format" }],
      });
      expect(validateTaskPatch({ parent_id })).toEqual({
        ok: false,
        details: [{ field: "parent_id", issue: "invalid_format" }],
      });
    }
  });

  it("sửa: đổi cha hoặc tách thành task gốc", () => {
    expect(validateTaskPatch({ parent_id: A })).toEqual({
      ok: true,
      data: { parent_id: A },
    });
    expect(validateTaskPatch({ parent_id: null })).toEqual({
      ok: true,
      data: { parent_id: null },
    });
  });

  it("depth không ghi được qua API", () => {
    const r = validateTaskPatch({ depth: 1 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.details).toEqual([{ field: "depth", issue: "unknown_field" }]);
    }
  });
});

describe("parseOpenSubtaskIds", () => {
  it("tách DETAIL, bỏ phần không phải uuid, tối đa 5", () => {
    expect(parseOpenSubtaskIds(`${A},${B.toUpperCase()}`)).toEqual([A, B]);
    expect(parseOpenSubtaskIds(`${A},<script>,`)).toEqual([A]);
    expect(parseOpenSubtaskIds(Array(9).fill(A).join(","))).toHaveLength(5);
    expect(parseOpenSubtaskIds(null)).toEqual([]);
    expect(parseOpenSubtaskIds(undefined)).toEqual([]);
  });
});

describe("mapTaskWriteError: lỗi việc con", () => {
  const map = (code: string, message: string, details?: string) =>
    mapTaskWriteError({ code, message, details });

  it("cha không tồn tại/khác dự án và vượt 3 cấp: 422 trên parent_id", () => {
    for (const message of ["parent_not_in_project", "subtask_depth_exceeded"]) {
      const e = map("P0001", message);
      expect(e?.code).toBe("business_rule_violated");
      expect(e?.details).toEqual([
        { field: "parent_id", issue: "invalid_value" },
      ]);
    }
    expect(map("P0001", "parent_not_in_project")?.message).toBe(
      strings.subtasks.errors.parentNotFound,
    );
    expect(map("P0001", "subtask_depth_exceeded")?.message).toBe(
      strings.subtasks.errors.depthExceeded,
    );
  });

  it("vòng: 409", () => {
    expect(map("P0001", "task_parent_cycle")?.code).toBe("conflict");
    expect(
      map(
        "23514",
        'new row for relation "tasks" violates check constraint "tasks_parent_not_self"',
      )?.code,
    ).toBe("conflict");
  });

  it("BR-04: 422 kèm task_ids từ DETAIL", () => {
    const e = map("P0001", "parent_has_open_subtasks", `${A},${B}`);
    expect(e?.code).toBe("business_rule_violated");
    expect(e?.message).toBe(strings.subtasks.errors.openSubtasks);
    expect(e?.task_ids).toEqual([A, B]);
    expect(e?.details).toEqual([
      { field: "status_id", issue: "invalid_value" },
    ]);
  });

  it("không sửa được cha: 403 riêng; 42501 khác vẫn là 403 chung", () => {
    expect(map("42501", "parent_not_editable")).toMatchObject({
      code: "forbidden",
      message: strings.subtasks.errors.parentNotEditable,
    });
    expect(map("42501", "permission denied for table tasks")?.code).toBe(
      "forbidden",
    );
  });

  it("khóa ngoại parent_id: cha vừa bị xóa (không phải lỗi trạng thái)", () => {
    expect(
      map(
        "23503",
        'insert or update on table "tasks" violates foreign key constraint "tasks_parent_id_fkey"',
      )?.message,
    ).toBe(strings.subtasks.errors.parentNotFound);
  });

  it("khóa chết, tuần tự hóa: 409 thử lại", () => {
    expect(map("40P01", "deadlock detected")?.code).toBe("conflict");
    expect(map("40001", "could not serialize")?.code).toBe("conflict");
  });

  it("lỗi P0001 lạ vẫn là lỗi hệ thống (null)", () => {
    expect(map("P0001", "something_else")).toBeNull();
  });
});

describe("mapConfigWriteError: BR-04 khi đổi nhóm/xóa trạng thái", () => {
  it("422 kèm task_ids, không gắn trường", () => {
    const e = mapConfigWriteError("statuses", {
      code: "P0001",
      message: "parent_has_open_subtasks",
      details: A,
    });
    expect(e).toMatchObject({
      code: "business_rule_violated",
      message: strings.subtasks.errors.statusChangeBlocked,
      task_ids: [A],
    });
    expect(e?.details).toBeUndefined();
  });
});
