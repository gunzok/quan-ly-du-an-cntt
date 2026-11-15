import {
  handleCreateRelation,
  handleListRelations,
} from "@/lib/task-relations/handlers";
import { createClient } from "@/lib/supabase/server";

type Params = { params: Promise<{ id: string }> };

/** GET /api/v1/tasks/{id}/relations — quan hệ của task, cả chiều đảo; mọi vai trò trong dự án. */
export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  return handleListRelations(request, id, { session: await createClient() });
}

/** POST /api/v1/tasks/{id}/relations — Admin, PM, Thành viên sửa được cả hai task (FR-10). */
export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  return handleCreateRelation(request, id, { session: await createClient() });
}
