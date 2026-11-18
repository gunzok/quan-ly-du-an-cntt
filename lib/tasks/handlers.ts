import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ApiError } from "@/lib/api/errors";
import { isSameOrigin, isUuid, readJsonBody } from "@/lib/api/request";
import { apiError, errorResponse, jsonResponse } from "@/lib/api/respond";
import { strings } from "@/lib/strings";
import { labelNotInProject } from "@/lib/project-config/policy";
import { todayIso } from "@/lib/projects/format";
import {
  TASK_SELECT,
  toTask,
  type Task,
  type TaskListResponse,
  type TaskRow,
} from "./model";
import {
  canCreateTask,
  canDeleteTask,
  canEditTask,
  dateOrderError,
  mapTaskWriteError,
  type Actor,
  type ProjectRole,
} from "./policy";
import { parentCycle, parentNotEditable, parentNotFound } from "./subtasks";
import { loadTaskDetail } from "./detail";
import {
  countSubtasks,
  isSubtasksRemainError,
  subtasksRemain,
} from "./delete";
import {
  attachBlocked,
  blockedCompletionWarning,
  loadOpenBlockers,
  withBlocked,
} from "./blocked";
import {
  DEFAULT_TASK_LIST_SORT,
  ME,
  TASK_BODY_MAX_BYTES,
  encodeTaskCursor,
  sortField,
  isDateOrderValid,
  validateTaskCreate,
  validateTaskListQuery,
  validateTaskPatch,
} from "./validate";

/**
 * Lõi của /api/v1/projects/{id}/tasks và /api/v1/tasks/{id}. Route Handler chỉ tạo client phiên
 * rồi gọi các hàm này; test tích hợp gọi thẳng với client tự tạo.
 *
 * Mọi truy vấn chạy bằng client PHIÊN của người gọi (khóa anon, RLS áp dụng), không dùng
 * service_role: RLS là lớp kiểm thứ hai và quyết định cuối cùng.
 *
 * Thứ tự kiểm (security.md F1, F2; giống API quản trị người dùng):
 *   1. (POST/PATCH/DELETE) Origin trùng ứng dụng, chống CSRF: 403.
 *   2. Phiên: getUser() hỏi Supabase Auth; không có: 401.
 *   3. Tài nguyên người gọi không được thấy (không thuộc dự án, bị khóa, id sai): 404, không 403
 *      để không lộ sự tồn tại (BR-10).
 *   4. Quyền theo vai trò trong dự án (BR-02, BR-03): 403.
 *   5. Schema đầu vào, từ chối trường lạ: 400; quy tắc nghiệp vụ (BR-13, người được giao): 422.
 *      Task cha (E2-4) chỉ biết sau khi đọc thân request nên kiểm sau schema: không thấy hoặc khác
 *      dự án 422 (một lỗi, không lộ task dự án khác), không sửa được cha 403, tự làm cha 409.
 *      Trigger check_task_tree kiểm lại tất cả, cộng vòng (409), vượt 3 cấp kể cả cây con (422), và
 *      BR-04 (đóng cha khi còn việc con chưa xong: 422 kèm task_ids).
 */
export interface TaskDeps {
  /** Client theo phiên cookie của người gọi (khóa anon, RLS áp dụng). */
  session: SupabaseClient;
  requestId?: string;
  /** Đồng hồ cho bộ lọc `overdue` (test múi giờ); mặc định giờ hệ thống. */
  now?: () => Date;
}

interface Ctx {
  requestId: string;
}

type Step<T> = { ok: true; value: T } | { ok: false; response: Response };

function fail(error: ApiError, ctx: Ctx): Response {
  return errorResponse(error, ctx.requestId);
}

/** Ghi log lỗi hệ thống: chỉ mã, thông điệp ngắn và request_id; không ghi dữ liệu task. */
function internal(ctx: Ctx, where: string, error: unknown): Response {
  const e = error as { code?: unknown; message?: unknown };
  console.error(
    `[api/v1/tasks] ${where} request_id=${ctx.requestId} code=${String(e?.code ?? "")} message=${String(e?.message ?? error).slice(0, 200)}`,
  );
  return fail(apiError("internal_error"), ctx);
}

