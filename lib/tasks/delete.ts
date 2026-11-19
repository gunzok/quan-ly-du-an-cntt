import type { SupabaseClient } from "@supabase/supabase-js";
import type { ApiError } from "@/lib/api/errors";
import { apiError } from "@/lib/api/respond";
import { strings } from "@/lib/strings";
import { TASK_MAX_DEPTH } from "./detail";
import type { DbError } from "./subtasks";

/**
 * QLDA-81: xóa task còn việc con bị từ chối. CSDL là nơi quyết định (khóa ngoại
 * tasks.parent_id ON DELETE NO ACTION, migration 20261115350000_block_parent_task_delete.sql), áp
 * dụng cho mọi đường ghi; API chỉ ánh xạ lỗi sang 422 và đếm số việc con để giao diện nói rõ.
 */

/** Lỗi khóa ngoại khi xóa task còn việc con trỏ tới (SQLSTATE 23503, tasks_parent_id_fkey). */
export function isSubtasksRemainError(error: DbError): boolean {
  return (
    error.code === "23503" &&
    (error.message?.includes("tasks_parent_id_fkey") ?? false)
  );
}

/** 422 `business_rule_violated`, kèm `subtask_count` (mọi cấp). */
export function subtasksRemain(count: number): ApiError {
  return {
    ...apiError(
      "business_rule_violated",
      strings.taskDelete.errors.hasSubtasks,
    ),
    subtask_count: count,
  };
}

/**
 * Đếm mọi hậu duệ (cây ≤ 3 cấp nên tối đa 2 truy vấn). Chạy bằng client phiên: người xóa được
 * task thì cùng dự án, RLS cho đọc mọi task của dự án nên số đếm không lộ gì.
 */
export async function countSubtasks(
  session: SupabaseClient,
  task: { id: string; project_id: string; depth: number },
): Promise<number> {
  let total = 0;
  let frontier = [task.id];
  for (
    let level = task.depth;
    level < TASK_MAX_DEPTH && frontier.length > 0;
    level++
  ) {
    const { data, error } = await session
      .from("tasks")
      .select("id")
      .eq("project_id", task.project_id)
      .in("parent_id", frontier);
    if (error) throw error;
    frontier = (data ?? []).map((r: { id: string }) => r.id);
    total += frontier.length;
  }
  return total;
}
