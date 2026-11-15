import {
  handleDeleteProject,
  handleGetProject,
  handlePatchProject,
} from "@/lib/projects/handlers";
import { createClient } from "@/lib/supabase/server";

type Params = { params: Promise<{ id: string }> };

/** GET /api/v1/projects/{id} — mọi vai trò trong dự án và Admin. */
export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  return handleGetProject(request, id, { session: await createClient() });
}

/** PATCH /api/v1/projects/{id} — Admin, PM của dự án (sửa, lưu trữ bằng status=archived). */
export async function PATCH(request: Request, { params }: Params) {
  const { id } = await params;
  return handlePatchProject(request, id, { session: await createClient() });
}

/** DELETE /api/v1/projects/{id} — xóa vĩnh viễn (BR-11), chỉ Admin. */
export async function DELETE(request: Request, { params }: Params) {
  const { id } = await params;
  return handleDeleteProject(request, id, { session: await createClient() });
}
