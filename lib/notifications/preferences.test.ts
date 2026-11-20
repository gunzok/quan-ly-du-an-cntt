import { describe, expect, it } from "vitest";
import { toEmailPreferences, validatePreferencesPut } from "./preferences";

describe("validatePreferencesPut", () => {
  it("nhận một hoặc nhiều loại", () => {
    expect(validatePreferencesPut({ email: { task_assigned: false } })).toEqual(
      { ok: true, data: { email: { task_assigned: false } } },
    );
    expect(
      validatePreferencesPut({
        email: { task_assigned: true, task_status_changed: true },
      }),
    ).toEqual({
      ok: true,
      data: { email: { task_assigned: true, task_status_changed: true } },
    });
  });

  it("nhận loại nhắc hạn task_due_soon (E4-3)", () => {
    expect(validatePreferencesPut({ email: { task_due_soon: false } })).toEqual(
      { ok: true, data: { email: { task_due_soon: false } } },
    );
  });

  it.each([
    [
      { email: { task_due_soon: 1 } },
      [{ field: "email.task_due_soon", issue: "invalid_value" }],
    ],
    [
      { email: { task_overdue: true } },
      [{ field: "email.task_overdue", issue: "unknown_field" }],
    ],
    [null, [{ field: "body", issue: "invalid_format" }]],
    [[], [{ field: "body", issue: "invalid_format" }]],
    [{}, [{ field: "email", issue: "required" }]],
    [{ email: {} }, [{ field: "email", issue: "required" }]],
    [{ email: true }, [{ field: "email", issue: "invalid_format" }]],
    [
      { email: { task_assigned: "true" } },
      [{ field: "email.task_assigned", issue: "invalid_value" }],
    ],
    [
      { email: { due_reminder: true } },
      [{ field: "email.due_reminder", issue: "unknown_field" }],
    ],
    [
      { email: { task_assigned: true }, user_id: "x" },
      [{ field: "user_id", issue: "unknown_field" }],
    ],
  ])("từ chối %j", (body, details) => {
    expect(validatePreferencesPut(body)).toEqual({ ok: false, details });
  });
});

describe("toEmailPreferences", () => {
  it("đủ mọi loại", () => {
    expect(
      toEmailPreferences([
        { type: "task_assigned", email_enabled: true },
        { type: "task_status_changed", email_enabled: false },
        { type: "task_due_soon", email_enabled: true },
      ]),
    ).toEqual({
      task_assigned: true,
      task_status_changed: false,
      task_due_soon: true,
    });
  });
  it("thiếu loại nhắc hạn (E4-3): null", () => {
    expect(
      toEmailPreferences([
        { type: "task_assigned", email_enabled: true },
        { type: "task_status_changed", email_enabled: false },
      ]),
    ).toBeNull();
  });
  it("thiếu loại (bị khóa, RLS trả rỗng): null", () => {
    expect(toEmailPreferences([])).toBeNull();
  });
});
