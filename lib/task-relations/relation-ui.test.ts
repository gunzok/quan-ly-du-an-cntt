import { describe, expect, it } from "vitest";
import { apiErrorBody } from "@/lib/api/errors";
import { apiError } from "@/lib/api/respond";
import { en } from "@/lib/i18n/messages/en";
import { vi } from "@/lib/i18n/messages/vi";
import { relationErrorText } from "@/components/task-detail/relation-errors";
import { relationLabel, toRelationView, type TaskRelation } from "./model";
import {
  crossProjectError,
  forbiddenRelation,
  mapRelationWriteError,
  selfRelationError,
} from "./policy";
import {
  RELATION_CHOICES,
  canEditTarget,
  choiceHasLag,
  createdView,
  oppositeLabel,
  parseLagDays,
  relationAccess,
  relationErrorKind,
  toCreateRequest,
} from "./relation-ui";

const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";
const ME = "00000000-0000-4000-8000-0000000000ee";

/** Lỗi như trình duyệt nhận được: qua apiErrorBody (gắn message_key). */
const wire = (e: ReturnType<typeof apiError>) => apiErrorBody(e).error;

describe("toCreateRequest: lựa chọn theo góc nhìn task đang xem → dòng lưu một chiều", () => {
  it.each([
    ["relates", A, B, "relates"],
    ["blocks", A, B, "blocks"],
    ["blocked_by", B, A, "blocks"],
    ["precedes", A, B, "precedes"],
    ["follows", B, A, "precedes"],
    ["duplicates", A, B, "duplicates"],
  ] as const)("%s: POST từ %s tới %s, kind %s", (choice, from, to, kind) => {
    const req = toCreateRequest(choice, A, B);
    expect(req.sourceTaskId).toBe(from);
    expect(req.body).toEqual({ kind, to_task_id: to });
  });

  it("lag_days chỉ gửi cho đứng trước / đứng sau, khác 0", () => {
    expect(toCreateRequest("precedes", A, B, 3).body.lag_days).toBe(3);
    expect(toCreateRequest("follows", A, B, -2).body.lag_days).toBe(-2);
    expect(toCreateRequest("precedes", A, B, 0).body).not.toHaveProperty(
      "lag_days",
    );
    expect(toCreateRequest("blocks", A, B, 5).body).not.toHaveProperty(
      "lag_days",
    );
    expect(RELATION_CHOICES.filter(choiceHasLag)).toEqual([
      "precedes",
      "follows",
    ]);
  });
});

describe("nhãn hai chiều", () => {
  it("lựa chọn ở task A hiện đúng nhãn ở A và nhãn đảo ở B (đọc lại từ API)", () => {
    for (const choice of RELATION_CHOICES) {
      const req = toCreateRequest(choice, A, B);
      const row: TaskRelation = {
        id: "r",
        from_task_id: req.sourceTaskId,
        to_task_id: req.body.to_task_id,
        kind: req.body.kind,
        lag_days: 0,
        created_by: ME,
        created_at: "2026-11-16T00:00:00Z",
      };
      const fromA = toRelationView(row, A, {
        id: B,
        title: "B",
        status_id: null,
      });
      const fromB = toRelationView(row, B, {
        id: A,
        title: "A",
        status_id: null,
      });
      expect(fromA.relation).toBe(choice);
      expect(fromB.relation).toBe(oppositeLabel(choice));
      // Dòng hiển thị ngay sau khi tạo khớp với dòng đọc lại từ API.
      const apiView = toRelationView(row, req.sourceTaskId, {
        id: "x",
        title: "x",
        status_id: null,
      });
      expect(
        createdView(apiView, choice, { id: B, title: "B", status_id: null }),
      ).toEqual(fromA);
    }
  });

  it("oppositeLabel là phép đảo, khớp relationLabel", () => {
    for (const kind of [
      "relates",
      "blocks",
      "precedes",
      "duplicates",
    ] as const) {
      expect(oppositeLabel(relationLabel(kind, "outgoing"))).toBe(
        relationLabel(kind, "incoming"),
      );
      expect(oppositeLabel(oppositeLabel(kind))).toBe(kind);
    }
  });

  it("có nhãn vi và en cho mọi kiểu hiển thị và câu mô tả cho mọi lựa chọn", () => {
    for (const m of [vi, en]) {
      for (const choice of RELATION_CHOICES) {
        expect(m.taskDetail.relations.kinds[choice]).toBeTruthy();
        expect(m.taskRelationsUi.preview[choice]("X", "Y")).toContain("Y");
      }
      expect(m.taskDetail.relations.kinds.duplicated_by).toBeTruthy();
    }
    expect(vi.taskDetail.relations.kinds.blocked_by).toBe("Bị chặn bởi");
    expect(en.taskDetail.relations.kinds.follows).toBe("Follows");
  });
});

