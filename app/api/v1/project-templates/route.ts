import { handleListProjectTemplates } from "@/lib/project-templates/handlers";
import { projectTemplateDeps } from "./deps";

/** GET /api/v1/project-templates — Admin, PM: danh sách template dự án (`?include_archived=`). */
export async function GET(request: Request) {
  return handleListProjectTemplates(request, await projectTemplateDeps());
}