/** Task đã bị sửa sau lần đọc của người gọi (expected_updated_at lệch): 409. */
function staleTaskError(): ApiError {
  return apiError("conflict", strings.taskDetail.errors.stale);
}

function newCtx(deps: TaskDeps): Ctx {
  return { requestId: deps.requestId ?? randomUUID() };
}

async function requireUser(
  session: SupabaseClient,
  ctx: Ctx,
): Promise<Step<string>> {
  const { data, error } = await session.auth.getUser();
  const user = error ? null : data.user;
  if (!user) {
    return { ok: false, response: fail(apiError("unauthenticated"), ctx) };
  }
  return { ok: true, value: user.id };
}

/**
 * Quyền của người gọi trong một dự án, đọc qua RLS bằng phiên của họ. null = dự án không thấy được
 * (không tồn tại, không thuộc dự án, hoặc bị khóa): nơi gọi trả 404.
 */
async function loadActor(
  session: SupabaseClient,
  userId: string,
  projectId: string,
): Promise<Actor | null> {
  const [project, member, profile] = await Promise.all([
    session.from("projects").select("id").eq("id", projectId).maybeSingle(),
    session
      .from("project_members")
      .select("role")
      .eq("project_id", projectId)
      .eq("user_id", userId)
      .maybeSingle(),
    session.from("profiles").select("is_admin").eq("id", userId).maybeSingle(),
  ]);
  for (const r of [project, member, profile]) {
    if (r.error) throw r.error;
  }
  if (!project.data) return null;
  return {
    userId,
    isAdmin: profile.data?.is_admin === true,
    role: (member.data?.role as ProjectRole | undefined) ?? null,
  };
}

/** Task theo id qua RLS; null nếu không tồn tại hoặc người gọi không được thấy. */
async function loadTask(
  session: SupabaseClient,
  id: string,
): Promise<Task | null> {
  const { data, error } = await session
    .from("tasks")
    .select(TASK_SELECT)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data ? toTask(data as unknown as TaskRow) : null;
}

/** Mọi nhãn trong label_ids thuộc dự án (đọc qua RLS). Kiểm trước để không ghi dở dang. */
async function labelsBelongTo(
  session: SupabaseClient,
  projectId: string,
  labelIds: readonly string[],
): Promise<boolean> {
  if (labelIds.length === 0) return true;
  const { data, error } = await session
    .from("labels")
    .select("id")
    .eq("project_id", projectId)
    .in("id", [...labelIds]);
  if (error) throw error;
  return (data ?? []).length === labelIds.length;
}

/**
 * Task cha hợp lệ cho task (taskId = null khi tạo mới) trong dự án projectId: lớp kiểm thứ nhất,
 * cho thông điệp rõ. Vòng qua nhiều cấp và giới hạn 3 cấp (kể cả chiều cao cây con) để trigger
 * check_task_tree kiểm, trong khóa cấu trúc cây nên đúng cả khi đồng thời, và theo đúng thứ tự
 * vòng (409) trước độ sâu (422).
 */
async function parentError(
  session: SupabaseClient,
  actor: Actor,
  projectId: string,
  parentId: string,
  taskId: string | null,
): Promise<ApiError | null> {
  if (parentId === taskId) return parentCycle();
  const parent = await loadTask(session, parentId);
  // Không thấy (dự án khác, không tồn tại) và thấy nhưng khác dự án: cùng một lỗi.
  if (!parent || parent.project_id !== projectId) return parentNotFound();
  if (!canEditTask(actor, parent)) return parentNotEditable();
  return null;
}

