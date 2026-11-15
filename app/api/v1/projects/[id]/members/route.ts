import { handleListMembers } from "@/lib/project-members/handlers";
import { createClient } from "@/lib/supabase/server";

type Params = { params: Promise<{ id: string }> };

/** GET /api/v1/projects/{id}/members — mọi vai trò trong dự án và Admin (Story E1-6). */
export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  return handleListMembers(request, id, { session: await createClient() });
}
