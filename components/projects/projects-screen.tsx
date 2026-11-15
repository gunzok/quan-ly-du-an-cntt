"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Skeleton, SkeletonGroup } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToastProvider, useToast } from "@/components/ui/toast";
import type { ApiError } from "@/lib/api/errors";
import {
  deleteProject,
  fetchProjects,
  patchProject,
} from "@/lib/projects/client-api";
import type {
  Project,
  ProjectCounts,
  ProjectStatus,
} from "@/lib/projects/model";
import { apiErrorText } from "@/lib/i18n/api-error";
import { useStrings } from "@/lib/i18n/client";
import { ProjectCard, type ProjectAction } from "./project-card";
import { ProjectFormDialog } from "./project-form-dialog";

const SEARCH_DEBOUNCE_MS = 300;
const Q_MAX_LENGTH = 200;

/**
 * Kết quả tải gần nhất, gắn với khóa yêu cầu (tab, từ khóa, lần tải lại). Khóa hiện tại khác khóa
 * của kết quả nghĩa là đang tải: trạng thái "đang tải" suy ra khi render, không đặt trong effect.
 */
type Loaded =
  | {
      key: string;
      tab: ProjectStatus;
      status: "ready";
      items: Project[];
      nextCursor: string | null;
    }
  | { key: string; tab: ProjectStatus; status: "error"; error: ApiError };

type ListState =
  | { status: "loading"; items: Project[]; nextCursor: null }
  | { status: "ready"; items: Project[]; nextCursor: string | null }
  | { status: "error"; items: Project[]; nextCursor: null; error: ApiError };

export interface ProjectsScreenProps {
  isAdmin: boolean;
  canCreate: boolean;
}

/** S02 Danh sách dự án (mockup v3 bp-Projects.dc.html). Dữ liệu lấy qua /api/v1/projects. */
export function ProjectsScreen(props: ProjectsScreenProps) {
  return (
    <ToastProvider>
      <Screen {...props} />
    </ToastProvider>
  );
}

function Screen({ isAdmin, canCreate }: ProjectsScreenProps) {
  const strings = useStrings();
  const t = strings.projects;
  const { toast } = useToast();
  const [tab, setTab] = useState<ProjectStatus>("active");
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [counts, setCounts] = useState<ProjectCounts | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Project | null>(null);

  // Gõ ô lọc: chờ ngừng gõ rồi mới gọi API.
  useEffect(() => {
    const timer = window.setTimeout(
      () => setQ(search.trim()),
      SEARCH_DEBOUNCE_MS,
    );
    return () => window.clearTimeout(timer);
  }, [search]);

  const requestKey = `${tab}\u0000${q}\u0000${reloadKey}`;

  useEffect(() => {
    const controller = new AbortController();
    fetchProjects({ status: tab, q }, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        if (result.ok) {
          setLoaded({
            key: requestKey,
            tab,
            status: "ready",
            items: result.data.data,
            nextCursor: result.data.next_cursor,
          });
          setCounts(result.data.counts);
        } else {
          setLoaded({
            key: requestKey,
            tab,
            status: "error",
            error: result.error,
          });
        }
      })
      .catch((error: unknown) => {
        if ((error as { name?: string }).name !== "AbortError") throw error;
      });
    return () => controller.abort();
  }, [tab, q, requestKey]);

  // Đang tải lại cùng tab (sau thao tác, đổi từ khóa): giữ thẻ cũ, đánh dấu aria-busy.
  const list: ListState =
    loaded && loaded.key === requestKey
      ? loaded.status === "ready"
        ? {
            status: "ready",
            items: loaded.items,
            nextCursor: loaded.nextCursor,
          }
        : { status: "error", items: [], nextCursor: null, error: loaded.error }
      : {
          status: "loading",
          items:
            loaded && loaded.tab === tab && loaded.status === "ready"
              ? loaded.items
              : [],
          nextCursor: null,
        };

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  async function loadMore() {
    if (list.status !== "ready" || !list.nextCursor || loadingMore) return;
    setLoadingMore(true);
    const result = await fetchProjects({
      status: tab,
      q,
      cursor: list.nextCursor,
    });
    setLoadingMore(false);
    if (result.ok) {
      setLoaded((current) =>
        current && current.key === requestKey && current.status === "ready"
          ? {
              ...current,
              items: [...current.items, ...result.data.data],
              nextCursor: result.data.next_cursor,
            }
          : current,
      );
      setCounts(result.data.counts);
    } else {
      toast({ title: apiErrorText(strings, result.error), tone: "error" });
    }
  }

  function openCreate() {
    setEditing(null);
    setFormOpen(true);
  }

  function openEdit(project: Project) {
    setEditing(project);
    setFormOpen(true);
  }

  function handleSaved(project: Project, mode: "created" | "updated") {
    setFormOpen(false);
    toast({
      title:
        mode === "created"
          ? t.done.created(project.name)
          : t.done.updated(project.name),
    });
    if (mode === "created" && tab !== "active") setTab("active");
    else reload();
  }

  async function handleAction(project: Project, action: ProjectAction) {
    const result =
      action === "delete"
        ? await deleteProject(project.id)
        : await patchProject(project.id, {
            status: action === "archive" ? "archived" : "active",
          });
    if (!result.ok) {
      toast({
        title: t.errors.actionFailed,
        description: apiErrorText(strings, result.error),
        tone: "error",
      });
      return;
    }
    const done = {
      archive: t.done.archived,
      restore: t.done.restored,
      delete: t.done.deleted,
    }[action];
    toast({ title: done(project.name) });
    reload();
  }

  const eyebrow = counts ? t.eyebrowActive(counts.active) : t.eyebrow;

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3 border-0 border-b border-solid border-border px-4 pt-5 pb-4 sm:px-7">
        <div className="flex flex-col gap-1.5">
          <span className="label flex items-center gap-2">
            <span
              aria-hidden="true"
              className="inline-block size-1.5 rounded-pill bg-accent"
            />
            {eyebrow}
          </span>
          <h1 className="font-display text-display-sm">
            {t.pageTitle}
            <span aria-hidden="true" className="text-accent">
              .
            </span>
          </h1>
        </div>
        {canCreate ? (
          <Button trailing="→" onClick={openCreate}>
            {t.create}
          </Button>
        ) : null}
      </div>

      <div className="flex flex-col gap-4 px-4 pt-4 pb-7 sm:px-7">
        <Tabs
          value={tab}
          onValueChange={(value) => setTab(value as ProjectStatus)}
        >
          <div className="flex flex-wrap items-end justify-between gap-3">
            <TabsList aria-label={t.tabsLabel} className="border-b-0">
              <TabsTrigger value="active">
                {t.tabActive(counts?.active ?? null)}
              </TabsTrigger>
              <TabsTrigger value="archived">
                {t.tabArchived(counts?.archived ?? null)}
              </TabsTrigger>
            </TabsList>
            <Input
              type="search"
              aria-label={t.searchLabel}
              placeholder={t.searchPlaceholder}
              value={search}
              maxLength={Q_MAX_LENGTH}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full sm:w-64"
            />
          </div>
          {(["active", "archived"] as const).map((value) => (
            <TabsContent key={value} value={value}>
              <ListBody
                tab={value}
                list={list}
                q={q}
                isAdmin={isAdmin}
                canCreate={canCreate}
                loadingMore={loadingMore}
                onRetry={reload}
                onLoadMore={loadMore}
                onCreate={openCreate}
                onEdit={openEdit}
                onAction={handleAction}
              />
            </TabsContent>
          ))}
        </Tabs>
      </div>

      <ProjectFormDialog
        open={formOpen}
        project={editing}
        onOpenChange={setFormOpen}
        onSaved={handleSaved}
      />
    </>
  );
}

