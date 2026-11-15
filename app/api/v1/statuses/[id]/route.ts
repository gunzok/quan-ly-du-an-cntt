import {
  handleDeleteConfig,
  handlePatchConfig,
} from "@/lib/project-config/handlers";
import { createClient } from "@/lib/supabase/server";

type Params = { params: Promise<{ id: string }> };

/** PATCH /api/v1/statuses/{id} — PM của dự án và Admin (Story E2-3). */
export async function PATCH(request: Request, { params }: Params) {
  const { id } = await params;
  return handlePatchConfig(request, "statuses", id, {
    session: await createClient(),
  });
}

/** DELETE /api/v1/statuses/{id}?replace_with=<uuid> — PM của dự án và Admin. */
export async function DELETE(request: Request, { params }: Params) {
  const { id } = await params;
  return handleDeleteConfig(request, "statuses", id, {
    session: await createClient(),
  });
}
