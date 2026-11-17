import { handleGetMe, handlePatchMe } from "@/lib/me/handlers";
import { createClient } from "@/lib/supabase/server";

/** GET /api/v1/me — hồ sơ của người đang đăng nhập, số điện thoại, vai trò theo dự án (E1-7). */
export async function GET(request: Request) {
  return handleGetMe(request, { session: await createClient() });
}

/**
 * PATCH /api/v1/me { full_name?, phone?, locale? } — người đang đăng nhập sửa hồ sơ của mình
 * (Story E10-2, E1-7).
 */
export async function PATCH(request: Request) {
  return handlePatchMe(request, { session: await createClient() });
}
