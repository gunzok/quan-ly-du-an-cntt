"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Avatar, AvatarGroup } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { formatDate } from "@/lib/projects/format";
import type { Project } from "@/lib/projects/model";
import { useI18n } from "@/lib/i18n/client";

export type ProjectAction = "archive" | "restore" | "delete";

/** Thẻ dự án theo mockup bp-Projects: tiến độ, số task, trễ hạn, hạn, thành viên, thao tác. */
export function ProjectCard({
  project,
  isAdmin,
  onEdit,
  onAction,
}: {
  project: Project;
  isAdmin: boolean;
  onEdit: (project: Project) => void;
  onAction: (project: Project, action: ProjectAction) => Promise<void>;
}) {
  const { t: strings, locale } = useI18n();
  const t = strings.projects;
  const canEdit = isAdmin || project.my_role === "pm";
  const archived = project.status === "archived";
  const roleLabel = project.my_role
    ? t.roles[project.my_role]
    : isAdmin
      ? t.roles.admin
      : null;
  const due = formatDate(project.end_date, locale);
  const late = project.overdue_task_count;
  const headingId = `project-${project.id}-name`;

  return (
    <li
      aria-labelledby={headingId}
      className="flex min-w-0 flex-col gap-3.5 rounded-lg border border-solid border-border bg-bg p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="label">
          {t.card.eyebrow}
          {roleLabel ? ` / ${roleLabel}` : null}
        </span>
        {archived ? <Badge tone="neutral">{t.card.archived}</Badge> : null}
      </div>
      <h2
        id={headingId}
        className="min-h-11 text-base font-semibold [overflow-wrap:anywhere]"
      >
        {project.name}
      </h2>
      {project.description ? (
        <p className="line-clamp-2 text-sm text-text-muted [overflow-wrap:anywhere]">
          {project.description}
        </p>
      ) : null}

      <div className="flex items-end justify-between">
        <span className="font-display text-display-lg">
          {project.progress}%
        </span>
        <span className="label">{t.card.progress}</span>
      </div>
      <div
        role="progressbar"
        aria-valuenow={project.progress}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={t.card.progressOf(project.name)}
        className="h-1 rounded-sm bg-bg-muted"
      >
        <div
          className="h-1 rounded-sm bg-primary"
          style={{ width: `${project.progress}%` }}
        />
      </div>

      <dl className="flex flex-col">
        <Row label={t.card.tasks}>{project.task_count}</Row>
        <Row label={t.card.overdue}>
          <span
            className={late > 0 ? "font-medium text-danger" : "text-success"}
          >
            {late > 0 ? late : t.card.overdueNone}
          </span>
        </Row>
        <Row label={t.card.due}>{due ?? t.card.dueNone}</Row>
      </dl>

      <div className="flex items-center gap-2">
        {project.members_preview.length > 0 ? (
          <AvatarGroup label={t.card.membersLabel(project.name)}>
            {project.members_preview.map((m) => (
              <Avatar
                key={m.id}
                name={m.full_name.trim() || t.card.unnamedMember}
                size="sm"
              />
            ))}
          </AvatarGroup>
        ) : null}
        <span className="text-xs font-normal text-text-muted">
          {t.card.members(project.member_count)}
        </span>
      </div>

      {/* Story E2-3: cấu hình trạng thái, loại task, nhãn (mọi vai trò xem, PM và Admin sửa). */}
      <Link
        href={`/projects/${project.id}/settings`}
        className="inline-flex min-h-11 w-fit items-center text-sm sm:min-h-0"
      >
        {strings.projectConfig.openSettings}
        <span className="sr-only"> {project.name}</span>
      </Link>

      {canEdit ? (
        <div
          role="group"
          aria-label={t.card.actionsLabel(project.name)}
          className="mt-auto flex flex-wrap gap-2 border-0 border-t border-solid border-border pt-3"
        >
          {!archived ? (
            <Button variant="secondary" onClick={() => onEdit(project)}>
              {t.card.edit}
              <span className="sr-only"> {project.name}</span>
            </Button>
          ) : null}
          {archived ? (
            <ConfirmDialog
              tone="primary"
              trigger={
                <Button variant="secondary">
                  {t.card.restore}
                  <span className="sr-only"> {project.name}</span>
                </Button>
              }
              title={t.confirm.restoreTitle(project.name)}
              description={t.confirm.restoreBody}
              confirmLabel={t.card.restore}
              onConfirm={() => onAction(project, "restore")}
            />
          ) : (
            <ConfirmDialog
              tone="primary"
              trigger={
                <Button variant="text">
                  {t.card.archive}
                  <span className="sr-only"> {project.name}</span>
                </Button>
              }
              title={t.confirm.archiveTitle(project.name)}
              description={t.confirm.archiveBody}
              confirmLabel={t.card.archive}
              onConfirm={() => onAction(project, "archive")}
            />
          )}
          {isAdmin ? (
            <ConfirmDialog
              tone="danger"
              trigger={
                <Button variant="text" className="text-danger">
                  {t.card.delete}
                  <span className="sr-only"> {project.name}</span>
                </Button>
              }
              title={t.confirm.deleteTitle(project.name)}
              description={t.confirm.deleteBody}
              confirmLabel={t.card.delete}
              onConfirm={() => onAction(project, "delete")}
            />
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-3 border-0 border-t border-solid border-border py-1.5">
      <dt className="label">{label}</dt>
      <dd className="font-mono text-code">{children}</dd>
    </div>
  );
}
