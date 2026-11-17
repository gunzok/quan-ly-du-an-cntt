import {
  handleDeleteReportTemplate,
  handlePatchReportTemplate,
} from "@/lib/report-templates/handlers";
import { reportTemplateDeps } from "../deps";

type Params = { params: Promise<{ id: string }> };

/** PATCH /api/v1/report-templates/{id} — chỉ Admin: đổi tên, bật/tắt. */
export async function PATCH(request: Request, { params }: Params) {
  const { id } = await params;
  return handlePatchReportTemplate(request, id, await reportTemplateDeps());
}

/** DELETE /api/v1/report-templates/{id} — chỉ Admin: xóa dòng và tệp. */
export async function DELETE(request: Request, { params }: Params) {
  const { id } = await params;
  return handleDeleteReportTemplate(request, id, await reportTemplateDeps());
}
