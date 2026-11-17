"use client";

import { useEffect, useState } from "react";
import { fetchProjectActivity } from "@/lib/activity/client-api";

/**
 * Người đang xem có được xem nhật ký dự án không (PM của dự án, Admin), dùng để hiện tab "Nhật ký"
 * trên những màn chưa truyền sẵn quyền (Bảng, Danh sách). Hỏi chính API nhật ký với limit=1: API
 * và RLS là nơi quyết định, giao diện không tự suy quyền. Kết quả nhớ theo dự án trong phiên tải
 * trang để chuyển tab không hỏi lại. Chưa biết hoặc lỗi mạng: ẩn tab (an toàn).
 */
const cache = new Map<string, boolean>();

export function useActivityAccess(
  projectId: string,
  enabled: boolean,
): boolean {
  const [answer, setAnswer] = useState<{
    projectId: string;
    allowed: boolean;
  } | null>(null);

  useEffect(() => {
    if (!enabled || cache.has(projectId)) return;
    const controller = new AbortController();
    fetchProjectActivity(projectId, { limit: 1 }, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        // Chỉ nhớ câu trả lời chắc chắn (200 hoặc 403/404), không nhớ lỗi tạm thời.
        if (result.ok) cache.set(projectId, true);
        else if (["forbidden", "not_found"].includes(result.error.code)) {
          cache.set(projectId, false);
        }
        setAnswer({ projectId, allowed: result.ok });
      })
      .catch((error: unknown) => {
        if ((error as { name?: string }).name !== "AbortError") throw error;
      });
    return () => controller.abort();
  }, [projectId, enabled]);

  if (!enabled) return false;
  const known = cache.get(projectId);
  if (known !== undefined) return known;
  return answer?.projectId === projectId ? answer.allowed : false;
}
