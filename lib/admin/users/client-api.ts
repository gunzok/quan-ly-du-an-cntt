import type { ApiError, ApiErrorBody } from "@/lib/api/errors";
import { strings } from "@/lib/strings";
import type { AdminUser, UserListResponse } from "./model";

/**
 * Gọi /api/v1/users từ trình duyệt. Cookie phiên httpOnly tự đi kèm (cùng origin);
 * trình duyệt tự gửi header Origin cho POST/PATCH (máy chủ kiểm chống CSRF).
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
        message: strings.adminUsers.errors.network,
      },
    };
  }
  const body = (await response.json().catch(() => null)) as unknown;
  if (response.ok) {
    return { ok: true, data: body as T };
  }
  const error = (body as ApiErrorBody | null)?.error;
  return {
    ok: false,
    error:
      error && typeof error.message === "string"
        ? error
        : { code: "internal_error", message: strings.api.internal },
  };
}

export function fetchUsers(
  params: { q?: string; cursor?: string | null },
  signal?: AbortSignal,
) {
  const search = new URLSearchParams();
  if (params.q) search.set("q", params.q);
  if (params.cursor) search.set("cursor", params.cursor);
  const qs = search.toString();
  return call<UserListResponse>(`/api/v1/users${qs ? `?${qs}` : ""}`, {
    signal,
  });
}

export function inviteUser(body: {
  email: string;
  full_name?: string;
  department_id?: string | null;
}) {
  return call<{ data: AdminUser }>("/api/v1/users/invitations", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function patchUser(
  id: string,
  body: {
    is_active?: boolean;
    is_admin?: boolean;
    department_id?: string | null;
  },
) {
  return call<{ data: AdminUser }>(`/api/v1/users/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
