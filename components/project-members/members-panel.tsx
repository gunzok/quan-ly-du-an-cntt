"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton, SkeletonGroup } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import type { ApiError } from "@/lib/api/errors";
import { HOME_PATH } from "@/lib/auth/routes";
import { deleteMember, fetchMembers } from "@/lib/project-members/client-api";
import {
  activePmCount,
  compareMembers,
  displayName,
  type ProjectMember,
  type ProjectRole,
} from "@/lib/project-members/model";
import { strings } from "@/lib/strings";
import { AddMemberDialog, ChangeRoleDialog } from "./member-dialogs";

const t = strings.projectMembers;
const roles = strings.projects.roles;

type Loaded =
  | { key: number; status: "ready"; members: ProjectMember[] }
  | { key: number; status: "error"; error: ApiError };

const ROLE_TONE: Record<ProjectRole, "primary" | "success" | "neutral"> = {
  pm: "primary",
  member: "success",
  viewer: "neutral",
};

/**
 * Tab Thành viên ở màn cấu hình dự án (Story E1-6): danh sách thành viên và vai trò; PM của dự án
 * và Admin thêm (tìm người + chọn vai trò), đổi vai trò, gỡ có xác nhận. Vai trò khác chỉ đọc.
 * API và CSDL vẫn kiểm lại quyền, người đích đang hoạt động và PM cuối cùng.
 */
export function MembersPanel({
  projectId,
  currentUserId,
  canEdit,
}: {
  projectId: string;
  currentUserId: string;
  canEdit: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [reloadKey, setReloadKey] = useState(0);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<ProjectMember | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetchMembers(projectId, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        setLoaded(
          result.ok
            ? { key: reloadKey, status: "ready", members: result.data.data }
            : { key: reloadKey, status: "error", error: result.error },
        );
      })
      .catch((error: unknown) => {
        if ((error as { name?: string }).name !== "AbortError") throw error;
      });
    return () => controller.abort();
  }, [projectId, reloadKey]);

  const reload = useCallback(() => setReloadKey((n) => n + 1), []);

  const members =
    loaded?.status === "ready" ? [...loaded.members].sort(compareMembers) : [];
  const loading = !loaded || loaded.key !== reloadKey;
  const pmCount = activePmCount(members);

  function handleAdded(member: ProjectMember) {
    setAddOpen(false);
    toast({
      title: t.done.added(displayName(member.user), roles[member.role]),
    });
    reload();
  }

  function handleRoleSaved(member: ProjectMember, changed: boolean) {
    setEditing(null);
    const name = displayName(member.user);
    toast({
      title: changed
        ? t.done.changed(name, roles[member.role])
        : t.done.unchanged(name, roles[member.role]),
    });
    // Tự hạ khỏi PM: quyền sửa đổi, tải lại phần máy chủ để chuyển sang chỉ đọc.
    if (member.user_id === currentUserId && member.role !== "pm") {
      router.refresh();
    }
    reload();
  }

  async function remove(member: ProjectMember) {
    const name = displayName(member.user);
    const result = await deleteMember(projectId, member.user_id);
    if (!result.ok) {
      toast({
        title: t.errors.actionFailed,
        description: result.error.message,
        tone: "error",
      });
      return;
    }
    toast({ title: t.done.removed(name) });
    if (member.user_id === currentUserId) {
      // Tự rời dự án: có thể không còn thấy dự án (trừ Admin).
      router.push(HOME_PATH);
      return;
    }
    reload();
  }

  return (
    <section
      id="project-members"
      aria-labelledby="project-members-heading"
      className="flex flex-col gap-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="project-members-heading" className="label">
          {t.listLabel}
          {loaded?.status === "ready" ? ` (${members.length})` : null}
        </h2>
        {canEdit ? (
          <Button variant="secondary" onClick={() => setAddOpen(true)}>
            + {t.add}
          </Button>
        ) : null}
      </div>
      <p className="text-sm text-text-muted">{t.roleNote}</p>

      {loaded?.status === "error" && !loading ? (
        <div role="alert" className="flex flex-wrap items-center gap-3">
          <p className="text-sm text-danger">
            {t.loadError} {loaded.error.message}
          </p>
          <Button variant="secondary" onClick={reload}>
            {t.retry}
          </Button>
        </div>
      ) : !loaded ? (
        <SkeletonGroup label={t.loading} className="flex flex-col gap-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-14" />
          ))}
        </SkeletonGroup>
      ) : members.length === 0 ? (
        <EmptyState title={t.empty} headingLevel={3} />
      ) : (
        <ul
          aria-label={t.listLabel}
          aria-busy={loading || undefined}
          className="m-0 flex list-none flex-col rounded-lg border border-solid border-border p-0"
        >
          {members.map((member) => {
            const name = displayName(member.user);
            const self = member.user_id === currentUserId;
            return (
              <li
                key={member.user_id}
                data-member={member.user_id}
                className="flex flex-wrap items-center gap-x-3 gap-y-2 border-0 border-t border-solid border-border px-3 py-2 first:border-t-0"
              >
                <Avatar name={name} size="sm" />
                <div className="flex min-w-0 flex-1 basis-48 flex-col">
                  <span className="font-medium [overflow-wrap:anywhere]">
                    {name}
                    {self ? (
                      <span className="text-text-muted"> {t.you}</span>
                    ) : null}
                  </span>
                  <span className="text-xs text-text-muted [overflow-wrap:anywhere]">
                    {member.user.email ?? t.noEmail}
                    {member.user.department
                      ? ` · ${member.user.department.name}`
                      : null}
                  </span>
                </div>
                {member.user.is_active ? null : (
                  <Badge tone="danger">{t.locked}</Badge>
                )}
                <Badge tone={ROLE_TONE[member.role]}>
                  <span className="sr-only">{t.roleOf(name)}: </span>
                  {roles[member.role]}
                </Badge>
                {canEdit ? (
                  <div
                    role="group"
                    aria-label={t.actions.groupLabel(name)}
                    className="flex flex-wrap gap-1"
                  >
                    <Button
                      variant="secondary"
                      onClick={() => setEditing(member)}
                    >
                      {t.actions.changeRole}
                      <span className="sr-only"> {name}</span>
                    </Button>
                    <ConfirmDialog
                      trigger={
                        <Button
                          variant="text"
                          aria-label={t.actions.removeAction(name)}
                        >
                          {t.actions.remove}
                        </Button>
                      }
                      title={t.removeDialog.title(name)}
                      description={
                        self ? t.removeDialog.selfBody : t.removeDialog.body
                      }
                      confirmLabel={t.removeDialog.confirm}
                      onConfirm={() => remove(member)}
                    />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      <p className="text-sm text-text-muted">{t.assigneeNote}</p>

      {canEdit ? (
        <>
          <AddMemberDialog
            projectId={projectId}
            open={addOpen}
            onOpenChange={setAddOpen}
            onAdded={handleAdded}
          />
          <ChangeRoleDialog
            projectId={projectId}
            member={editing}
            isSelf={editing?.user_id === currentUserId}
            isLastPm={
              editing?.role === "pm" && editing.user.is_active && pmCount <= 1
            }
            onOpenChange={(open) => {
              if (!open) setEditing(null);
            }}
            onSaved={handleRoleSaved}
          />
        </>
      ) : null}
    </section>
  );
}
