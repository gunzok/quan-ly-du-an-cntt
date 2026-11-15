import {
  handleDeleteView,
  handleGetView,
  handlePatchView,
} from "@/lib/saved-views/handlers";
import { createClient } from "@/lib/supabase/server";

type Params = { params: Promise<{ id: string }> };

/** GET /api/v1/views/{id} — người đọc được chế độ xem (Story E13-1). */
export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  return handleGetView(request, id, { session: await createClient() });
}

/** PATCH /api/v1/views/{id} — chủ sở hữu (riêng tư), PM/Admin (công khai); yêu thích: ai đọc được. */
export async function PATCH(request: Request, { params }: Params) {
  const { id } = await params;
  return handlePatchView(request, id, { session: await createClient() });
}

/** DELETE /api/v1/views/{id} — chủ sở hữu (riêng tư), PM/Admin (công khai); mặc định: không ai. */
export async function DELETE(request: Request, { params }: Params) {
  const { id } = await params;
  return handleDeleteView(request, id, { session: await createClient() });
}
