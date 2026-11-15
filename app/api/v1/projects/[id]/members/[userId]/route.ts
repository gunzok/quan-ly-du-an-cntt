import {
  handleDeleteMember,
  handleGetMember,
  handlePutMember,
} from "@/lib/project-members/handlers";
import { createClient } from "@/lib/supabase/server";

type Params = { params: Promise<{ id: string; userId: string }> };

/** GET /api/v1/projects/{id}/members/{user_id} — mọi vai trò trong dự án và Admin (Story E1-6). */
export async function GET(request: Request, { params }: Params) {
  const { id, userId } = await params;
  return handleGetMember(request, id, userId, {
    session: await createClient(),
  });
}

/** PUT /api/v1/projects/{id}/members/{user_id} `{role}` — PM của dự án và Admin. */
export async function PUT(request: Request, { params }: Params) {
  const { id, userId } = await params;
  return handlePutMember(request, id, userId, {
    session: await createClient(),
  });
}

/** DELETE /api/v1/projects/{id}/members/{user_id} — PM của dự án và Admin. */
export async function DELETE(request: Request, { params }: Params) {
  const { id, userId } = await params;
  return handleDeleteMember(request, id, userId, {
    session: await createClient(),
  });
}
