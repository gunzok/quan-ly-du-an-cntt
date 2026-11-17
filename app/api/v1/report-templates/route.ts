import {
  handleListReportTemplates,
  handleUploadReportTemplate,
} from "@/lib/report-templates/handlers";
import { reportTemplateDeps } from "./deps";

/** GET /api/v1/report-templates — Admin, PM: danh sách template báo cáo. */
export async function GET(request: Request) {
  return handleListReportTemplates(request, await reportTemplateDeps());
}

/** POST /api/v1/report-templates — chỉ Admin: tải lên (multipart: file, name?). */
export async function POST(request: Request) {
  return handleUploadReportTemplate(request, await reportTemplateDeps());
}
