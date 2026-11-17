import type { SupabaseClient } from "@supabase/supabase-js";
import type { Task } from "./model";

/**
 * Cờ "bị chặn" của task (Story E8-3, QLDA-58, BR-06). BR-06 chỉ CẢNH BÁO, không chặn thao tác:
 * hoàn thành task bị chặn vẫn được (PATCH 200 kèm `warnings`).
 *
 * Định nghĩa (khớp số "bị chặn" của dashboard):
 *   - Task chặn mở: quan hệ `blocks` từ task khác tới task này, task kia chưa xong (completed_at
 *     null ⇔ trạng thái không thuộc nhóm done). `precedes` không chặn.
 *   - `blocked`: task CHƯA XONG và có ít nhất một task chặn mở. Task đã xong không còn bị chặn (hiện
 *     "Bị chặn" trên thẻ đã xong chỉ gây nhiễu).
 *   - `blocked_by`: tối đa BLOCKED_BY_MAX id task chặn mở (theo thứ tự tạo), rỗng khi không bị chặn.
 *   - `blocked_by_count`: tổng số task chặn mở (0 khi không bị chặn), để biết `blocked_by` bị cắt.
 * Chỉ tính quan hệ/task người gọi thấy (hàm public.task_open_blockers SECURITY INVOKER, RLS).
 */

/** Số id task chặn tối đa trả trong `blocked_by` và `warnings[].task_ids`. */
export const BLOCKED_BY_MAX = 5;

export const BLOCKED_WARNING_CODE = "blocked_by_open_task";

export interface BlockedWarning {
  code: typeof BLOCKED_WARNING_CODE;
  task_ids: string[];
}

export interface Blocked {
  blocked: boolean;
  blocked_by: string[];
  blocked_by_count: number;
}

export interface BlockerInfo {
  ids: string[];
  count: number;
}

interface BlockerRow {
  task_id: string;
  blocker_ids: string[] | null;
  blocker_count: number;
}

/** Số id gửi một lần (hàm SQL từ chối mảng > 1000). */
const CHUNK = 500;

/**
 * Task chặn còn mở của từng task, một truy vấn tập hợp cho mỗi CHUNK id (một trang danh sách tối đa
 * 500 task nên là một lời gọi). Task không có task chặn mở thì không có mặt trong Map.
 */
export async function loadOpenBlockers(
  session: SupabaseClient,
  taskIds: readonly string[],
): Promise<Map<string, BlockerInfo>> {
  const out = new Map<string, BlockerInfo>();
  const ids = [...new Set(taskIds)];
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { data, error } = await session.rpc("task_open_blockers", {
      p_task_ids: ids.slice(i, i + CHUNK),
      p_limit: BLOCKED_BY_MAX,
    });
    if (error) throw error;
    for (const row of (data ?? []) as BlockerRow[]) {
      out.set(row.task_id, {
        ids: row.blocker_ids ?? [],
        count: row.blocker_count,
      });
    }
  }
  return out;
}

/** Gắn `blocked`, `blocked_by` vào task theo kết quả loadOpenBlockers (thuần, test đơn vị). */
export function withBlocked<T extends Task>(
  task: T,
  blockers: ReadonlyMap<string, BlockerInfo>,
): T & Blocked {
  const info = blockers.get(task.id);
  const blocked = task.completed_at === null && !!info && info.count > 0;
  return {
    ...task,
    blocked,
    blocked_by: blocked && info ? info.ids.slice(0, BLOCKED_BY_MAX) : [],
    blocked_by_count: blocked && info ? info.count : 0,
  };
}

/** Gắn cờ cho cả danh sách bằng một lần đọc. */
export async function attachBlocked<T extends Task>(
  session: SupabaseClient,
  tasks: readonly T[],
): Promise<(T & Blocked)[]> {
  if (tasks.length === 0) return [];
  const blockers = await loadOpenBlockers(
    session,
    tasks.map((t) => t.id),
  );
  return tasks.map((t) => withBlocked(t, blockers));
}

/**
 * Cảnh báo sau PATCH (BR-06): task vừa được đưa vào nhóm done (trước chưa xong, sau đã xong) mà còn
 * task chặn mở. Trả null khi không cần cảnh báo.
 */
export function blockedCompletionWarning(
  before: Pick<Task, "completed_at">,
  after: Pick<Task, "completed_at">,
  info: BlockerInfo | undefined,
): BlockedWarning | null {
  if (before.completed_at !== null || after.completed_at === null) return null;
  if (!info || info.count === 0) return null;
  return {
    code: BLOCKED_WARNING_CODE,
    task_ids: info.ids.slice(0, BLOCKED_BY_MAX),
  };
}
