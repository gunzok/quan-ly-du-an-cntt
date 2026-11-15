import { handleListTaskTypesByQuery } from "@/lib/project-config/handlers";
import { createClient } from "@/lib/supabase/server";

/** GET /api/v1/task-types?project_id= — loại task của dự án (api-contract.md, FR-23). */
export async function GET(request: Request) {
  return handleListTaskTypesByQuery(request, { session: await createClient() });
}
