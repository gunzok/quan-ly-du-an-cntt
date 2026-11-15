import {
  handleCreateConfig,
  handleListConfig,
} from "@/lib/project-config/handlers";
import { createClient } from "@/lib/supabase/server";

type Params = { params: Promise<{ id: string }> };

/** GET /api/v1/projects/{id}/labels — mọi vai trò trong dự án và Admin (Story E2-3). */
export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  return handleListConfig(request, "labels", id, {
    session: await createClient(),
  });
}

/** POST /api/v1/projects/{id}/labels — PM của dự án và Admin. */
export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  return handleCreateConfig(request, "labels", id, {
    session: await createClient(),
  });
}
