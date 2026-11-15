import {
  handleCreateProject,
  handleListProjects,
} from "@/lib/projects/handlers";
import { createClient } from "@/lib/supabase/server";

/** GET /api/v1/projects — dự án của tôi; Admin thấy tất cả (api-contract.md mục 3, BR-10). */
export async function GET(request: Request) {
  return handleListProjects(request, { session: await createClient() });
}

/** POST /api/v1/projects — Admin, hoặc PM ở ít nhất một dự án; người tạo thành PM (AC1). */
export async function POST(request: Request) {
  return handleCreateProject(request, { session: await createClient() });
}
