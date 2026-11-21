import { handleSaveProjectAsTemplate } from "@/lib/project-templates/handlers";
import { createClient } from "@/lib/supabase/server";

type Params = { params: Promise<{ id: string }> };

/** POST /api/v1/projects/{id}/templates — PM của dự án hoặc Admin: lưu dự án thành template. */
export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  return handleSaveProjectAsTemplate(request, id, {
    session: await createClient(),
  });
}
