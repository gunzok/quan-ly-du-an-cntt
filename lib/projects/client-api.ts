import type { ApiError, ApiErrorBody } from "@/lib/api/errors";
import { strings } from "@/lib/strings";
import type { Project, ProjectListResponse, ProjectStatus } from "./model";

/**
 * Gọi /api/v1/projects từ trình duyệt. Cookie phiên httpOnly tự đi kèm (cùng origin); trình duyệt
 * tự gửi header Origin cho POST/PATCH/DELETE (máy chủ kiểm chống CSRF).
 */
export type ApiResult<T> =
  { ok: true; data: T } | { ok: false; error: ApiError };

async function call<T>(
  input: string,
  init?: RequestInit,
): Promise<ApiResult<T>> {
  let response: Response;
  try {
    response = await fetch(input, {
      ...init,
      credentials: "same-origin",
      cache: "no-store",
      headers: { accept: "application/json", ...(init?.headers ?? {}) },
    });
  } catch (error) {
    if ((error as { name?: string }).name === "AbortError") throw error;
    return {
      ok: false,
      error: {
        code: "internal_error",
        message: strings.projects.errors.network,
      },
    };
  }
  if (response.status === 204) return { ok: true, data: undefined as T };
  const body = (await response.json().catch(() => null)) as unknown;
  if (response.ok) return { ok: true, data: body as T };
  const error = (body as ApiErrorBody | null)?.error;
  return {
    ok: false,
    error:
      error && typeof error.message === "string"
        ? error
        : { code: "internal_error", message: strings.api.internal },
  };
}

export function fetchProjects(
  params: { status: ProjectStatus; q?: string; cursor?: string | null },
  signal?: AbortSignal,
) {
  const search = new URLSearchParams({ status: params.status });
  if (params.q) search.set("q", params.q);
  if (params.cursor) search.set("cursor", params.cursor);
  return call<ProjectListResponse>(`/api/v1/projects?${search}`, { signal });
}

export interface ProjectInput {
  name: string;
  description: string | null;
  start_date: string | null;
  end_date: string | null;
}

export function createProject(body: ProjectInput) {
  return call<{ data: Project }>("/api/v1/projects", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function patchProject(
  id: string,
  body: Partial<ProjectInput> & { status?: ProjectStatus },
) {
  return call<{ data: Project }>(`/api/v1/projects/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function deleteProject(id: string) {
  return call<void>(`/api/v1/projects/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}
