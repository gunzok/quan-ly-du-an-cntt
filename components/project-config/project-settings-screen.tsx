"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { AlertIcon } from "@/components/ui/icons";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToastProvider } from "@/components/ui/toast";
import { HOME_PATH } from "@/lib/auth/routes";
import type { ConfigKind } from "@/lib/project-config/model";
import { useStrings } from "@/lib/i18n/client";
import { MembersPanel } from "@/components/project-members/members-panel";
import { SaveTemplateDialog } from "@/components/project-templates/save-template-dialog";
import { ConfigPanel } from "./config-panel";

const KINDS: readonly ConfigKind[] = ["statuses", "task-types", "labels"];

export interface ProjectSettingsScreenProps {
  projectId: string;
  projectName: string;
  /** PM của dự án hoặc Admin; vai trò khác chỉ xem. */
  canEdit: boolean;
  /** Người đang đăng nhập (tab Thành viên đánh dấu "(Bạn)", xử lý tự hạ vai trò, tự rời). */
  currentUserId: string;
}

/**
 * Cấu hình dự án (Story E2-3, mockup v3 bp-ProjectSettings.dc.html): ba tab Trạng thái, Loại task,
 * Nhãn; tab Thành viên thêm ở Story E1-6. Dữ liệu qua /api/v1; nút sửa chỉ hiện với PM và Admin (API và RLS vẫn kiểm lại).
 */
export function ProjectSettingsScreen(props: ProjectSettingsScreenProps) {
  return (
    <ToastProvider>
      <Screen {...props} />
    </ToastProvider>
  );
}

function Screen({
  projectId,
  projectName,
  canEdit,
  currentUserId,
}: ProjectSettingsScreenProps) {
  const strings = useStrings();
  const t = strings.projectConfig;
  return (
    <div className="flex flex-col gap-5 px-4 py-6 sm:px-8">
      <Link
        href={HOME_PATH}
        className="inline-flex min-h-11 w-fit items-center text-sm sm:min-h-0"
      >
        <span aria-hidden="true">←&nbsp;</span>
        {t.backToProjects}
      </Link>
      <header className="flex flex-col gap-2">
        <span className="label [overflow-wrap:anywhere]">
          {t.eyebrow(projectName)}
        </span>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="font-display text-display-sm">
            {t.heading}
            <span aria-hidden="true" className="text-accent">
              .
            </span>
          </h1>
          {/* Lưu thành template (E7-1): PM của dự án hoặc Admin, cùng điều kiện với sửa cấu hình. */}
          {canEdit ? (
            <SaveTemplateDialog
              projectId={projectId}
              projectName={projectName}
            />
          ) : null}
        </div>
        <p className="flex flex-wrap items-center gap-2 text-sm text-text-muted">
          {canEdit ? null : <Badge tone="neutral">{t.readOnly}</Badge>}
          {t.canEditNote}
        </p>
      </header>

      <Tabs defaultValue="statuses">
        <TabsList aria-label={t.tabsLabel}>
          {KINDS.map((kind) => (
            <TabsTrigger key={kind} value={kind}>
              {t.kinds[kind].tab}
            </TabsTrigger>
          ))}
          <TabsTrigger value="members">
            {strings.projectMembers.tab}
          </TabsTrigger>
        </TabsList>
        {KINDS.map((kind) => (
          <TabsContent key={kind} value={kind}>
            <ConfigPanel kind={kind} projectId={projectId} canEdit={canEdit} />
          </TabsContent>
        ))}
        <TabsContent value="members">
          <MembersPanel
            projectId={projectId}
            currentUserId={currentUserId}
            canEdit={canEdit}
          />
        </TabsContent>
      </Tabs>

      <p className="flex items-start gap-2 rounded-md border border-solid border-border bg-bg-subtle p-3 text-sm text-text">
        <AlertIcon className="mt-0.5 size-4 shrink-0 text-warning" />
        {t.deleteHint}
      </p>
    </div>
  );
}
