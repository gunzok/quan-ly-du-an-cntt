import { handlePatchUser } from "@/lib/admin/users/handlers";
import { adminDeps } from "../deps";

/** PATCH /api/v1/users/{id} — chỉ Admin: khóa/mở, cấp/thu quyền Admin, đổi phòng ban. */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return handlePatchUser(request, id, await adminDeps());
}
