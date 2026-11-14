import { handlePatchDepartment } from "@/lib/departments/handlers";
import { departmentDeps } from "../deps";

/** PATCH /api/v1/departments/{id} — chỉ Admin: đổi tên, thứ tự, lưu trữ hoặc dùng lại. */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return handlePatchDepartment(request, id, await departmentDeps());
}