/** Bước 1-3 chung cho /tasks/{id}: Origin (nếu ghi), phiên, task thấy được, quyền trong dự án. */
async function taskContext(
  request: Request,
  rawId: string,
  deps: TaskDeps,
  ctx: Ctx,
  write: boolean,
): Promise<Step<{ task: Task; actor: Actor }>> {
  if (write && !isSameOrigin(request)) {
    return { ok: false, response: fail(apiError("forbidden"), ctx) };
  }
  const user = await requireUser(deps.session, ctx);
  if (!user.ok) return user;
  if (!isUuid(rawId)) {
    return { ok: false, response: fail(apiError("not_found"), ctx) };
  }
  const task = await loadTask(deps.session, rawId.toLowerCase());
  if (!task) {
    return { ok: false, response: fail(apiError("not_found"), ctx) };
  }
  const actor = await loadActor(deps.session, user.value, task.project_id);
  if (!actor) {
    return { ok: false, response: fail(apiError("not_found"), ctx) };
  }
  return { ok: true, value: { task, actor } };
}

// ---------------------------------------------------------------------------
// GET /api/v1/projects/{id}/tasks
// ---------------------------------------------------------------------------
export async function handleListTasks(
  request: Request,
  rawProjectId: string,
  deps: TaskDeps,
): Promise<Response> {
  const ctx = newCtx(deps);
  try {
    const user = await requireUser(deps.session, ctx);
    if (!user.ok) return user.response;
    if (!isUuid(rawProjectId)) return fail(apiError("not_found"), ctx);
    const projectId = rawProjectId.toLowerCase();
    const actor = await loadActor(deps.session, user.value, projectId);
    if (!actor) return fail(apiError("not_found"), ctx);

    const parsed = validateTaskListQuery(new URL(request.url).searchParams);
    if (!parsed.ok) {
      return fail(
        apiError("validation_failed", undefined, parsed.details),
        ctx,
      );
    }
    const {
      limit,
      cursor,
      assignee_id,
      status_ids,
      priority,
      label_id,
      parent_id,
      q,
      due_after,
      due_before,
      created_by,
      open,
      overdue,
    } = parsed.data;
    const sort = parsed.data.sort ?? DEFAULT_TASK_LIST_SORT;
    const field = sortField(sort);
    const ascending = !sort.startsWith("-");
    // `me` (E13-2): người gọi; chế độ xem mặc định "Giao cho tôi", "Tạo bởi tôi".
    const me = (v: string | null | undefined) =>
      v === ME ? user.value : (v ?? null);
    const assignee = me(assignee_id);
    const author = me(created_by);

    // Lọc theo nhãn: nhúng task_labels lần hai với bí danh và !inner (chỉ task có nhãn đó), để
    // phần task_labels trả về vẫn đủ mọi nhãn của task.
    //
    // Có từ khóa (E3-3): đọc qua hàm public.search_tasks (SECURITY INVOKER, RLS của tasks vẫn áp
    // dụng; bỏ dấu, thoát ký tự LIKE trong CSDL). Hàm trả về hàng của bảng tasks nên nhúng, lọc,
    // sắp xếp, phân trang dưới đây giữ nguyên; riêng nhãn lọc trong hàm (p_label_id) vì PostgREST
    // không áp bộ lọc của bảng nhúng lên kết quả RPC.
    let query = (
      q
        ? deps.session
            .rpc(
              "search_tasks",
              // GET: tham số nằm trên URL; không gửi p_label_id khi không lọc (null thành "null").
              label_id
                ? { p_project_id: projectId, p_q: q, p_label_id: label_id }
                : { p_project_id: projectId, p_q: q },
              { get: true },
            )
            .select(TASK_SELECT)
        : deps.session
            .from("tasks")
            .select(
              label_id
                ? `${TASK_SELECT}, filter_labels:task_labels!inner(label_id)`
                : TASK_SELECT,
            )
    ).eq("project_id", projectId);
    if (label_id && !q) {
      query = query.eq("filter_labels.label_id", label_id);
    }
    if (assignee) query = query.eq("assignee_id", assignee);
    if (author) query = query.eq("created_by", author);
    // Chưa hoàn thành: completed_at null ⇔ trạng thái không thuộc nhóm done (trigger E2-3).
    if (open || overdue) query = query.is("completed_at", null);
    // Quá hạn: hạn trước hôm nay theo giờ Việt Nam (cùng định nghĩa với dashboard); hạn hôm nay
    // chưa trễ.
    if (overdue) {
      query = query.lt("due_date", todayIso(deps.now?.() ?? new Date()));
    }
    if (parent_id) query = query.eq("parent_id", parent_id);
    if (status_ids) query = query.in("status_id", status_ids);
    if (priority) query = query.eq("priority", priority);
    if (due_after) query = query.gte("due_date", due_after);
    if (due_before) query = query.lte("due_date", due_before);
    if (cursor) {
      // Giá trị con trỏ đã kiểm chặt định dạng (dấu thời gian ISO, uuid) và trường khớp `sort`
      // (validateTaskListQuery) nên ghép vào bộ lọc an toàn.
      const op = ascending ? "gt" : "lt";
      query = query.or(
        `${field}.${op}."${cursor.created_at}",and(${field}.eq."${cursor.created_at}",id.${op}.${cursor.id})`,
      );
    }
    const { data, error } = await query
      .order(field, { ascending })
      .order("id", { ascending })
      .limit(limit + 1);
    if (error) throw error;

    const rows = ((data ?? []) as unknown as TaskRow[]).map(toTask);
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    const body: TaskListResponse = {
      // E8-3: cờ bị chặn cho cả trang bằng một truy vấn tập hợp (không N+1).
      data: await attachBlocked(deps.session, page),
      next_cursor:
        rows.length > limit && last
          ? encodeTaskCursor(
              field === "updated_at"
                ? { created_at: last.updated_at, id: last.id, field }
                : { created_at: last.created_at, id: last.id },
            )
          : null,
    };
    return jsonResponse(body);
  } catch (error) {
    return internal(ctx, "list", error);
  }
}

