import { handleCreateTask, handleListTasks } from "@/lib/tasks/handlers";
import { createClient } from "@/lib/supabase/server";

type Params = { params: Promise<{ id: string }> };

/** GET /api/v1/projects/{id}/tasks — mọi vai trò trong dự án và Admin (api-contract.md mục 3). */
export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  return handleListTasks(request, id, { session: await createClient() });
}

/** POST /api/v1/projects/{id}/tasks — Admin, PM, Thành viên (Người xem không, BR-02). */
export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  return handleCreateTask(request, id, { session: await createClient() });
}
