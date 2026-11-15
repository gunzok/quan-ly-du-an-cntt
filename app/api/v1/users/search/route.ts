import { handleSearchUsers } from "@/lib/project-members/handlers";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /api/v1/users/search?q= — tìm người để thêm vào dự án (Story E1-6). Admin hoặc PM của ít
 * nhất một dự án; client phiên (RLS), không dùng service_role như GET /api/v1/users.
 */
export async function GET(request: Request) {
  return handleSearchUsers(request, { session: await createClient() });
}
