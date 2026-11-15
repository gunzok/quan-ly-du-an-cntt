import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isUuid, unknownFields } from "@/lib/api/request";
import { apiError, errorResponse, jsonResponse } from "@/lib/api/respond";
import { todayIso } from "@/lib/projects/format";
import { toDashboard, type Dashboard, type DashboardRow } from "./model";

/**
 * Lõi của GET /api/v1/projects/{id}/dashboard (Story E5-1, FR-13). Route Handler chỉ tạo client
 * phiên rồi gọi hàm này; test tích hợp gọi thẳng.
 *
 * Client PHIÊN của người gọi (RLS áp dụng), không service_role. Số liệu tính trong CSDL bằng một
 * lời gọi public.project_dashboard() (SECURITY INVOKER), không tải task về Node. Thứ tự kiểm:
 *   1. Phiên: getUser(); không có: 401.
 *   2. Dự án người gọi không thấy (người ngoài, bị khóa, id sai): 404 (BR-10).
 *   3. Vai trò: mọi vai trò trong dự án (PM, Thành viên, Người xem) và Admin đều được đọc, không
 *      có 403.
 *   4. Query string: không nhận tham số nào, có trường lạ: 400.
 */
export interface DashboardDeps {
  /** Client theo phiên cookie của người gọi (khóa anon, RLS áp dụng). */
  session: SupabaseClient;
  requestId?: string;
  /** Ngày "hôm nay" YYYY-MM-DD để tính trễ hạn; mặc định theo giờ Việt Nam (test truyền cố định). */
  today?: string;
}

export async function handleGetDashboard(
  request: Request,
  rawProjectId: string,
  deps: DashboardDeps,
): Promise<Response> {
  const requestId = deps.requestId ?? randomUUID();
  try {
    const { data: auth, error: authError } = await deps.session.auth.getUser();
    if (authError || !auth.user) {
      return errorResponse(apiError("unauthenticated"), requestId);
    }
    if (!isUuid(rawProjectId)) {
      return errorResponse(apiError("not_found"), requestId);
    }
    const { data, error } = await deps.session.rpc("project_dashboard", {
      p_project_id: rawProjectId.toLowerCase(),
      p_today: deps.today ?? todayIso(),
    });
    if (error) throw error;
    if (!data) return errorResponse(apiError("not_found"), requestId);

    const params = new URL(request.url).searchParams;
    const details = unknownFields(new Set(params.keys()), []);
    if (details.length > 0) {
      return errorResponse(
        apiError("validation_failed", undefined, details),
        requestId,
      );
    }
    const body: { data: Dashboard } = {
      data: toDashboard(data as DashboardRow),
    };
    return jsonResponse(body);
  } catch (error) {
    const e = error as { code?: unknown; message?: unknown };
    console.error(
      `[api/v1/dashboard] get request_id=${requestId} code=${String(e?.code ?? "")} message=${String(e?.message ?? error).slice(0, 200)}`,
    );
    return errorResponse(apiError("internal_error"), requestId);
  }
}
