import {
  handleDeleteProjectTemplate,
  handleGetProjectTemplate,
  handlePatchProjectTemplate,
} from "@/lib/project-templates/handlers";
import { projectTemplateDeps } from "../deps";

type Params = { params: Promise<{ id: string }> };

/** GET /api/v1/project-templates/{id} — Admin, PM: một template (tóm tắt). */
export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  return handleGetProjectTemplate(request, id, await projectTemplateDeps());
}

/** PATCH /api/v1/project-templates/{id} — người lưu hoặc Admin: đổi tên, lưu trữ/khôi phục. */
export async function PATCH(request: Request, { params }: Params) {
  const { id } = await params;
  return handlePatchProjectTemplate(request, id, await projectTemplateDeps());
}

/** DELETE /api/v1/project-templates/{id} — người lưu hoặc Admin: xóa thật. */
export async function DELETE(request: Request, { params }: Params) {
  const { id } = await params;
  return handleDeleteProjectTemplate(request, id, await projectTemplateDeps());
}
