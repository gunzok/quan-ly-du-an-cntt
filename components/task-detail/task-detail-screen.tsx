"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { CloseIcon, ErrorIcon } from "@/components/ui/icons";
import { Skeleton, SkeletonGroup } from "@/components/ui/skeleton";
import { ToastProvider, useToast } from "@/components/ui/toast";
import type { ApiError } from "@/lib/api/errors";
import { fetchConfig } from "@/lib/project-config/client-api";
import type { Label, TaskStatus, TaskType } from "@/lib/project-config/model";
import { fetchMembers } from "@/lib/project-members/client-api";
import {
  displayName,
  type ProjectMember,
  type ProjectRole,
} from "@/lib/project-members/model";
import { fetchRelations } from "@/lib/task-relations/client-api";
import type { TaskRelationView } from "@/lib/task-relations/model";
import { relationAccess } from "@/lib/task-relations/relation-ui";
import { blockerItems } from "@/lib/tasks/blocked-view";
import { deleteTask, fetchTaskDetail } from "@/lib/tasks/client-api";
import type { TaskDetail } from "@/lib/tasks/detail";
import {
  assigneeOptions,
  canEditField,
  readOnlyReason,
} from "@/lib/tasks/detail-view";
import { apiErrorText } from "@/lib/i18n/api-error";
import { useStrings } from "@/lib/i18n/client";
import { Properties } from "./properties";
import { BlockedBanner } from "./blocked-banner";
import { TaskActivitySection } from "@/components/activity/task-activity-section";
import { RelationsSection, type RelationsState } from "./relations-section";
import { DeleteBlockedDialog } from "./delete-blocked-dialog";
import { SubtasksSection } from "./subtasks-section";
import { DescriptionSection, TitleEditor } from "./text-fields";
import { useTaskSaver } from "./use-task-saver";

/** id tiêu đề mục Việc con: đích của liên kết trong hộp thoại xóa bị chặn (QLDA-81). */
const SUBTASKS_ANCHOR_ID = "task-subtasks";

export interface TaskDetailScreenProps {
  projectId: string;
  projectName: string;
  taskId: string;
  /** Id người đang xem: tính quyền sửa task đích khi thêm quan hệ (E8-2), chỉ để khóa giao diện. */
  userId: string;
  /** Vai trò của người xem trong dự án (null: Admin không là thành viên). */
  role: ProjectRole | null;
  isAdmin: boolean;
}

/**
 * Chi tiết task (Story E2-5, S05 v2, mockup v3 bp-TaskDetail.dc.html). Màn rộng (≥ lg): ngăn bên
 * phải, bên trái là vùng nền dẫn về bảng dự án (bảng Kanban thuộc E3-1). Điện thoại: toàn trang.
 * Cùng một thành phần cho cả hai, chỉ khác lớp CSS.
 *
 * Dữ liệu qua /api/v1 (client phiên, RLS); quyền sửa lấy từ `permissions` của GET /tasks/{id}, chỉ
 * để khóa giao diện, API kiểm lại ở từng request. Nhật ký task (mục 04 của mockup, E6-2) chỉ hiện
 * cho PM của dự án và Admin.
 */
export function TaskDetailScreen(props: TaskDetailScreenProps) {
  return (
    <ToastProvider>
      <Screen {...props} />
    </ToastProvider>
  );
}

type Loaded<T> =
  | { key: number; status: "ready"; value: T }
  | { key: number; status: "error"; error: ApiError };

interface Config {
  statuses: TaskStatus[];
  types: TaskType[];
  labels: Label[];
  members: ProjectMember[];
}

/** Gọi lại API mà không ném lỗi Abort ra ngoài. */
function ignoreAbort(error: unknown) {
  if ((error as { name?: string }).name !== "AbortError") throw error;
}

