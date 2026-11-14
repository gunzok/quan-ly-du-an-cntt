import { handleListUsers } from "@/lib/admin/users/handlers";
import { adminDeps } from "./deps";

/** GET /api/v1/users — chỉ Admin (api-contract.md mục 3). */
export async function GET(request: Request) {
  return handleListUsers(request, await adminDeps());
}
