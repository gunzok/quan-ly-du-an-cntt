import { handleGetTaskActivity } from "@/lib/activity/handlers";
import { createClient } from "@/lib/supabase/server";

type Params = { params: Promise<{ id: string }> };

/** GET /api/v1/tasks/{id}/activity — nhật ký một task, PM của dự án và Admin (Story E6-2). */
export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  return handleGetTaskActivity(request, id, { session: await createClient() });
}
