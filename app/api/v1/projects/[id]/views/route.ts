import { handleCreateView, handleListViews } from "@/lib/saved-views/handlers";
import { createClient } from "@/lib/supabase/server";

type Params = { params: Promise<{ id: string }> };

/** GET /api/v1/projects/{id}/views — mọi vai trò trong dự án và Admin (Story E13-1). */
export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  return handleListViews(request, id, { session: await createClient() });
}

/** POST /api/v1/projects/{id}/views — riêng tư: mọi vai trò; công khai: PM của dự án và Admin. */
export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  return handleCreateView(request, id, { session: await createClient() });
}
