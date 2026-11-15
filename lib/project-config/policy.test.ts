import { describe, expect, it } from "vitest";
import { compareConfigItems, positionForMove } from "./model";
import {
  canManageConfig,
  mapConfigWriteError,
  mapTaskConfigError,
} from "./policy";

const actor = (role: "pm" | "member" | "viewer" | null, isAdmin = false) => ({
  userId: "u",
  isAdmin,
  role,
});

describe("canManageConfig", () => {
  it("chỉ PM của dự án và Admin", () => {
    expect(canManageConfig(actor("pm"))).toBe(true);
    expect(canManageConfig(actor(null, true))).toBe(true);
    expect(canManageConfig(actor("member"))).toBe(false);
    expect(canManageConfig(actor("viewer"))).toBe(false);
    expect(canManageConfig(actor(null))).toBe(false);
  });
});

describe("mapConfigWriteError", () => {
  it("ánh xạ lỗi CSDL sang mã API", () => {
    const code = (e: { code?: string; message?: string }) =>
      mapConfigWriteError("statuses", e)?.code ?? null;
    expect(code({ code: "23505" })).toBe("conflict");
    expect(code({ code: "23503" })).toBe("conflict");
    expect(code({ code: "P0001", message: "status_in_use" })).toBe("conflict");
    expect(code({ code: "P0001", message: "type_in_use" })).toBe("conflict");
    expect(code({ code: "P0001", message: "invalid_replacement" })).toBe(
      "business_rule_violated",
    );
    expect(code({ code: "P0001", message: "last_status_of_category" })).toBe(
      "business_rule_violated",
    );
    expect(code({ code: "P0001", message: "last_task_type" })).toBe(
      "business_rule_violated",
    );
    expect(code({ code: "P0002" })).toBe("not_found");
    expect(code({ code: "23514" })).toBe("validation_failed");
    expect(code({ code: "42501" })).toBe("forbidden");
    expect(code({ code: "P0001", message: "khác" })).toBeNull();
    expect(code({ code: "08006" })).toBeNull();
  });
});

describe("mapTaskConfigError", () => {
  it("trạng thái, loại, nhãn khác dự án: 422 kèm trường", () => {
    for (const [message, field] of [
      ["status_not_in_project", "status_id"],
      ["type_not_in_project", "type_id"],
      ["label_not_in_project", "label_ids"],
    ]) {
      const e = mapTaskConfigError({ code: "P0001", message });
      expect(e?.code).toBe("business_rule_violated");
      expect(e?.details?.[0]?.field).toBe(field);
    }
    expect(mapTaskConfigError({ code: "P0001", message: "x" })).toBeNull();
    expect(mapTaskConfigError({ code: "42501" })).toBeNull();
  });
});

describe("positionForMove", () => {
  const p = [1, 2, 3, 4];
  it("lên/xuống lấy điểm giữa hai hàng xóm ở chỗ mới", () => {
    expect(positionForMove(p, 2, -1)).toBe(1.5);
    expect(positionForMove(p, 1, -1)).toBe(0);
    expect(positionForMove(p, 1, 1)).toBe(3.5);
    expect(positionForMove(p, 2, 1)).toBe(5);
  });
  it("không đi quá đầu, cuối", () => {
    expect(positionForMove(p, 0, -1)).toBeNull();
    expect(positionForMove(p, 3, 1)).toBeNull();
    expect(positionForMove(p, 9, 1)).toBeNull();
  });
  it("sắp xếp theo position rồi tên", () => {
    const items = [
      { id: "b", name: "B", position: 2 },
      { id: "a", name: "A", position: 2 },
      { id: "c", name: "C", position: 1 },
    ];
    expect(items.sort(compareConfigItems).map((i) => i.id)).toEqual([
      "c",
      "a",
      "b",
    ]);
  });
});
