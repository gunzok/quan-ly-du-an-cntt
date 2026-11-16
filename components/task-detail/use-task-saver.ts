"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { TaskDetail } from "@/lib/tasks/detail";
import { patchTask } from "@/lib/tasks/client-api";
import { isNoop, undoPatch, type DetailField } from "@/lib/tasks/detail-view";
import type { TaskPatch } from "@/lib/tasks/validate";
import { apiErrorText } from "@/lib/i18n/api-error";
import { messageKeyOf } from "@/lib/i18n/message-key";
import { useStrings } from "@/lib/i18n/client";

export type SaveState =
  | { kind: "idle" }
  | { kind: "saving"; field: DetailField }
  | { kind: "saved"; field: DetailField; undo: TaskPatch | null }
  | { kind: "error"; field: DetailField; message: string };

const STALE_KEY = "taskDetail.errors.stale";

/**
 * Lưu theo từng trường (PATCH /api/v1/tasks/{id}) cho ngăn chi tiết task (Story E2-5).
 *
 * - Các lần lưu chạy NỐI TIẾP (hàng đợi): lần sau gửi updated_at mới nhất của lần trước, nên tự
 *   sửa nhanh nhiều trường không bị coi là xung đột.
 * - Mỗi PATCH gửi `expected_updated_at`: người khác vừa sửa thì máy chủ trả 409, ngăn tải lại bản
 *   mới nhất (onStale) và báo, không ghi đè.
 * - Lỗi gắn vào trường (fieldErrors); ô nhập về lại giá trị đã lưu (resetKey tăng để remount).
 * - Lưu xong có "Hoàn tác": một PATCH ngược với giá trị cũ.
 */
export function useTaskSaver(
  task: TaskDetail | null,
  setTask: (update: (prev: TaskDetail) => TaskDetail) => void,
  onStale: () => void,
) {
  const strings = useStrings();
  const t = strings.taskDetail;
  const [state, setState] = useState<SaveState>({ kind: "idle" });
  const [fieldErrors, setFieldErrors] = useState<
    Partial<Record<DetailField, string>>
  >({});
  const [resetKey, setResetKey] = useState(0);
  const taskRef = useRef<TaskDetail | null>(task);
  useEffect(() => {
    taskRef.current = task;
  }, [task]);
  const queue = useRef<Promise<unknown>>(Promise.resolve());

  const run = useCallback(
    async (
      field: DetailField,
      patch: TaskPatch,
      isUndo: boolean,
    ): Promise<boolean> => {
      const current = taskRef.current;
      if (!current) return false;
      if (isNoop(current, patch)) {
        setFieldErrors((prev) => ({ ...prev, [field]: undefined }));
        return true;
      }
      setState({ kind: "saving", field });
      const result = await patchTask(current.id, {
        ...patch,
        expected_updated_at: current.updated_at,
      });
      if (result.ok) {
        const undo = isUndo ? null : undoPatch(current, patch);
        const next = { ...current, ...result.data.data };
        taskRef.current = next;
        setTask((prev) => ({ ...prev, ...result.data.data }));
        setFieldErrors((prev) => ({ ...prev, [field]: undefined }));
        setState({ kind: "saved", field, undo });
        return true;
      }
      const key =
        result.error.message_key ?? messageKeyOf(result.error.message);
      if (result.error.code === "conflict" && key === STALE_KEY) {
        setState({ kind: "error", field, message: t.save.stale });
        setResetKey((n) => n + 1);
        onStale();
        return false;
      }
      setFieldErrors((prev) => ({
        ...prev,
        [field]: apiErrorText(strings, result.error),
      }));
      setState({
        kind: "error",
        field,
        message: t.save.failed(t.fields[field]),
      });
      setResetKey((n) => n + 1);
      return false;
    },
    [onStale, setTask, strings, t],
  );

  const save = useCallback(
    (field: DetailField, patch: TaskPatch, isUndo = false) => {
      const next = queue.current.then(() => run(field, patch, isUndo));
      queue.current = next.catch(() => undefined);
      return next;
    },
    [run],
  );

  const clearFieldError = useCallback((field: DetailField) => {
    setFieldErrors((prev) => ({ ...prev, [field]: undefined }));
  }, []);

  return { state, fieldErrors, resetKey, save, clearFieldError };
}