// ---------------------------------------------------------------------------
// POST /api/v1/projects/{id}/tasks
// ---------------------------------------------------------------------------
export async function handleCreateTask(
  request: Request,
  rawProjectId: string,
  deps: TaskDeps,
): Promise<Response> {
  const ctx = newCtx(deps);
  if (!isSameOrigin(request)) return fail(apiError("forbidden"), ctx);
  try {
    const user = await requireUser(deps.session, ctx);
    if (!user.ok) return user.response;
    if (!isUuid(rawProjectId)) return fail(apiError("not_found"), ctx);
    const projectId = rawProjectId.toLowerCase();
    const actor = await loadActor(deps.session, user.value, projectId);
    if (!actor) return fail(apiError("not_found"), ctx);
    if (!canCreateTask(actor)) {
      return fail(
        apiError("forbidden", strings.tasks.errors.forbiddenCreate),
        ctx,
      );
    }

    const read = await readJsonBody(request, TASK_BODY_MAX_BYTES);
    if (!read.ok) return fail(read.error, ctx);
    const parsed = validateTaskCreate(read.body);
    if (!parsed.ok) {
      return fail(
        apiError("validation_failed", undefined, parsed.details),
        ctx,
      );
    }
    const { label_ids: labelIds, ...input } = parsed.data;
    if (!isDateOrderValid(input.start_date, input.due_date)) {
      return fail(dateOrderError(), ctx);
    }
    if (
      labelIds &&
      !(await labelsBelongTo(deps.session, projectId, labelIds))
    ) {
      return fail(labelNotInProject(), ctx);
    }
    if (input.parent_id) {
      const parent = await parentError(
        deps.session,
        actor,
        projectId,
        input.parent_id,
        null,
      );
      if (parent) return fail(parent, ctx);
    }

    // created_by không gửi: cột lấy mặc định auth.uid() và trình duyệt không có quyền cột này.
    // status_id, type_id không gửi: trigger apply_task_config lấy mặc định của dự án.
    const { data, error } = await deps.session
      .from("tasks")
      .insert({ ...input, project_id: projectId })
      .select(TASK_SELECT)
      .single();
    if (error) {
      const mapped = mapTaskWriteError(error);
      return mapped ? fail(mapped, ctx) : internal(ctx, "create", error);
    }
    let task = toTask(data as unknown as TaskRow);
    if (labelIds && labelIds.length > 0) {
      const { error: labelError } = await deps.session.rpc("set_task_labels", {
        p_task_id: task.id,
        p_label_ids: labelIds,
      });
      if (labelError) {
        // Không để lại task thiếu nhãn: người tạo luôn xóa được task mình vừa tạo.
        await deps.session.from("tasks").delete().eq("id", task.id);
        const mapped = mapTaskWriteError(labelError);
        return mapped
          ? fail(mapped, ctx)
          : internal(ctx, "create labels", labelError);
      }
      task = (await loadTask(deps.session, task.id)) ?? task;
    }
    // Task mới chưa có quan hệ nào nên không thể bị chặn.
    task = { ...task, blocked: false, blocked_by: [], blocked_by_count: 0 };
    return jsonResponse({ data: task }, 201, {
      location: `/api/v1/tasks/${task.id}`,
    });
  } catch (error) {
    return internal(ctx, "create", error);
  }
}

