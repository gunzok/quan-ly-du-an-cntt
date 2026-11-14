import {
  handleDeleteTask,
  handleGetTask,
  handlePatchTask,
} from "@/lib/tasks/handlers";
import { createClient } from "@/lib/supabase/server";

type Params = { params: Promise<{ id: string }> };

/** GET /api/v1/tasks/{id} — mọi vai trò trong dự án và Admin. */
export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  return handleGetTask(request, id, { session: await createClient() });
}

/** PATCH /api/v1/tasks/{id} — Admin, PM; Thành viên nếu phụ trách hoặc tạo (BR-03). */
export async function PATCH(request: Request, { params }: Params) {
  const { id } = await params;
  return handlePatchTask(request, id, { session: await createClient() });
}

/** DELETE /api/v1/tasks/{id} — xóa vĩnh viễn (BR-11): Admin, PM; Thành viên nếu mình tạo. */
export async function DELETE(request: Request, { params }: Params) {
  const { id } = await params;
  return handleDeleteTask(request, id, { session: await createClient() });
}
