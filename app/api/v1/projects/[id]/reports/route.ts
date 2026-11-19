import { getLocale } from "@/lib/i18n/server";
import { handleExportReport } from "@/lib/reports/handlers";
import { createClient } from "@/lib/supabase/server";

/** Trần của nền tảng (giây), lớn hơn trần 25 giây của ứng dụng để 504 report_timeout luôn do ta trả. */
export const maxDuration = 30;

// Route Handler mặc định chạy Node (exceljs cần Node, ADR-004); cacheComponents không cho khai `runtime`.
type Params = { params: Promise<{ id: string }> };

/** POST /api/v1/projects/{id}/reports — PM của dự án, Admin: xuất báo cáo xlsx (Story E5-3). */
export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  const [session, locale] = await Promise.all([createClient(), getLocale()]);
  return handleExportReport(request, id, { session, locale });
}
