import { handleDownloadReportTemplate } from "@/lib/report-templates/handlers";
import { reportTemplateDeps } from "../../deps";

/** GET /api/v1/report-templates/{id}/file — Admin, PM: tải tệp template (qua RLS Storage). */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return handleDownloadReportTemplate(request, id, await reportTemplateDeps());
}
