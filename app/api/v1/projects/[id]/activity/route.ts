import { handleGetProjectActivity } from "@/lib/activity/handlers";
import { createClient } from "@/lib/supabase/server";

type Params = { params: Promise<{ id: string }> };

/** GET /api/v1/projects/{id}/activity — nhật ký dự án, PM của dự án và Admin (Story E6-2). */
export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  return handleGetProjectActivity(request, id, {
    session: await createClient(),
  });
}