// ---------------------------------------------------------------------------
// GET /api/v1/tasks/{id}
// ---------------------------------------------------------------------------
export async function handleGetTask(
  request: Request,
  rawId: string,
  deps: TaskDeps,
): Promise<Response> {
  const ctx = newCtx(deps);
  try {
    const c = await taskContext(request, rawId, deps, ctx, false);
    if (!c.ok) return c.response;
    // E2-5: kèm task cha, việc con tóm tắt, quyền của người gọi (chỉ thêm trường).
    const [detail, blockers] = await Promise.all([
      loadTaskDetail(deps.session, c.value.task, c.value.actor),
      loadOpenBlockers(deps.session, [c.value.task.id]),
    ]);
    // E8-3: cờ bị chặn (chỉ thêm trường).
    return jsonResponse({ data: withBlocked(detail, blockers) });
  } catch (error) {
    return internal(ctx, "get", error);
  }
}

// ---------------------------------------------------------------------------
// PATCH /api/v1/tasks/{id}
// ---------------------------------------------------------------------------
export async function handlePatchTask(
  request: Request,
  rawId: string,
  deps: TaskDeps,
): Promise<Response> {
  const ctx = newCtx(deps);
  try {
    const c = await taskContext(request, rawId, deps, ctx, true);
    if (!c.ok) return c.response;
    const { task, actor } = c.value;
    if (!canEditTask(actor, task)) {
      return fail(
        apiError("forbidden", strings.tasks.errors.forbiddenEdit),
        ctx,
      );
    }

    const read = await readJsonBody(request, TASK_BODY_MAX_BYTES);
    if (!read.ok) return fail(read.error, ctx);
    const parsed = validateTaskPatch(read.body);
    if (!parsed.ok) {
      return fail(
        apiError("validation_failed", undefined, parsed.details),
        ctx,
      );
    }
    const {
      label_ids: labelIds,
      expected_updated_at: expectedUpdatedAt,
      ...patch
    } = parsed.data;

    // Sau khi sửa người gọi vẫn phải còn quyền (RLS WITH CHECK): Thành viên chỉ phụ trách, không
    // tạo task, thì không giao task đi cho người khác.
    const after = {
      created_by: task.created_by,
      assignee_id:
        patch.assignee_id !== undefined ? patch.assignee_id : task.assignee_id,
    };
    if (!canEditTask(actor, after)) {
      return fail(
        apiError("forbidden", strings.tasks.errors.forbiddenEdit),
        ctx,
      );
    }

    // Sửa đồng thời (E2-5): người gọi gửi updated_at đã đọc mà task đã đổi: 409, không ghi.
    if (
      expectedUpdatedAt !== undefined &&
      Date.parse(expectedUpdatedAt) !== Date.parse(task.updated_at)
    ) {
      return fail(staleTaskError(), ctx);
    }

    const start =
      patch.start_date !== undefined ? patch.start_date : task.start_date;
    const due = patch.due_date !== undefined ? patch.due_date : task.due_date;
    if (!isDateOrderValid(start, due)) {
      return fail(dateOrderError(), ctx);
    }

    if (
      labelIds &&
      !(await labelsBelongTo(deps.session, task.project_id, labelIds))
    ) {
      return fail(labelNotInProject(), ctx);
    }
    if (patch.parent_id && patch.parent_id !== task.parent_id) {
      const parent = await parentError(
        deps.session,
        actor,
        task.project_id,
        patch.parent_id,
        task.id,
      );
      if (parent) return fail(parent, ctx);
    }

    // Nhãn ghi bằng lệnh riêng (public.set_task_labels) sau khi sửa task; đã kiểm nhãn thuộc dự
    // án ở trên nên hiếm khi lệnh sau lỗi. Hai bước không cùng giao dịch (xem mô tả PR).
    if (Object.keys(patch).length > 0) {
      let update = deps.session.from("tasks").update(patch).eq("id", task.id);
      // Kiểm lại trong chính câu UPDATE (nguyên tử): ai đó ghi giữa lúc đọc và lúc ghi thì 0 dòng.
      if (expectedUpdatedAt !== undefined) {
        update = update.eq("updated_at", expectedUpdatedAt);
      }
      const { data, error } = await update.select("id").maybeSingle();
      if (error) {
        const mapped = mapTaskWriteError(error);
        return mapped ? fail(mapped, ctx) : internal(ctx, "update", error);
      }
      // Không dòng nào: task vừa bị xóa, quyền vừa đổi, hoặc (có expected_updated_at) vừa bị sửa.
      if (!data) {
        if (
          expectedUpdatedAt !== undefined &&
          (await loadTask(deps.session, task.id))
        ) {
          return fail(staleTaskError(), ctx);
        }
        return fail(apiError("not_found"), ctx);
      }
    }
    if (labelIds) {
      const { error } = await deps.session.rpc("set_task_labels", {
        p_task_id: task.id,
        p_label_ids: labelIds,
      });
      if (error) {
        const mapped = mapTaskWriteError(error);
        return mapped
          ? fail(mapped, ctx)
          : internal(ctx, "update labels", error);
      }
    }
    const updated = await loadTask(deps.session, task.id);
    if (!updated) return fail(apiError("not_found"), ctx);
    // E8-3, BR-06: hoàn thành task còn bị chặn vẫn thành công (200), chỉ kèm cảnh báo.
    const blockers = await loadOpenBlockers(deps.session, [updated.id]);
    const warning = blockedCompletionWarning(
      task,
      updated,
      blockers.get(updated.id),
    );
    return jsonResponse({
      data: withBlocked(updated, blockers),
      ...(warning ? { warnings: [warning] } : {}),
    });
  } catch (error) {
    return internal(ctx, "update", error);
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/v1/tasks/{id}: xóa vĩnh viễn (BR-11). Hộp thoại xác nhận là việc của giao diện.
// Task còn việc con (mọi cấp): 422 kèm `subtask_count` (QLDA-81), sau các bước 403/404/401.
// ---------------------------------------------------------------------------
export async function handleDeleteTask(
  request: Request,
  rawId: string,
  deps: TaskDeps,
): Promise<Response> {
  const ctx = newCtx(deps);
  try {
    const c = await taskContext(request, rawId, deps, ctx, true);
    if (!c.ok) return c.response;
    const { task, actor } = c.value;
    if (!canDeleteTask(actor, task)) {
      return fail(
        apiError("forbidden", strings.tasks.errors.forbiddenDelete),
        ctx,
      );
    }
    const { data, error } = await deps.session
      .from("tasks")
      .delete()
      .eq("id", task.id)
      .select("id");
    if (error) {
      // QLDA-81: còn việc con (khóa ngoại NO ACTION). Xét trước mapTaskWriteError, nơi 23503 của
      // tasks_parent_id_fkey nghĩa là "task cha không tồn tại" khi tạo/chuyển việc con.
      if (isSubtasksRemainError(error)) {
        return fail(
          subtasksRemain(await countSubtasks(deps.session, task)),
          ctx,
        );
      }
      const mapped = mapTaskWriteError(error);
      return mapped ? fail(mapped, ctx) : internal(ctx, "delete", error);
    }
    if (!data || data.length === 0) return fail(apiError("not_found"), ctx);
    return new Response(null, {
      status: 204,
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    return internal(ctx, "delete", error);
  }
}
