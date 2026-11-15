import {
  handleDeleteRelation,
  handleGetRelation,
} from "@/lib/task-relations/handlers";
import { createClient } from "@/lib/supabase/server";

type Params = { params: Promise<{ id: string; relationId: string }> };

/** GET /api/v1/tasks/{id}/relations/{relation_id} — một quan hệ nhìn từ task {id}. */
export async function GET(request: Request, { params }: Params) {
  const { id, relationId } = await params;
  return handleGetRelation(request, id, relationId, {
    session: await createClient(),
  });
}

/** DELETE /api/v1/tasks/{id}/relations/{relation_id} — cần quyền sửa cả hai task (FR-10). */
export async function DELETE(request: Request, { params }: Params) {
  const { id, relationId } = await params;
  return handleDeleteRelation(request, id, relationId, {
    session: await createClient(),
  });
}
