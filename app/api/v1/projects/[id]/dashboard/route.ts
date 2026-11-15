import { handleGetDashboard } from "@/lib/dashboard/handlers";
import { createClient } from "@/lib/supabase/server";

type Params = { params: Promise<{ id: string }> };

/** GET /api/v1/projects/{id}/dashboard — mọi vai trò trong dự án và Admin (Story E5-1). */
export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  return handleGetDashboard(request, id, { session: await createClient() });
}