function Screen({
  projectId,
  projectName,
  taskId,
  userId,
  role,
  isAdmin,
}: TaskDetailScreenProps) {
  const strings = useStrings();
  const t = strings.taskDetail;
  const router = useRouter();
  const { toast } = useToast();
  const boardHref = `/projects/${projectId}`;

  // --- Task -----------------------------------------------------------------
  const [taskKey, setTaskKey] = useState(0);
  const [taskState, setTaskState] = useState<Loaded<TaskDetail> | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetchTaskDetail(taskId, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        setTaskState(
          result.ok
            ? { key: taskKey, status: "ready", value: result.data.data }
            : { key: taskKey, status: "error", error: result.error },
        );
      })
      .catch(ignoreAbort);
    return () => controller.abort();
  }, [taskId, taskKey]);
  const reloadTask = useCallback(() => setTaskKey((n) => n + 1), []);

  // --- Cấu hình dự án + thành viên (một lần) ------------------------------------
  const [configKey, setConfigKey] = useState(0);
  const [configState, setConfigState] = useState<Loaded<Config> | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    Promise.all([
      fetchConfig("statuses", projectId, signal),
      fetchConfig("task-types", projectId, signal),
      fetchConfig("labels", projectId, signal),
      fetchMembers(projectId, signal),
    ])
      .then(([statuses, types, labels, members]) => {
        if (signal.aborted) return;
        if (!statuses.ok || !types.ok || !labels.ok || !members.ok) {
          const failed = [statuses, types, labels, members].find((r) => !r.ok);
          setConfigState({
            key: configKey,
            status: "error",
            error: (failed as { ok: false; error: ApiError }).error,
          });
          return;
        }
        setConfigState({
          key: configKey,
          status: "ready",
          value: {
            statuses: statuses.data.data,
            types: types.data.data,
            labels: labels.data.data,
            members: members.data.data,
          },
        });
      })
      .catch(ignoreAbort);
    return () => controller.abort();
  }, [projectId, configKey]);

  // --- Quan hệ (E8-1 hiển thị; E8-2 thêm, bỏ) ------------------------------------
  const [relKey, setRelKey] = useState(0);
  const [relLoaded, setRelLoaded] = useState<{
    key: number;
    state: RelationsState;
  } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetchRelations(taskId, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        setRelLoaded({
          key: relKey,
          state: result.ok
            ? { status: "ready", relations: result.data.data }
            : { status: "error", error: result.error },
        });
      })
      .catch(ignoreAbort);
    return () => controller.abort();
  }, [taskId, relKey]);
  const relations: RelationsState =
    relLoaded && relLoaded.key === relKey
      ? relLoaded.state
      : { status: "loading" };
  const updateRelations = useCallback(
    (update: (list: TaskRelationView[]) => TaskRelationView[]) =>
      setRelLoaded((prev) =>
        prev && prev.state.status === "ready"
          ? {
              ...prev,
              state: {
                status: "ready",
                relations: update(prev.state.relations),
              },
            }
          : prev,
      ),
    [],
  );

  const task = taskState?.status === "ready" ? taskState.value : null;
  const setTask = useCallback(
    (update: (prev: TaskDetail) => TaskDetail) =>
      setTaskState((prev) =>
        prev?.status === "ready"
          ? { ...prev, value: update(prev.value) }
          : prev,
      ),
    [],
  );
  // BR-06 (E8-3): đổi trạng thái sang nhóm done khi còn bị chặn vẫn lưu, chỉ báo cảnh báo.
  const relationList =
    relations.status === "ready" ? relations.relations : null;
  const onBlockedWarning = useCallback(
    (title: string, ids: readonly string[]) => {
      const titles = ids
        .map((id) => relationList?.find((r) => r.task.id === id)?.task.title)
        .filter((x): x is string => !!x);
      toast({
        tone: "warning",
        title: strings.blockedTask.toastTitle(title),
        description:
          titles.length === ids.length
            ? strings.blockedTask.toastBody(
                titles.map((x) => `“${x}”`).join(", "),
              )
            : strings.blockedTask.toastBodyCount(ids.length),
        duration: 8000,
      });
    },
    [relationList, strings, toast],
  );
  const saver = useTaskSaver(task, setTask, reloadTask, onBlockedWarning);

  const config = configState?.status === "ready" ? configState.value : null;
  const assignees = useMemo(
    () =>
      config && task
        ? assigneeOptions(config.members, task.assignee_id, displayName)
        : [],
    [config, task],
  );

  // Lỗi tải task lần đầu (hoặc khi đang lỗi mà bấm thử lại): toàn ngăn báo lỗi.
  const firstLoad = !taskState || (!task && taskState.key !== taskKey);
  const configLoading = !configState || configState.key !== configKey;

  async function remove() {
    if (!task) return;
    const result = await deleteTask(task.id);
    if (!result.ok) {
      const count = result.error.subtask_count;
      toast({
        tone: "error",
        title: t.delete.failed,
        description:
          typeof count === "number"
            ? strings.taskDelete.blockedBody(count)
            : apiErrorText(strings, result.error),
      });
      // QLDA-81: vừa có người thêm việc con: tải lại để nút xóa chuyển sang hộp thoại bị chặn.
      if (typeof count === "number") reloadTask();
      return;
    }
    // Về task cha nếu có, không thì về bảng dự án.
    router.push(
      task.parent
        ? `/projects/${projectId}/tasks/${task.parent.id}`
        : boardHref,
    );
    router.refresh();
  }

  const reason = task ? readOnlyReason(role, isAdmin, task.permissions) : null;
  // E8-3: task chặn chưa xong; quan hệ chưa tải được thì dùng blocked_by của API (chỉ id).
  const blockers = task
    ? blockerItems(
        task,
        relations.status === "ready" ? relations.relations : null,
        (id) => config?.statuses.find((s) => s.id === id)?.category,
      )
    : [];
  const typeName =
    (task && config?.types.find((x) => x.id === task.type_id)?.name) ??
    t.pageTitle;

  return (
    <div className="flex min-h-full flex-1">
      {/* Màn rộng: vùng nền thay cho bảng (bảng Kanban là trang riêng của E3-1). */}
      <div
        aria-hidden="true"
        className="hidden min-w-0 flex-1 bg-bg-muted lg:block"
        style={{
          backgroundImage:
            "linear-gradient(color-mix(in srgb, var(--color-accent) 10%, transparent) 1px, transparent 1px), linear-gradient(90deg, color-mix(in srgb, var(--color-accent) 10%, transparent) 1px, transparent 1px)",
          backgroundSize: "24px 24px",
        }}
      />
      <aside
        aria-label={t.panelLabel}
        aria-busy={firstLoad || undefined}
        data-testid="task-detail"
        className="flex w-full min-w-0 flex-col gap-5 bg-bg px-4 py-5 sm:px-6 lg:max-w-[640px] lg:border-0 lg:border-l lg:border-solid lg:border-border"
      >
        <div className="flex items-center justify-between gap-3">
          <span className="label min-w-0 [overflow-wrap:anywhere]">
            {t.eyebrow(typeName, projectName)}
          </span>
          <Link
            href={boardHref}
            aria-label={t.close}
            title={t.close}
            className="inline-flex size-11 shrink-0 items-center justify-center rounded-md text-text-muted hover:bg-bg-muted"
          >
            <CloseIcon className="size-5" />
          </Link>
        </div>

        {firstLoad ? (
          <SkeletonGroup label={t.loading}>
            <Skeleton className="h-9 w-3/4" />
            <Skeleton className="h-40" />
            <Skeleton className="h-24" />
          </SkeletonGroup>
        ) : !task ? (
          <div role="alert" className="flex flex-col items-start gap-3">
            <p className="m-0 flex items-center gap-2 text-sm text-danger">
              <ErrorIcon className="size-4 shrink-0" />
              {t.loadError}{" "}
              {taskState?.status === "error"
                ? apiErrorText(strings, taskState.error)
                : null}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={reloadTask}>
                {t.retry}
              </Button>
              <Link
                href={boardHref}
                className="inline-flex min-h-11 items-center text-sm"
              >
                {t.backToBoard}
              </Link>
            </div>
          </div>
        ) : (
          <>
            <TitleEditor
              key={`title-${task.id}-${saver.resetKey}`}
              title={task.title}
              editable={canEditField("title", task.permissions)}
              serverError={saver.fieldErrors.title}
              save={saver.save}
            />

            {reason ? (
              <p
                data-testid="task-read-only"
                className="m-0 flex flex-wrap items-center gap-2 text-sm text-text-muted"
              >
                <Badge tone="neutral">{t.readOnlyBadge}</Badge>
                {t.readOnly[reason]}
              </p>
            ) : null}

            <BlockedBanner projectId={projectId} items={blockers} />

            <SaveStatus saver={saver} />

            {configLoading ? (
              <SkeletonGroup label={t.loading}>
                <Skeleton className="h-64" />
              </SkeletonGroup>
            ) : !config ? (
              <div role="alert" className="flex flex-wrap items-center gap-3">
                <p className="m-0 text-sm text-danger">
                  {t.loadError}{" "}
                  {configState?.status === "error"
                    ? apiErrorText(strings, configState.error)
                    : null}
                </p>
                <Button
                  variant="secondary"
                  onClick={() => setConfigKey((n) => n + 1)}
                >
                  {t.retry}
                </Button>
              </div>
            ) : (
              <Properties
                task={task}
                statuses={config.statuses}
                types={config.types}
                labels={config.labels}
                assignees={assignees}
                fieldErrors={saver.fieldErrors}
                resetKey={saver.resetKey}
                savingField={
                  saver.state.kind === "saving" ? saver.state.field : null
                }
                save={saver.save}
              />
            )}

            <DescriptionSection
              key={`description-${task.id}-${saver.resetKey}`}
              number="01"
              description={task.description}
              editable={canEditField("description", task.permissions)}
              serverError={saver.fieldErrors.description}
              save={saver.save}
            />

            <SubtasksSection
              key={`subtasks-${task.id}`}
              anchorId={SUBTASKS_ANCHOR_ID}
              number="02"
              task={task}
              statuses={config?.statuses ?? []}
              onAdded={reloadTask}
            />

            <RelationsSection
              number="03"
              projectId={projectId}
              task={{ id: task.id, title: task.title }}
              state={relations}
              statuses={config?.statuses ?? []}
              access={relationAccess(role, isAdmin, task.permissions.can_edit)}
              actor={{ userId, isAdmin, role }}
              onRetry={() => setRelKey((n) => n + 1)}
              onChange={updateRelations}
            />

            {isAdmin || role === "pm" ? (
              <TaskActivitySection
                number="04"
                projectId={projectId}
                taskId={task.id}
                reloadToken={task.updated_at}
              />
            ) : null}

            {task.permissions.can_delete ? (
              <div className="flex border-0 border-t border-solid border-border pt-4">
                {task.subtasks.length > 0 ? (
                  <DeleteBlockedDialog
                    taskTitle={task.title}
                    subtaskCount={task.subtasks.length}
                    subtasksAnchorId={SUBTASKS_ANCHOR_ID}
                  />
                ) : (
                  <ConfirmDialog
                    trigger={
                      <Button variant="danger">{t.delete.action}</Button>
                    }
                    title={t.delete.title(task.title)}
                    description={t.delete.body}
                    confirmLabel={t.delete.confirm}
                    onConfirm={remove}
                  />
                )}
              </div>
            ) : null}
          </>
        )}
      </aside>
    </div>
  );
}

