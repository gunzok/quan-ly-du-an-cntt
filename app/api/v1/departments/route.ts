import {
  handleCreateDepartment,
  handleListDepartments,
} from "@/lib/departments/handlers";
import { departmentDeps } from "./deps";

/** GET /api/v1/departments — mọi người dùng đang hoạt động (api-contract.md mục 3). */
export async function GET(request: Request) {
  return handleListDepartments(request, await departmentDeps());
}

/** POST /api/v1/departments — chỉ Admin: thêm phòng ban. */
export async function POST(request: Request) {
  return handleCreateDepartment(request, await departmentDeps());
}