function ListBody({
  tab,
  list,
  q,
  isAdmin,
  canCreate,
  loadingMore,
  onRetry,
  onLoadMore,
  onCreate,
  onEdit,
  onAction,
}: {
  tab: ProjectStatus;
  list: ListState;
  q: string;
  isAdmin: boolean;
  canCreate: boolean;
  loadingMore: boolean;
  onRetry: () => void;
  onLoadMore: () => void;
  onCreate: () => void;
  onEdit: (project: Project) => void;
  onAction: (project: Project, action: ProjectAction) => Promise<void>;
}) {
  const strings = useStrings();
  const t = strings.projects;
  if (list.status === "loading" && list.items.length === 0) {
    return (
      <SkeletonGroup
        label={t.loading}
        className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3"
      >
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="flex flex-col gap-3.5 rounded-lg border border-solid border-border p-4"
          >
            <Skeleton className="w-24" />
            <Skeleton className="h-6 w-3/4" />
            <Skeleton className="h-10 w-20" />
            <Skeleton className="h-1" />
            <Skeleton className="w-full" />
            <Skeleton className="w-full" />
          </div>
        ))}
      </SkeletonGroup>
    );
  }

  if (list.status === "error") {
    return (
      <div
        role="alert"
        className="flex flex-col items-start gap-3 rounded-lg border border-solid border-border p-6"
      >
        <p className="font-medium text-danger">{t.loadError}</p>
        <p className="text-text-muted">{apiErrorText(strings, list.error)}</p>
        <Button variant="secondary" onClick={onRetry}>
          {t.retry}
        </Button>
      </div>
    );
  }

  if (list.items.length === 0) {
    if (q) {
      return (
        <EmptyState
          title={t.emptySearchTitle}
          description={t.emptySearchBody(q)}
        />
      );
    }
    if (tab === "archived") {
      return (
        <EmptyState
          title={t.emptyArchivedTitle}
          description={t.emptyArchivedBody}
        />
      );
    }
    return (
      <EmptyState
        title={t.emptyActiveTitle}
        description={canCreate ? t.emptyActiveCanCreate : t.emptyActiveNoCreate}
        action={
          canCreate ? (
            <Button trailing="→" onClick={onCreate}>
              {t.createFirst}
            </Button>
          ) : null
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-4" aria-busy={list.status === "loading"}>
      <ul
        aria-label={t.listLabel}
        className="m-0 grid list-none grid-cols-1 gap-4 p-0 sm:grid-cols-2 xl:grid-cols-3"
      >
        {list.items.map((project) => (
          <ProjectCard
            key={project.id}
            project={project}
            isAdmin={isAdmin}
            onEdit={onEdit}
            onAction={onAction}
          />
        ))}
      </ul>
      {list.status === "ready" && list.nextCursor ? (
        <div>
          <Button
            variant="secondary"
            loading={loadingMore}
            onClick={onLoadMore}
          >
            {t.loadMore}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