/** Dòng trạng thái lưu (đang lưu / đã lưu + Hoàn tác / lỗi), đọc bởi trình đọc màn hình. */
function SaveStatus({ saver }: { saver: ReturnType<typeof useTaskSaver> }) {
  const strings = useStrings();
  const t = strings.taskDetail;
  const { state } = saver;
  const [undone, setUndone] = useState<string | null>(null);
  const [lastState, setLastState] = useState(state);
  if (lastState !== state) {
    setLastState(state);
    if (state.kind === "saving") setUndone(null);
  }
  const field = state.kind === "idle" ? null : t.fields[state.field];

  return (
    <div
      role="status"
      data-testid="task-save-status"
      // Rỗng (chưa lưu gì): bù khoảng cách của cột để không để lại dải trống.
      className="flex flex-wrap items-center gap-2 text-sm empty:-mt-5"
    >
      {undone ? (
        <span className="text-text-muted">{undone}</span>
      ) : state.kind === "saving" ? (
        <span className="text-text-muted">{t.save.saving(field ?? "")}</span>
      ) : state.kind === "saved" ? (
        <>
          <span className="text-success">{t.save.saved(field ?? "")}</span>
          {state.undo ? (
            <Button
              variant="text"
              onClick={async () => {
                const undo = state.undo;
                if (!undo) return;
                const ok = await saver.save(state.field, undo, true);
                if (ok) setUndone(t.save.undone(field ?? ""));
              }}
            >
              {t.save.undo}
            </Button>
          ) : null}
        </>
      ) : state.kind === "error" ? (
        <span className="flex items-center gap-1.5 text-danger">
          <ErrorIcon className="size-4 shrink-0" />
          {state.message}
        </span>
      ) : null}
    </div>
  );
}
