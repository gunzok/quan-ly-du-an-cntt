import { handleMarkRead } from "@/lib/notifications/handlers";
import { createClient } from "@/lib/supabase/server";

type Params = { params: Promise<{ id: string }> };

/** POST /api/v1/notifications/{id}/read — đánh dấu một thông báo đã đọc (Story E4-1). */
export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  return handleMarkRead(request, id, { session: await createClient() });
}
