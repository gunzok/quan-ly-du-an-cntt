import { handleInviteUser } from "@/lib/admin/users/handlers";
import { adminDeps } from "../deps";

/** POST /api/v1/users/invitations — chỉ Admin. */
export async function POST(request: Request) {
  return handleInviteUser(request, await adminDeps());
}