describe("relationErrorKind / relationErrorText: lỗi dễ hiểu", () => {
  const cycle = mapRelationWriteError({
    code: "P0001",
    message: "task_relation_cycle",
  })!;
  const duplicate = mapRelationWriteError({ code: "23505" })!;

  it.each([
    ["409 vòng", wire(cycle), "cycle"],
    ["409 trùng", wire(duplicate), "duplicate"],
    ["422 tự quan hệ", wire(selfRelationError()), "selfRelation"],
    ["422 khác dự án", wire(crossProjectError()), "crossProject"],
    ["403 thiếu quyền", wire(forbiddenRelation()), "forbidden"],
    ["403 chung", wire(apiError("forbidden")), "forbidden"],
    ["404", wire(apiError("not_found")), "notFound"],
    ["400", wire(apiError("validation_failed")), "other"],
    ["500", wire(apiError("internal_error")), "other"],
  ] as const)("%s → %s", (_name, error, kind) => {
    expect(relationErrorKind(error)).toBe(kind);
  });

  it("vòng nói rõ 'tạo vòng' ở cả vi và en; lỗi khác dùng thông điệp chung", () => {
    expect(relationErrorText(vi, wire(cycle))).toContain("tạo vòng");
    expect(relationErrorText(en, wire(cycle))).toContain("cycle");
    expect(relationErrorText(vi, wire(duplicate))).toBe(
      vi.taskRelationsUi.errors.duplicate,
    );
    expect(relationErrorText(en, wire(forbiddenRelation()))).toBe(
      en.taskRelationsUi.errors.forbidden,
    );
    expect(relationErrorText(en, wire(apiError("internal_error")))).toBe(
      en.api.internal,
    );
  });

  it("thiếu message_key (lỗi 409 lạ) vẫn coi là trùng, không phải vòng", () => {
    expect(relationErrorKind({ code: "conflict", message: "x" })).toBe(
      "duplicate",
    );
  });
});

describe("quyền trên giao diện", () => {
  it("relationAccess: Người xem ẩn, Thành viên không sửa được thì khóa, sửa được thì bật", () => {
    expect(relationAccess("viewer", false, false)).toBe("hidden");
    expect(relationAccess(null, false, false)).toBe("hidden");
    expect(relationAccess("member", false, false)).toBe("locked");
    expect(relationAccess("member", false, true)).toBe("enabled");
    expect(relationAccess("pm", false, true)).toBe("enabled");
    expect(relationAccess(null, true, true)).toBe("enabled");
  });

  it("canEditTarget: Thành viên chỉ chọn task mình phụ trách hoặc tạo", () => {
    const member = { userId: ME, isAdmin: false, role: "member" as const };
    expect(canEditTarget(member, { assignee_id: ME, created_by: null })).toBe(
      true,
    );
    expect(canEditTarget(member, { assignee_id: null, created_by: ME })).toBe(
      true,
    );
    expect(canEditTarget(member, { assignee_id: A, created_by: B })).toBe(
      false,
    );
    expect(
      canEditTarget(
        { ...member, role: "pm" },
        { assignee_id: A, created_by: B },
      ),
    ).toBe(true);
    expect(
      canEditTarget(
        { ...member, role: "viewer" },
        { assignee_id: ME, created_by: ME },
      ),
    ).toBe(false);
  });
});

describe("parseLagDays", () => {
  it.each([
    ["", 0],
    ["0", 0],
    ["-0", 0],
    ["5", 5],
    ["+3", 3],
    ["-365", -365],
    ["365", 365],
    ["366", null],
    ["1.5", null],
    ["abc", null],
  ] as const)("%j → %j", (raw, value) => {
    expect(parseLagDays(raw)).toBe(value);
  });
});
